FROM oven/bun:1.3.4-debian

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    pandoc \
    libreoffice-writer \
    libreoffice-calc \
    poppler-utils \
    fonts-liberation \
    fonts-dejavu \
    fonts-noto-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN bun install --production --frozen-lockfile=false
COPY server.js ./
COPY taxonomy.json ./taxonomy.json
COPY templates ./templates

ENV PORT=3012
EXPOSE 3012
USER bun
CMD ["bun", "run", "start"]
