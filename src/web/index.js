// Stream Studio web process: dashboard, REST API, uploads and the authenticated live preview.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { get } = require('../db');
const { send } = require('../http');
const auth = require('./auth');
const { r } = require('./api');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function serveFile(req, res, file, { cache = 'no-cache', type } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return send(res, 404, { error: 'Not found' }); }
  if (!stat.isFile()) return send(res, 404, { error: 'Not found' });
  const headers = { 'Content-Type': type || TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    let start = range[1] ? +range[1] : stat.size - +range[2];
    let end = range[1] && range[2] ? +range[2] : stat.size - 1;
    if (start >= stat.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// Live preview: proxy MediaMTX HLS with the engine's credentials, only for signed-in owners.
async function preview(req, res, rest) {
  if (!/^(live|src)\/[\w-]+\/[\w.-]+$/.test(rest)) return send(res, 404, { error: 'Not found' });
  try {
    const upstream = await fetch(`${config.MEDIAMTX_HLS}/${rest}`, {
      headers: { Authorization: `Bearer ${config.HLS_CDN_SECRET}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    send(res, 502, { error: 'Preview unavailable' });
  }
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://studio');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/api/')) {
      const m = r.match(req.method, p);
      if (!m) return send(res, 404, { error: 'Not found' });
      // CSRF defence in depth: SameSite=Strict cookie + a custom header browsers will not send cross-site.
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'stream-studio') return send(res, 403, { error: 'Missing request header' });
      if (!m.opts.public) auth.requireAuth(req);
      return await m.handler(req, res, m.params, url);
    }
    if (p.startsWith('/files/') || p.startsWith('/preview/')) {
      auth.requireAuth(req);
      if (p.startsWith('/preview/')) return await preview(req, res, p.slice('/preview/'.length));
      let m;
      if ((m = /^\/files\/thumbs\/([a-f0-9]+)\.jpg$/.exec(p))) return serveFile(req, res, path.join(config.THUMBS, `${m[1]}.jpg`), { cache: 'private, max-age=300' });
      if ((m = /^\/files\/variants\/([a-f0-9]+)$/.exec(p))) {
        const v = get("SELECT file FROM variants WHERE id = ? AND status = 'ready'", m[1]);
        if (v) return serveFile(req, res, path.join(config.PROCESSED, v.file), { cache: 'private, max-age=3600', type: 'video/mp4' });
      }
      if ((m = /^\/files\/originals\/([a-f0-9]+)$/.exec(p))) {
        const o = get('SELECT original_file FROM media WHERE id = ?', m[1]);
        if (o) return serveFile(req, res, path.join(config.ORIGINALS, o.original_file), { cache: 'private, max-age=3600' });
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (p === '/healthz') return send(res, 200, { ok: true });
    // Static dashboard
    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, { error: 'Not found' });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(req, res, file);
    return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.status ? e.message : 'Internal error' });
  }
});
server.requestTimeout = 0; // large upload chunks on slow connections
server.listen(config.WEB_PORT, config.WEB_HOST, () => console.log(`[web] dashboard on http://${config.WEB_HOST}:${config.WEB_PORT}`));
