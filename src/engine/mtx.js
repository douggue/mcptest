// Talks to the MediaMTX control API.
const config = require('../config');

const relayUrl = (pathName) => `${config.MEDIAMTX_RTMP}/${pathName}?user=engine&pass=${config.INTERNAL_TOKEN}`;

async function pathInfo(pathName) {
  try {
    const r = await fetch(`${config.MEDIAMTX_API}/v3/paths/get/${pathName.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(3000) });
    if (r.status === 404) return { ready: false };
    if (!r.ok) return { ready: false, error: `API ${r.status}` };
    const j = await r.json();
    return { ready: !!j.ready, readers: (j.readers || []).length, bytesReceived: j.bytesReceived, tracks: j.tracks || [] };
  } catch (e) {
    return { ready: false, error: e.message };
  }
}

async function reachable() {
  try {
    const r = await fetch(`${config.MEDIAMTX_API}/v3/paths/list`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

module.exports = { relayUrl, pathInfo, reachable };
