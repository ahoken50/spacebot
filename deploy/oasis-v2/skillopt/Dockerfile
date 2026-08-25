FROM oven/bun:1.3.4-alpine

ARG SKILLOPT_COMMIT=0389ace56339988e16ca5ddab36f0978776fe9b0

WORKDIR /app

RUN apk add --no-cache git python3 py3-pip \
  && python3 -m venv /opt/skillopt-venv \
  && /opt/skillopt-venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel

# SkillOpt est figé sur un commit upstream vérifié : les backends OpenAI-compatibles
# récents sont nécessaires au routage OpenRouter OASIS.
RUN git clone https://github.com/microsoft/skillopt.git /opt/skillopt \
  && cd /opt/skillopt \
  && git checkout --detach "${SKILLOPT_COMMIT}" \
  && test "$(git rev-parse HEAD)" = "${SKILLOPT_COMMIT}"

COPY oasis_env /tmp/oasis_env
COPY register_oasis_env.py /tmp/register_oasis_env.py
RUN mkdir -p /opt/skillopt/skillopt/envs/oasis \
  && cp -R /tmp/oasis_env/. /opt/skillopt/skillopt/envs/oasis/ \
  && /opt/skillopt-venv/bin/python /tmp/register_oasis_env.py \
  && /opt/skillopt-venv/bin/pip install --no-cache-dir /opt/skillopt \
  && rm -rf /tmp/oasis_env /tmp/register_oasis_env.py /root/.cache

COPY package.json ./
RUN bun install --frozen-lockfile=false
COPY server.js ./
COPY skillopt_runner.py ./
COPY fixtures ./fixtures

ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/skillopt-venv/bin:${PATH}"

EXPOSE 3014
CMD ["bun", "run", "start"]
