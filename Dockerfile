FROM node:22-alpine

# ffmpeg (with libx264, AAC and TLS for RTMPS) and tini for clean signal handling.
RUN apk add --no-cache ffmpeg tini

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production \
    DATA_DIR=/data

RUN addgroup -S studio && adduser -S studio -G studio \
 && mkdir -p /data && chown studio:studio /data
USER studio

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/web/index.js"]
