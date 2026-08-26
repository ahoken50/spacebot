FROM oven/bun:1.3.4
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY server.js ./
CMD ["bun", "server.js"]
