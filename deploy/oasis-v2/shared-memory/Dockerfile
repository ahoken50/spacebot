FROM oven/bun:1.3.4

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY server.js ./

USER bun
EXPOSE 3010
CMD ["bun", "run", "start"]
