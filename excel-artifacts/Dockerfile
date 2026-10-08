FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

RUN addgroup -S excel && adduser -S -G excel -u 10001 excel

COPY server.js ./
RUN mkdir -p /storage/files /storage/metadata && chown -R excel:excel /app /storage

USER excel
EXPOSE 8081

CMD ["node", "server.js"]
