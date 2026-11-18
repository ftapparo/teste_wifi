FROM node:22-alpine
WORKDIR /app
COPY portal.js .
# Cria a rota de volta para a rede do Wi-Fi (via WAN do E900) e inicia o portal
CMD ["sh", "-c", "ip route replace ${WIFI_REDE} via ${ROTEADOR_WAN} && exec node /app/portal.js"]
