# Cutroom in one container: Python API + built web UI + Node renderer.
#   docker build -t cutroom .
#   docker run -p 8000:8000 -v cutroom-data:/data cutroom
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip ffmpeg ca-certificates fonts-noto-color-emoji \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -r requirements.txt

COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci

COPY . .
# Build the UI, then fetch the headless browser the renderer uses.
RUN cd web && npm run build \
    && node -e "import('@remotion/renderer').then((r) => r.ensureBrowser())"

ENV CUTROOM_DATA=/data PATH="/venv/bin:$PATH"
VOLUME /data
EXPOSE 8000
CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8000"]
