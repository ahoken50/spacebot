FROM oven/bun:1.3.4-alpine

RUN apk add --no-cache docker-cli docker-cli-compose python3

WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY server.js ./

ENV NODE_ENV=production
EXPOSE 3020
CMD ["bun", "run", "server.js"]
