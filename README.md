# teste_wifi

Portal cativo para a rede Wi-Fi aberta **WIFI-TESTE** (Linksys E900).
Aceita **qualquer** usuário e senha; o que é digitado aparece no log do container.

## Topologia

```
Celular (192.168.170.x) ── WIFI-TESTE ── E900 LAN 192.168.170.1
                                          E900 WAN 192.168.15.50
                                               │
                         rede 192.168.15.x ────┼──── modem 192.168.15.1
                                               └──── servidor 192.168.15.112 (portal)
```

## Como funciona

- **DNS (53):** o portal responde o próprio IP para qualquer nome.
- **HTTP (80):** sem login, redireciona para a página de login. Com login, repassa ao site real.
- **HTTPS (443):** sem login, recusa a conexão. Com login, abre um túnel TCP pelo SNI (o certificado não é alterado).
- Qualquer usuário e senha são aceitos; os valores digitados são gravados no log do container.
- A liberação é por IP do aparelho e dura 8 horas.
- Os logins ficam só em memória e somem quando o container reinicia.

## Configuração do E900

| Onde | Campo | Valor |
|---|---|---|
| Setup › Basic Setup | Internet | Static IP 192.168.15.50 / 255.255.255.0, gateway 192.168.15.1 |
| Setup › Basic Setup | Router IP | 192.168.170.1 / 255.255.255.0, DHCP ligado |
| Setup › Basic Setup | Static DNS 1 | **192.168.15.112** (DNS 2 e 3 vazios) |
| Setup › Advanced Routing | NAT | **Disabled** |
| Wireless | SSID / segurança | WIFI-TESTE / Disabled |

O NAT precisa ficar desligado. Com ele desligado:
- o portal enxerga o IP real de cada aparelho;
- quem tentar sair direto pela internet, sem passar pelo portal, fica sem resposta.

## Deploy no Portainer

1. Stacks › Add stack › **Repository**.
2. Repository URL: `https://github.com/ftapparo/teste_wifi`.
3. Compose path: `docker-compose.yml`.
4. Clique em Deploy.

O container cria sozinho, no servidor, a rota `192.168.170.0/24 via 192.168.15.50`.

## Teste rápido

De qualquer máquina na rede 192.168.15.x:

```
nslookup google.com 192.168.15.112
```

A resposta tem que ser `192.168.15.112`.
