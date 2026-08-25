FROM oven/bun:1.3.4-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

RUN apk add --no-cache python3 py3-pip \
  && python3 -m venv /opt/dspy-venv \
  && /opt/dspy-venv/bin/pip install --no-cache-dir dspy==3.3.1

COPY server.js ./
COPY optimizer.py ./
COPY fixtures ./fixtures

ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/dspy-venv/bin:${PATH}"

EXPOSE 3013
CMD ["bun", "run", "start"]
