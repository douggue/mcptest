# Cutroom in one container: Python API + built web UI + Node renderer.
#   docker build -t cutroom .
#   docker run -p 8000:8000 -v cutroom-data:/data -e CUTROOM_PASSWORD=choose-one cutroom
# NODE_IMAGE and BASE can point at mirrors of the same images if Docker Hub is rate-limited.
ARG NODE_IMAGE=node:22-bookworm-slim
ARG BASE=ubuntu:24.04
FROM ${NODE_IMAGE} AS node

FROM ${BASE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg ca-certificates fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libgbm1 libasound2t64 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*
# Node.js (for the renderer and for yt-dlp) comes from the official image.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app
COPY requirements.txt requirements-optional.txt ./
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -r requirements.txt -r requirements-optional.txt

COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci

COPY . .
# Build the UI. SKIP_BROWSER=1 leaves the renderer's browser to be fetched on the first export instead.
ARG SKIP_BROWSER=0
RUN cd web && npm run build \
    && if [ "$SKIP_BROWSER" != "1" ]; then node -e "import('@remotion/renderer').then((r) => r.ensureBrowser())"; fi

ENV CUTROOM_DATA=/data PATH="/venv/bin:$PATH"
VOLUME /data
EXPOSE 8000
CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000"]
