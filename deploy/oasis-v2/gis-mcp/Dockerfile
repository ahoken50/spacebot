FROM oven/bun:1.3.4-alpine

WORKDIR /app
COPY package.json ./
RUN bun install --production --frozen-lockfile=false
COPY server.js ./

ENV PORT=3011
EXPOSE 3011
USER bun
CMD ["bun", "run", "start"]
