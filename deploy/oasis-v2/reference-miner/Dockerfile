FROM oven/bun:1.3.4-alpine

WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY server.js ./

ENV NODE_ENV=production
EXPOSE 3015
USER bun
CMD ["bun", "run", "start"]
