// Dashboard REST API. Reads/writes the shared database and delegates media and broadcast
// work to the engine process.
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const config = require('../config');
const { all, get, run, newId, prefs, setSetting, DEFAULT_PREFS, logEvent, mappers } = require('../db');
const { encrypt, decrypt, token } = require('../crypto');
const { readJson, send, httpError, router } = require('../http');
const { PLATFORMS, validateServerUrl } = require('../platforms');
const { nextAfter, isValidTz } = require('../schedule');
const auth = require('./auth');

const r = router();
const ACTIVE = "('starting','waiting','live','ending')";
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.ts', '.flv']);

async function engine(method, p, body) {
  let res;
  try {
    res = await fetch(config.ENGINE_URL + p, {
      method, headers: { 'Content-Type': 'application/json', 'x-internal-token': config.INTERNAL_TOKEN },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw httpError(503, 'Streaming engine is offline');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(res.status, data.error || `Engine error ${res.status}`);
  return data;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function publicHost(req) {
  return config.PUBLIC_HOST || String(req.headers['x-forwarded-host'] || req.headers.host || 'your-server').replace(/:\d+$/, '');
}

// ---------- Auth ----------
r.add('GET', '/api/auth/state', (req, res) => send(res, 200, auth.state(req)), { public: true });
r.add('POST', '/api/auth/setup', async (req, res) => { auth.setup(req, res, await readJson(req)); send(res, 200, auth.state(req)); }, { public: true });
r.add('POST', '/api/auth/login', async (req, res) => send(res, 200, auth.login(req, res, await readJson(req))), { public: true });
r.add('POST', '/api/auth/mfa', async (req, res) => { auth.mfaVerify(req, await readJson(req)); send(res, 200, { ok: true }); }, { public: true });
r.add('POST', '/api/auth/logout', (req, res) => { auth.logout(req, res); send(res, 200, { ok: true }); }, { public: true });
r.add('POST', '/api/auth/password', async (req, res) => { auth.changePassword(req, await readJson(req)); send(res, 200, { ok: true }); });
r.add('POST', '/api/auth/mfa/begin', (req, res) => send(res, 200, auth.mfaBegin()));
r.add('POST', '/api/auth/mfa/enable', async (req, res) => { auth.mfaEnable(await readJson(req)); send(res, 200, { ok: true }); });
r.add('POST', '/api/auth/mfa/disable', async (req, res) => { auth.mfaDisable(await readJson(req)); send(res, 200, { ok: true }); });

// ---------- Meta & settings ----------
r.add('GET', '/api/meta', (req, res) => send(res, 200, {
  platforms: PLATFORMS, prefs: prefs(),
  ingest: { server: `rtmp://${publicHost(req)}:${config.RTMP_PUBLIC_PORT}/live` },
}));

r.add('PUT', '/api/settings', async (req, res) => {
  const b = await readJson(req);
  const p = prefs();
  const next = { ...p };
  if (b.timezone !== undefined) { if (!isValidTz(b.timezone)) throw httpError(400, 'Unknown time zone'); next.timezone = b.timezone; }
  if (b.quality !== undefined) next.quality = b.quality === '720' ? '720' : '1080';
  if (b.autoPrepare !== undefined) next.autoPrepare = b.autoPrepare === 'both' ? 'both' : 'native';
  if (b.defaultFit !== undefined) next.defaultFit = ['blur', 'pad', 'crop'].includes(b.defaultFit) ? b.defaultFit : 'blur';
  for (const [k, lo, hi] of [['missedWindowMin', 0, 1440], ['maxConcurrent', 1, 10], ['maxRetries', 0, 10]]) {
    if (b[k] !== undefined) next[k] = Math.min(hi, Math.max(lo, parseInt(b[k], 10) || DEFAULT_PREFS[k]));
  }
  if (b.webhookUrl !== undefined) {
    const u = str(b.webhookUrl, 500);
    if (u && !/^https:\/\//.test(u)) throw httpError(400, 'Webhook URL must start with https://');
    next.webhookUrl = u;
  }
  setSetting('prefs', next);
  logEvent('info', 'settings', 'Settings updated');
  send(res, 200, next);
});
r.add('POST', '/api/settings/test-webhook', async (req, res) => send(res, 200, await engine('POST', '/notify/test', await readJson(req))));

// ---------- Overview / health / events ----------
r.add('GET', '/api/live', async (req, res) => send(res, 200, await engine('GET', '/live').catch(() => [])));
r.add('GET', '/api/health', async (req, res) => send(res, 200, await engine('GET', '/health').catch((e) => ({ ok: false, error: e.message }))));

r.add('GET', '/api/overview', async (req, res) => {
  const [live, health] = await Promise.all([
    engine('GET', '/live').catch(() => []),
    engine('GET', '/health').catch((e) => ({ ok: false, error: e.message })),
  ]);
  const now = Date.now();
  const upcoming = all('SELECT * FROM broadcasts WHERE enabled = 1').map(mappers.broadcast)
    .map((b) => ({ id: b.id, title: b.title, orientation: b.orientation, sourceType: b.source.type, destinationIds: b.destination_ids, at: nextAfter(b.schedule, Math.max(now, b.cursor || 0)) }))
    .filter((u) => u.at).sort((a, b) => a.at - b.at).slice(0, 6);
  const counts = {
    media: get('SELECT COUNT(*) n FROM media').n,
    destinations: get('SELECT COUNT(*) n FROM destinations WHERE enabled = 1').n,
    broadcasts: get('SELECT COUNT(*) n FROM broadcasts').n,
    runs7d: get("SELECT COUNT(*) n FROM runs WHERE created_at > ? AND state NOT IN ('missed')", now - 7 * 86400000).n,
    failed7d: get("SELECT COUNT(*) n FROM runs WHERE created_at > ? AND state IN ('failed','blocked','missed')", now - 7 * 86400000).n,
  };
  const events = all('SELECT * FROM events ORDER BY id DESC LIMIT 12');
  send(res, 200, { live, health, upcoming, counts, events, destinations: all('SELECT id, name, platform FROM destinations') });
});

r.add('GET', '/api/events', (req, res, p, url) => {
  const where = [], args = [];
  const level = url.searchParams.get('level'), cat = url.searchParams.get('category'), before = url.searchParams.get('before');
  if (level) { where.push('level = ?'); args.push(level); }
  if (cat) { where.push('category = ?'); args.push(cat); }
  if (before) { where.push('id < ?'); args.push(+before); }
  send(res, 200, all(`SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`, ...args));
});

// ---------- Media ----------
function mediaList() {
  const variants = all('SELECT id, media_id, profile, fit, quality, status, progress, error, size FROM variants');
  const usage = new Map();
  for (const b of all('SELECT title, source FROM broadcasts')) {
    const s = JSON.parse(b.source);
    if (s.type === 'media') usage.set(s.mediaId, [...(usage.get(s.mediaId) || []), b.title]);
  }
  return all('SELECT * FROM media ORDER BY created_at DESC').map((m) => ({
    ...m, variants: variants.filter((v) => v.media_id === m.id), usedBy: usage.get(m.id) || [],
  }));
}
r.add('GET', '/api/media', (req, res) => send(res, 200, mediaList()));
r.add('PATCH', '/api/media/:id', async (req, res, p) => {
  const b = await readJson(req);
  const title = str(b.title, 150);
  if (!title) throw httpError(400, 'Title is required');
  run('UPDATE media SET title = ? WHERE id = ?', title, p.id);
  send(res, 200, { ok: true });
});
r.add('DELETE', '/api/media/:id', async (req, res, p) => {
  const inUse = all('SELECT title, source FROM broadcasts').filter((b) => JSON.parse(b.source).mediaId === p.id);
  if (inUse.length) throw httpError(409, `Used by broadcast "${inUse[0].title}". Change or delete it first.`);
  for (const pl of all('SELECT * FROM playlists').map(mappers.playlist)) {
    if (pl.items.includes(p.id)) run('UPDATE playlists SET items = ? WHERE id = ?', JSON.stringify(pl.items.filter((i) => i !== p.id)), pl.id);
  }
  await engine('DELETE', `/media/${p.id}`);
  logEvent('info', 'media', 'Video deleted', p.id);
  send(res, 200, { ok: true });
});
r.add('POST', '/api/media/:id/prepare', async (req, res, p) => {
  const b = await readJson(req);
  if (!['landscape', 'portrait'].includes(b.profile)) throw httpError(400, 'Choose 16:9 or 9:16');
  send(res, 202, await engine('POST', `/media/${p.id}/prepare`, { profile: b.profile, fit: b.fit, quality: b.quality }));
});

// Resumable uploads: init → PUT chunks at offsets → complete.
function diskFree() {
  try { const s = fs.statfsSync(config.DATA_DIR); return s.bavail * s.bsize; } catch { return Infinity; }
}
r.add('POST', '/api/uploads', async (req, res) => {
  const b = await readJson(req);
  const filename = str(b.filename, 255);
  const size = parseInt(b.size, 10);
  if (!filename || !VIDEO_EXT.has(path.extname(filename).toLowerCase())) throw httpError(400, 'Upload an MP4, MOV, MKV, WEBM, M4V or AVI video');
  if (!(size > 0) || size > config.MAX_UPLOAD_BYTES) throw httpError(400, `Files up to ${config.MAX_UPLOAD_BYTES / 1024 ** 3} GB are supported`);
  // Need room for the original plus two prepared formats.
  if (diskFree() - size * 2 < config.MIN_FREE_BYTES) throw httpError(507, 'Not enough free disk space for this upload');
  const id = newId();
  run('INSERT INTO uploads (id, filename, size, received, created_at) VALUES (?, ?, ?, 0, ?)', id, filename, size, Date.now());
  fs.writeFileSync(path.join(config.UPLOADS, `${id}.part`), '');
  send(res, 200, { id, received: 0 });
});
r.add('GET', '/api/uploads/:id', (req, res, p) => {
  const u = get('SELECT * FROM uploads WHERE id = ?', p.id);
  if (!u) throw httpError(404, 'Upload not found');
  send(res, 200, { id: u.id, received: u.received, size: u.size });
});
r.add('PUT', '/api/uploads/:id', async (req, res, p, url) => {
  const u = get('SELECT * FROM uploads WHERE id = ?', p.id);
  if (!u) throw httpError(404, 'Upload not found');
  const offset = parseInt(url.searchParams.get('offset'), 10);
  if (offset !== u.received) return send(res, 409, { error: 'Offset mismatch', received: u.received });
  const file = path.join(config.UPLOADS, `${u.id}.part`);
  let written = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file, { flags: 'r+', start: offset });
    req.on('data', (c) => {
      written += c.length;
      if (offset + written > u.size || written > 64 * 1024 * 1024) { req.destroy(); out.destroy(); reject(httpError(413, 'Chunk too large')); }
    });
    req.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    req.on('error', reject);
  });
  run('UPDATE uploads SET received = ? WHERE id = ?', offset + written, u.id);
  send(res, 200, { received: offset + written });
});
r.add('POST', '/api/uploads/:id/complete', async (req, res, p) => {
  const u = get('SELECT * FROM uploads WHERE id = ?', p.id);
  if (!u) throw httpError(404, 'Upload not found');
  if (u.received !== u.size) throw httpError(400, 'Upload is incomplete');
  const b = await readJson(req);
  const mediaId = newId();
  const ext = path.extname(u.filename).toLowerCase();
  const original = `${mediaId}${ext}`;
  fs.renameSync(path.join(config.UPLOADS, `${u.id}.part`), path.join(config.ORIGINALS, original));
  const title = str(b.title, 150) || path.basename(u.filename, ext).replace(/[_-]+/g, ' ');
  run("INSERT INTO media (id, title, original_file, original_name, size, status, created_at) VALUES (?, ?, ?, ?, ?, 'uploaded', ?)",
    mediaId, title, original, u.filename, u.size, Date.now());
  run('DELETE FROM uploads WHERE id = ?', u.id);
  logEvent('info', 'media', `Uploaded "${title}"`, mediaId);
  await engine('POST', `/media/${mediaId}/ingest`).catch(() => {}); // engine picks it up on boot otherwise
  send(res, 200, { id: mediaId });
});
r.add('DELETE', '/api/uploads/:id', (req, res, p) => {
  fs.rmSync(path.join(config.UPLOADS, `${p.id}.part`), { force: true });
  run('DELETE FROM uploads WHERE id = ?', p.id);
  send(res, 200, { ok: true });
});

// ---------- Playlists ----------
function validatePlaylist(b) {
  const title = str(b.title, 120);
  if (!title) throw httpError(400, 'Name the playlist');
  const items = Array.isArray(b.items) ? b.items.filter((i) => typeof i === 'string' && get('SELECT id FROM media WHERE id = ?', i)) : [];
  return { title, items: JSON.stringify(items.slice(0, 500)), shuffle: b.shuffle ? 1 : 0 };
}
r.add('GET', '/api/playlists', (req, res) => send(res, 200, all('SELECT * FROM playlists ORDER BY created_at DESC').map(mappers.playlist)));
r.add('POST', '/api/playlists', async (req, res) => {
  const v = validatePlaylist(await readJson(req));
  const id = newId();
  run('INSERT INTO playlists (id, title, items, shuffle, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, v.title, v.items, v.shuffle, Date.now(), Date.now());
  send(res, 200, { id });
});
r.add('PUT', '/api/playlists/:id', async (req, res, p) => {
  const v = validatePlaylist(await readJson(req));
  run('UPDATE playlists SET title = ?, items = ?, shuffle = ?, updated_at = ? WHERE id = ?', v.title, v.items, v.shuffle, Date.now(), p.id);
  send(res, 200, { ok: true });
});
r.add('DELETE', '/api/playlists/:id', (req, res, p) => {
  const used = all('SELECT title, source FROM broadcasts').find((b) => JSON.parse(b.source).playlistId === p.id);
  if (used) throw httpError(409, `Used by broadcast "${used.title}"`);
  run('DELETE FROM playlists WHERE id = ?', p.id);
  send(res, 200, { ok: true });
});

// ---------- Destinations ----------
function destOut(d) {
  d = mappers.destination(d);
  let keyHint = null;
  if (d.key_enc) { try { const k = decrypt(d.key_enc); keyHint = '••••' + k.slice(-4); } catch { keyHint = 'unreadable'; } }
  const { key_enc, ...rest } = d;
  return { ...rest, keySet: !!key_enc, keyHint };
}
function validateDest(b, existing) {
  const platform = PLATFORMS[b.platform] ? b.platform : existing?.platform;
  if (!platform) throw httpError(400, 'Choose a platform');
  const name = str(b.name, 80) || existing?.name || PLATFORMS[platform].name;
  const server = str(b.server_url, 500) || existing?.server_url || PLATFORMS[platform].servers[0] || '';
  const err = validateServerUrl(server);
  if (err) throw httpError(400, err);
  const gated = !!PLATFORMS[platform].gated;
  return {
    name, platform, server_url: server,
    enabled: b.enabled === undefined ? (existing ? existing.enabled : 1) : (b.enabled ? 1 : 0),
    authorized: gated ? +(b.authorized === undefined ? !!existing?.authorized : !!b.authorized) : 1,
    allow_prerecorded: gated ? +(b.allow_prerecorded === undefined ? !!existing?.allow_prerecorded : !!b.allow_prerecorded) : 1,
    notes: b.notes === undefined ? (existing?.notes || '') : str(b.notes, 500),
  };
}
r.add('GET', '/api/destinations', (req, res) => send(res, 200, all('SELECT * FROM destinations ORDER BY created_at').map(destOut)));
r.add('POST', '/api/destinations', async (req, res) => {
  const b = await readJson(req);
  const v = validateDest(b);
  const key = str(b.key, 500);
  if (!key && v.platform !== 'custom') throw httpError(400, 'Paste the stream key');
  const id = newId();
  run('INSERT INTO destinations (id, name, platform, server_url, key_enc, enabled, authorized, allow_prerecorded, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, v.name, v.platform, v.server_url, encrypt(key), v.enabled, v.authorized, v.allow_prerecorded, v.notes, Date.now(), Date.now());
  logEvent('info', 'destinations', `Added destination "${v.name}" (${PLATFORMS[v.platform].name})`, id);
  send(res, 200, { id });
});
r.add('PUT', '/api/destinations/:id', async (req, res, p) => {
  const existing = get('SELECT * FROM destinations WHERE id = ?', p.id);
  if (!existing) throw httpError(404, 'Destination not found');
  const b = await readJson(req);
  const v = validateDest(b, existing);
  const key = str(b.key, 500);
  const keyEnc = key ? encrypt(key) : existing.key_enc;
  run('UPDATE destinations SET name=?, platform=?, server_url=?, key_enc=?, enabled=?, authorized=?, allow_prerecorded=?, notes=?, updated_at=? WHERE id=?',
    v.name, v.platform, v.server_url, keyEnc, v.enabled, v.authorized, v.allow_prerecorded, v.notes, Date.now(), p.id);
  logEvent('info', 'destinations', `Updated destination "${v.name}"${key ? ' (new stream key)' : ''}`, p.id);
  send(res, 200, { ok: true });
});
r.add('DELETE', '/api/destinations/:id', (req, res, p) => {
  const d = get('SELECT name FROM destinations WHERE id = ?', p.id);
  for (const b of all('SELECT id, destination_ids FROM broadcasts')) {
    const ids = JSON.parse(b.destination_ids);
    if (ids.includes(p.id)) run('UPDATE broadcasts SET destination_ids = ? WHERE id = ?', JSON.stringify(ids.filter((i) => i !== p.id)), b.id);
  }
  run('DELETE FROM destinations WHERE id = ?', p.id);
  if (d) logEvent('info', 'destinations', `Deleted destination "${d.name}"`);
  send(res, 200, { ok: true });
});
// Reachability test: TCP (rtmp) or TLS handshake (rtmps) to the ingest server. It does not
// send video, so it never starts a broadcast on the platform.
r.add('POST', '/api/destinations/:id/test', async (req, res, p) => {
  const d = get('SELECT * FROM destinations WHERE id = ?', p.id);
  if (!d) throw httpError(404, 'Destination not found');
  const u = new URL(d.server_url);
  const secure = u.protocol === 'rtmps:';
  const port = parseInt(u.port, 10) || (secure ? 443 : 1935);
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const done = (ok, error) => { sock.destroy(); resolve({ ok, error, ms: Date.now() - started, at: Date.now() }); };
    const sock = secure
      ? tls.connect({ host: u.hostname, port, servername: u.hostname, timeout: 6000 }, () => done(true))
      : net.connect({ host: u.hostname, port, timeout: 6000 }, () => done(true));
    sock.on('timeout', () => done(false, 'Timed out'));
    sock.on('error', (e) => done(false, e.message));
  });
  if (!d.key_enc && d.platform !== 'custom') { result.ok = false; result.error = 'Server reachable, but no stream key is saved'; }
  run('UPDATE destinations SET last_test = ? WHERE id = ?', JSON.stringify(result), d.id);
  send(res, 200, result);
});

// ---------- Broadcasts ----------
function validateBroadcast(b) {
  const title = str(b.title, 120);
  if (!title) throw httpError(400, 'Give the broadcast a title');
  const s = b.source || {};
  let source;
  if (s.type === 'live') source = { type: 'live' };
  else if (s.type === 'media') { if (!get('SELECT id FROM media WHERE id = ?', s.mediaId)) throw httpError(400, 'Choose a video'); source = { type: 'media', mediaId: s.mediaId }; }
  else if (s.type === 'playlist') { if (!get('SELECT id FROM playlists WHERE id = ?', s.playlistId)) throw httpError(400, 'Choose a playlist'); source = { type: 'playlist', playlistId: s.playlistId }; }
  else throw httpError(400, 'Choose what to stream');
  const orientation = b.orientation === 'portrait' ? 'portrait' : 'landscape';
  const destinationIds = (Array.isArray(b.destination_ids) ? b.destination_ids : []).filter((id) => get('SELECT id FROM destinations WHERE id = ?', id));
  const sc = b.schedule || { type: 'manual' };
  let schedule;
  if (sc.type === 'once') {
    const t = new Date(sc.at).getTime();
    if (!t) throw httpError(400, 'Pick a start date and time');
    schedule = { type: 'once', at: new Date(t).toISOString(), tz: isValidTz(sc.tz) ? sc.tz : prefs().timezone };
  } else if (sc.type === 'recurring') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sc.time || '')) throw httpError(400, 'Pick a start time');
    const days = [...new Set((sc.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if (!days.length) throw httpError(400, 'Pick at least one day');
    const tz = isValidTz(sc.tz) ? sc.tz : prefs().timezone;
    const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
    schedule = { type: 'recurring', time: sc.time, days, tz, from: date(sc.from), until: date(sc.until) };
  } else schedule = { type: 'manual' };
  let duration = b.duration_min === '' || b.duration_min == null ? null : Number(b.duration_min);
  if (duration != null && !(duration > 0 && duration <= 7 * 24 * 60)) throw httpError(400, 'Duration must be between 1 minute and 7 days');
  return { title, source, orientation, destinationIds, schedule, duration, loop: source.type !== 'live' && !!b.loop, enabled: b.enabled === undefined ? true : !!b.enabled };
}

function estimateLength(b) {
  if (b.duration_min) return b.duration_min * 60000;
  if (b.source.type === 'media') return (get('SELECT duration FROM media WHERE id = ?', b.source.mediaId)?.duration || 3600) * 1000;
  if (b.source.type === 'playlist' && !b.loop) {
    const pl = mappers.playlist(get('SELECT * FROM playlists WHERE id = ?', b.source.playlistId));
    return (pl?.items || []).reduce((t, id) => t + (get('SELECT duration FROM media WHERE id = ?', id)?.duration || 0), 0) * 1000 || 3600000;
  }
  return 3600000;
}

// Warn (but do not block) when two broadcasts would use the same destination at the same time.
function overlapWarnings(target) {
  const horizon = Date.now() + 14 * 86400000;
  const occurrences = (b) => {
    const out = []; let t = Date.now() - estimateLength(b);
    for (let i = 0; i < 60; i++) { t = nextAfter(b.schedule, t); if (!t || t > horizon) break; out.push([t, t + estimateLength(b)]); }
    return out;
  };
  const mine = occurrences(target);
  const warnings = [];
  for (const other of all('SELECT * FROM broadcasts WHERE enabled = 1 AND id != ?', target.id || '').map(mappers.broadcast)) {
    const shared = other.destination_ids.filter((d) => target.destination_ids.includes(d));
    if (!shared.length) continue;
    const theirs = occurrences(other);
    const hit = mine.find(([a1, a2]) => theirs.some(([b1, b2]) => a1 < b2 && b1 < a2));
    if (hit) {
      const names = shared.map((id) => get('SELECT name FROM destinations WHERE id = ?', id)?.name).filter(Boolean).join(', ');
      warnings.push(`Overlaps with "${other.title}" on ${names} around ${new Date(hit[0]).toISOString()}`);
    }
  }
  return warnings;
}

function broadcastOut(b, req) {
  b = mappers.broadcast(b);
  const now = Date.now();
  const activeRun = get(`SELECT * FROM runs WHERE broadcast_id = ? AND state IN ${ACTIVE} ORDER BY created_at DESC LIMIT 1`, b.id);
  const lastRun = get(`SELECT * FROM runs WHERE broadcast_id = ? AND state NOT IN ${ACTIVE} ORDER BY created_at DESC LIMIT 1`, b.id);
  return {
    ...b,
    next_at: b.enabled ? nextAfter(b.schedule, Math.max(now, b.cursor || 0)) : null,
    active_run: activeRun || null, last_run: lastRun || null,
    ingest: b.source.type === 'live' ? { server: `rtmp://${publicHost(req)}:${config.RTMP_PUBLIC_PORT}/live`, key: b.ingest_key } : null,
  };
}

r.add('GET', '/api/broadcasts', (req, res) => send(res, 200, all('SELECT * FROM broadcasts ORDER BY created_at DESC').map((b) => broadcastOut(b, req))));
r.add('GET', '/api/broadcasts/:id', (req, res, p) => {
  const b = get('SELECT * FROM broadcasts WHERE id = ?', p.id);
  if (!b) throw httpError(404, 'Broadcast not found');
  const runs = all('SELECT * FROM runs WHERE broadcast_id = ? ORDER BY created_at DESC LIMIT 30', p.id).map((rr) => ({
    ...rr, outputs: all('SELECT o.*, d.name, d.platform FROM run_outputs o LEFT JOIN destinations d ON d.id = o.destination_id WHERE run_id = ?', rr.id),
  }));
  send(res, 200, { ...broadcastOut(b, req), runs });
});
r.add('POST', '/api/broadcasts', async (req, res) => {
  const v = validateBroadcast(await readJson(req));
  const id = newId();
  const now = Date.now();
  run('INSERT INTO broadcasts (id, title, source, orientation, destination_ids, schedule, duration_min, loop, enabled, cursor, ingest_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, v.title, JSON.stringify(v.source), v.orientation, JSON.stringify(v.destinationIds), JSON.stringify(v.schedule), v.duration, v.loop ? 1 : 0, v.enabled ? 1 : 0, now, token(18), now, now);
  logEvent('info', 'broadcasts', `Created broadcast "${v.title}"`, id);
  const b = get('SELECT * FROM broadcasts WHERE id = ?', id);
  send(res, 200, { id, warnings: overlapWarnings(mappers.broadcast(b)) });
});
r.add('PUT', '/api/broadcasts/:id', async (req, res, p) => {
  const existing = mappers.broadcast(get('SELECT * FROM broadcasts WHERE id = ?', p.id));
  if (!existing) throw httpError(404, 'Broadcast not found');
  const v = validateBroadcast(await readJson(req));
  const scheduleChanged = JSON.stringify(v.schedule) !== JSON.stringify(existing.schedule) || (v.enabled && !existing.enabled);
  run('UPDATE broadcasts SET title=?, source=?, orientation=?, destination_ids=?, schedule=?, duration_min=?, loop=?, enabled=?, cursor=?, updated_at=? WHERE id=?',
    v.title, JSON.stringify(v.source), v.orientation, JSON.stringify(v.destinationIds), JSON.stringify(v.schedule), v.duration, v.loop ? 1 : 0, v.enabled ? 1 : 0,
    scheduleChanged ? Date.now() : existing.cursor, Date.now(), p.id);
  logEvent('info', 'broadcasts', `Updated broadcast "${v.title}"`, p.id);
  send(res, 200, { ok: true, warnings: overlapWarnings(mappers.broadcast(get('SELECT * FROM broadcasts WHERE id = ?', p.id))) });
});
r.add('DELETE', '/api/broadcasts/:id', async (req, res, p) => {
  if (get(`SELECT id FROM runs WHERE broadcast_id = ? AND state IN ${ACTIVE}`, p.id)) throw httpError(409, 'Stop this broadcast before deleting it');
  const b = get('SELECT title FROM broadcasts WHERE id = ?', p.id);
  run('DELETE FROM broadcasts WHERE id = ?', p.id);
  if (b) logEvent('info', 'broadcasts', `Deleted broadcast "${b.title}"`);
  send(res, 200, { ok: true });
});
r.add('POST', '/api/broadcasts/:id/duplicate', (req, res, p) => {
  const b = get('SELECT * FROM broadcasts WHERE id = ?', p.id);
  if (!b) throw httpError(404, 'Broadcast not found');
  const id = newId(); const now = Date.now();
  run('INSERT INTO broadcasts (id, title, source, orientation, destination_ids, schedule, duration_min, loop, enabled, cursor, ingest_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)',
    id, `${b.title} (copy)`, b.source, b.orientation, b.destination_ids, b.schedule, b.duration_min, b.loop, now, token(18), now, now);
  send(res, 200, { id });
});
r.add('POST', '/api/broadcasts/:id/rotate-key', (req, res, p) => {
  run('UPDATE broadcasts SET ingest_key = ? WHERE id = ?', token(18), p.id);
  logEvent('info', 'security', 'Live ingest key rotated', p.id);
  send(res, 200, { ok: true });
});
r.add('POST', '/api/broadcasts/:id/start', async (req, res, p) => send(res, 200, await engine('POST', `/broadcasts/${p.id}/start`)));
r.add('POST', '/api/broadcasts/:id/stop', async (req, res, p) => send(res, 200, await engine('POST', `/broadcasts/${p.id}/stop`)));
r.add('POST', '/api/broadcasts/:id/preflight', async (req, res, p) => send(res, 200, await engine('POST', `/broadcasts/${p.id}/preflight`, await readJson(req))));
r.add('POST', '/api/runs/:id/stop', async (req, res, p) => send(res, 200, await engine('POST', `/runs/${p.id}/stop`)));
r.add('POST', '/api/runs/:id/outputs/:dest/retry', async (req, res, p) => send(res, 200, await engine('POST', `/runs/${p.id}/outputs/${p.dest}/retry`)));

module.exports = { r };
