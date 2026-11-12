// Checks a broadcast can actually go out before it starts (and on demand from the dashboard).
const fs = require('fs');
const config = require('../config');
const { all, get, mappers } = require('../db');
const { PLATFORMS } = require('../platforms');
const media = require('../media');
const mtx = require('./mtx');

const FORMAT_LABEL = { landscape: '16:9', portrait: '9:16' };

function sourceItems(b) {
  const s = b.source;
  if (s.type === 'media') return [s.mediaId];
  if (s.type === 'playlist') {
    const p = mappers.playlist(get('SELECT * FROM playlists WHERE id = ?', s.playlistId));
    return p ? p.items : null;
  }
  return [];
}

async function preflight(b, { prepareMissing = false } = {}) {
  const checks = [];
  const add = (level, label, detail = '') => checks.push({ level, label, detail });
  const prerecorded = b.source.type !== 'live';

  // Destinations
  const destinations = [];
  if (!b.destination_ids.length) add('error', 'No destinations selected');
  for (const id of b.destination_ids) {
    const d = mappers.destination(get('SELECT * FROM destinations WHERE id = ?', id));
    if (!d) { add('warn', 'A selected destination was deleted'); continue; }
    const plat = PLATFORMS[d.platform] || PLATFORMS.custom;
    let blocked = null;
    if (!d.enabled) blocked = 'Destination is turned off';
    else if (!d.key_enc && d.platform !== 'custom') blocked = 'Stream key missing';
    else if (plat.gated && !d.authorized) blocked = `${plat.name} LIVE encoder access not confirmed in destination settings`;
    else if (plat.gated && prerecorded && !d.allow_prerecorded) blocked = `${plat.name} is limited to real-time LIVE; pre-recorded broadcasts are blocked for this destination`;
    destinations.push({ dest: d, blocked });
    if (blocked) add(d.enabled ? 'error' : 'warn', `${d.name}: ${blocked}`);
    else {
      add('ok', `${d.name} ready`, plat.name);
      if (!plat.formats.includes(b.orientation)) add('warn', `${d.name}: ${plat.name} usually expects ${plat.formats.map((f) => FORMAT_LABEL[f]).join(' / ')}`);
    }
  }

  // Source
  const items = [];
  let totalDuration = 0;
  if (b.source.type === 'live') {
    add('ok', 'Live input from OBS / encoder', 'Outputs start as soon as your encoder connects');
  } else {
    const ids = sourceItems(b);
    if (ids === null) add('error', 'Playlist not found');
    else if (!ids.length) add('error', 'Nothing to play', 'Add videos to the playlist');
    const missing = [];
    for (const mid of ids || []) {
      const m = get('SELECT * FROM media WHERE id = ?', mid);
      if (!m) { add('warn', 'A video in the playlist was deleted'); continue; }
      const v = get('SELECT * FROM variants WHERE media_id = ? AND profile = ?', mid, b.orientation);
      if (v && v.status === 'ready' && v.file && fs.existsSync(`${config.PROCESSED}/${v.file}`)) {
        items.push({ media: m, file: `${config.PROCESSED}/${v.file}` });
        totalDuration += m.duration || 0;
      } else {
        const state = !v ? 'not prepared' : v.status === 'processing' ? `preparing ${Math.round((v.progress || 0) * 100)}%` : v.status === 'queued' ? 'queued for preparation' : `failed: ${v.error}`;
        missing.push(m);
        add('error', `"${m.title}" needs a ${FORMAT_LABEL[b.orientation]} version`, state);
        if (prepareMissing && (!v || v.status === 'error')) media.enqueue(mid, b.orientation);
      }
    }
    if (items.length && !missing.length) add('ok', `${items.length} video${items.length > 1 ? 's' : ''} ready in ${FORMAT_LABEL[b.orientation]}`, fmtDur(totalDuration));
    if (b.loop && !b.duration_min) add('warn', 'Loops until you press Stop', 'Set a duration to end automatically');
  }

  // Infrastructure
  if (!(await mtx.reachable())) add('error', 'Media relay (MediaMTX) is not reachable');
  try {
    const s = fs.statfsSync(config.DATA_DIR);
    const free = s.bavail * s.bsize;
    if (free < config.MIN_FREE_BYTES) add('warn', 'Low disk space', `${(free / 1024 ** 3).toFixed(1)} GB free`);
  } catch { /* ignore */ }

  const usable = destinations.filter((d) => !d.blocked);
  const fatal = checks.some((c) => c.level === 'error' && !destinations.some((d) => d.blocked && c.label.startsWith(d.dest.name + ':')));
  const ok = !fatal && usable.length > 0;
  if (!usable.length && b.destination_ids.length) add('error', 'No destination can receive this broadcast');
  return { ok, checks, destinations, items, totalDuration };
}

function fmtDur(s) {
  s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : `${m}m ${sec}s`;
}

module.exports = { preflight, sourceItems };
