// Central configuration. Everything is driven by environment variables (see .env.example).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'storage'));
const dirs = {
  ORIGINALS: path.join(DATA_DIR, 'originals'),
  PROCESSED: path.join(DATA_DIR, 'processed'),
  THUMBS: path.join(DATA_DIR, 'thumbnails'),
  UPLOADS: path.join(DATA_DIR, 'uploads'),
  TMP: path.join(DATA_DIR, 'tmp'),
};
for (const d of [DATA_DIR, ...Object.values(dirs)]) fs.mkdirSync(d, { recursive: true });

// APP_SECRET encrypts stream keys at rest. In production it comes from .env; for local
// development we generate one once and keep it next to the data so keys stay readable.
function loadSecret() {
  if (env.APP_SECRET && env.APP_SECRET.length >= 32) return env.APP_SECRET;
  const file = path.join(DATA_DIR, '.app-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const APP_SECRET = loadSecret();

module.exports = {
  DATA_DIR,
  ...dirs,
  DB_FILE: path.join(DATA_DIR, 'studio.db'),
  APP_SECRET,
  INTERNAL_TOKEN: crypto.createHmac('sha256', APP_SECRET).update('internal-token').digest('hex'),
  // Shared with MediaMTX (MTX_HLSCDNSECRET) so the dashboard can proxy the live preview.
  HLS_CDN_SECRET: env.HLS_CDN_SECRET || crypto.createHmac('sha256', APP_SECRET).update('hls-cdn').digest('hex'),
  WEB_HOST: env.WEB_HOST || '0.0.0.0',
  WEB_PORT: parseInt(env.WEB_PORT || '8080', 10),
  ENGINE_HOST: env.ENGINE_HOST || '127.0.0.1',
  ENGINE_PORT: parseInt(env.ENGINE_PORT || '7001', 10),
  ENGINE_URL: env.ENGINE_URL || 'http://127.0.0.1:7001',
  MEDIAMTX_RTMP: env.MEDIAMTX_RTMP || 'rtmp://127.0.0.1:1935',
  MEDIAMTX_API: env.MEDIAMTX_API || 'http://127.0.0.1:9997',
  MEDIAMTX_HLS: env.MEDIAMTX_HLS || 'http://127.0.0.1:8888',
  PUBLIC_HOST: env.PUBLIC_HOST || '',
  RTMP_PUBLIC_PORT: parseInt(env.RTMP_PUBLIC_PORT || '1935', 10),
  SETUP_CODE: env.SETUP_CODE || '',
  COOKIE_SECURE: env.COOKIE_SECURE || 'auto',
  FFMPEG: env.FFMPEG_PATH || 'ffmpeg',
  FFPROBE: env.FFPROBE_PATH || 'ffprobe',
  PREP_CONCURRENCY: parseInt(env.PREP_CONCURRENCY || '1', 10),
  MIN_FREE_BYTES: parseInt(env.MIN_FREE_GB || '3', 10) * 1024 ** 3,
  MAX_UPLOAD_BYTES: parseInt(env.MAX_UPLOAD_GB || '20', 10) * 1024 ** 3,
};
