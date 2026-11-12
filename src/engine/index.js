// Stream Studio engine: scheduler, broadcast workers, media preparation and the MediaMTX
// auth hook. Runs as its own process so restarting the dashboard never touches a live stream.
const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const config = require('../config');
const { all, get, run, newId, prefs, logEvent, mappers } = require('../db');
const { readJson, send, httpError, router } = require('../http');
const { latestDue } = require('../schedule');
const media = require('../media');
const { notify } = require('../notify');
const { RunController, ACTIVE_STATES } = require('./runner');
const { preflight } = require('./preflight');
const mtx = require('./mtx');

const active = new Map(); // runId -> RunController
const bootAt = Date.now();

function loadBroadcast(id) { return mappers.broadcast(get('SELECT * FROM broadcasts WHERE id = ?', id)); }

function activeRunFor(broadcastId) {
  for (const c of active.values()) if (c.b.id === broadcastId) return c;
  return null;
}

// Create a run row and start it. scheduledFor makes scheduled starts idempotent: the UNIQUE
// (broadcast_id, scheduled_for) constraint means a given occurrence can only ever start once.
async function startBroadcast(broadcastId, { trigger = 'manual', scheduledFor = Date.now() } = {}) {
  const b = loadBroadcast(broadcastId);
  if (!b) throw httpError(404, 'Broadcast not found');
  if (activeRunFor(b.id)) throw httpError(409, 'This broadcast is already running');

  const runId = newId();
  try {
    run("INSERT INTO runs (id, broadcast_id, scheduled_for, trigger, state, created_at) VALUES (?, ?, ?, ?, 'starting', ?)",
      runId, b.id, scheduledFor, trigger, Date.now());
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw httpError(409, 'This occurrence was already started');
    throw e;
  }
  if (active.size >= prefs().maxConcurrent) {
    const reason = `Concurrent broadcast limit reached (${prefs().maxConcurrent})`;
    run("UPDATE runs SET state = 'blocked', error = ?, reason = ?, ended_at = ? WHERE id = ?", reason, reason, Date.now(), runId);
    logEvent('error', 'broadcast', `${b.title}: ${reason}`, b.id);
    notify(`Blocked: ${b.title}`, reason, 'error');
    throw httpError(429, reason);
  }
  const row = get('SELECT * FROM runs WHERE id = ?', runId);
  const c = new RunController(row, b, { onDone: (ctl) => active.delete(ctl.id) });
  active.set(runId, c);
  logEvent('info', 'broadcast', `${b.title}: starting (${trigger})`, b.id);
  await c.start();
  return get('SELECT * FROM runs WHERE id = ?', runId);
}

// ---- Scheduler ----
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const p = prefs();
    for (const raw of all("SELECT * FROM broadcasts WHERE enabled = 1 AND json_extract(schedule, '$.type') != 'manual'")) {
      const b = mappers.broadcast(raw);
      const cursor = b.cursor || b.updated_at || b.created_at;
      const due = latestDue(b.schedule, cursor, now);
      if (due == null) continue;
      run('UPDATE broadcasts SET cursor = ? WHERE id = ?', due, b.id);
      const lateMin = (now - due) / 60000;
      if (lateMin > p.missedWindowMin) {
        try {
          run("INSERT INTO runs (id, broadcast_id, scheduled_for, trigger, state, reason, ended_at, created_at) VALUES (?, ?, ?, 'schedule', 'missed', ?, ?, ?)",
            newId(), b.id, due, `Engine was offline at the scheduled time (${Math.round(lateMin)} min late)`, now, now);
        } catch { /* already recorded */ }
        logEvent('warn', 'schedule', `${b.title}: missed start (${Math.round(lateMin)} min late, window ${p.missedWindowMin} min)`, b.id);
        notify(`Missed: ${b.title}`, 'The scheduled start passed while the server was offline', 'warn');
        continue;
      }
      if (activeRunFor(b.id)) { logEvent('warn', 'schedule', `${b.title}: previous run still active, skipping this occurrence`, b.id); continue; }
      startBroadcast(b.id, { trigger: 'schedule', scheduledFor: due }).catch((e) => logEvent('error', 'schedule', `${b.title}: ${e.message}`, b.id));
    }
  } catch (e) {
    console.error('scheduler tick failed', e);
  } finally {
    ticking = false;
  }
}

// ---- Restart reconciliation ----
// Workers from a crashed engine could still be publishing; every worker carries the internal
// token in its relay URL, so we can find and stop exactly ours.
function killOrphans() {
  let killed = 0;
  try {
    for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
      if (+pid === process.pid) continue;
      let cmd;
      try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
      if (cmd.includes('ffmpeg') && cmd.includes(`pass=${config.INTERNAL_TOKEN}`)) { try { process.kill(+pid, 'SIGKILL'); killed++; } catch { /* gone */ } }
    }
  } catch { /* not Linux */ }
  if (killed) logEvent('warn', 'system', `Stopped ${killed} leftover worker process(es) from a previous engine`);
}

async function recover() {
  killOrphans();
  media.recover();
  const stale = all(`SELECT * FROM runs WHERE state IN (${ACTIVE_STATES.map(() => '?').join(',')})`, ...ACTIVE_STATES);
  for (const r of stale) {
    const b = loadBroadcast(r.broadcast_id);
    const now = Date.now();
    if (!b || !b.enabled || (r.ends_at && r.ends_at <= now + 30000)) {
      run("UPDATE runs SET state = 'interrupted', ended_at = ?, reason = 'Server restarted' WHERE id = ?", now, r.id);
      run("UPDATE run_outputs SET state = 'stopped' WHERE run_id = ? AND state NOT IN ('failed','blocked')", r.id);
      continue;
    }
    // Resume where playback would have been, so a reboot does not restart the show.
    const elapsed = r.live_at ? (now - r.live_at) / 1000 : 0;
    logEvent('warn', 'broadcast', `${b.title}: resuming after restart (${Math.round(elapsed)}s in)`, b.id);
    notify(`Resuming: ${b.title}`, 'The server restarted during this broadcast', 'warn');
    run("UPDATE runs SET reason = 'Resumed after restart' WHERE id = ?", r.id);
    const c = new RunController({ ...r, reason: 'Resumed after restart' }, b, { offsetSec: elapsed, onDone: (ctl) => active.delete(ctl.id) });
    active.set(r.id, c);
    c.start().catch((e) => c.finish('failed', e.message));
  }
}

// ---- Health ----
let net = { at: 0, tx: 0, rx: 0, txBps: 0, rxBps: 0 };
function sampleNet() {
  try {
    let tx = 0, rx = 0;
    for (const line of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
      const [iface, rest] = line.split(':');
      if (!rest || iface.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0]; tx += f[8];
    }
    const now = Date.now();
    if (net.at) {
      const dt = (now - net.at) / 1000;
      net.txBps = Math.max(0, ((tx - net.tx) * 8) / dt);
      net.rxBps = Math.max(0, ((rx - net.rx) * 8) / dt);
    }
    net = { ...net, at: now, tx, rx };
  } catch { /* not on Linux */ }
}

let cpuPrev = os.cpus().map((c) => c.times);
let cpuPct = 0;
function sampleCpu() {
  const cur = os.cpus().map((c) => c.times);
  let idle = 0, total = 0;
  cur.forEach((t, i) => {
    const p = cpuPrev[i] || t;
    const tot = Object.values(t).reduce((a, b) => a + b, 0) - Object.values(p).reduce((a, b) => a + b, 0);
    total += tot; idle += t.idle - p.idle;
  });
  cpuPct = total ? Math.round((1 - idle / total) * 100) : 0;
  cpuPrev = cur;
}

async function health() {
  let disk = null;
  try { const s = fs.statfsSync(config.DATA_DIR); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { /* ignore */ }
  const usage = get("SELECT COALESCE(SUM(size),0) AS originals FROM media").originals + get("SELECT COALESCE(SUM(size),0) AS v FROM variants").v;
  const q = get("SELECT SUM(status='queued') AS queued, SUM(status='processing') AS processing FROM variants");
  return {
    ok: true, uptimeSec: Math.round((Date.now() - bootAt) / 1000),
    cpu: { percent: cpuPct, cores: os.cpus().length, load: os.loadavg() },
    memory: { total: os.totalmem(), free: os.freemem() },
    disk, mediaBytes: usage,
    network: { txMbps: +(net.txBps / 1e6).toFixed(2), rxMbps: +(net.rxBps / 1e6).toFixed(2) },
    relay: await mtx.reachable(),
    activeBroadcasts: active.size,
    prepQueue: { queued: q.queued || 0, processing: q.processing || 0 },
  };
}

// ---- MediaMTX auth hook ----
function safeEq(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function authorize(body) {
  const internal = body.user === 'engine' && safeEq(body.password, config.INTERNAL_TOKEN);
  if (internal) return true; // our own playback and output workers, and the dashboard preview proxy
  if (body.action === 'publish' && body.protocol === 'rtmp' && typeof body.path === 'string' && body.path.startsWith('live/')) {
    const key = body.path.slice(5);
    const b = get("SELECT id, title FROM broadcasts WHERE ingest_key = ? AND json_extract(source, '$.type') = 'live'", key);
    if (b) return true;
    logEvent('warn', 'security', `Rejected RTMP publish with an unknown stream key from ${body.ip}`);
  }
  return false;
}

// ---- Internal API (used by the web process only) ----
const r = router();
r.add('GET', '/health', async (req, res) => send(res, 200, await health()));
r.add('GET', '/live', async (req, res) => send(res, 200, [...active.values()].map((c) => c.snapshot())));
r.add('POST', '/broadcasts/:id/start', async (req, res, p) => send(res, 200, await startBroadcast(p.id, { trigger: 'manual' })));
r.add('POST', '/broadcasts/:id/stop', async (req, res, p) => {
  const c = activeRunFor(p.id);
  if (!c) throw httpError(404, 'Broadcast is not running');
  c.stop();
  send(res, 200, { ok: true });
});
r.add('POST', '/broadcasts/:id/preflight', async (req, res, p) => {
  const b = loadBroadcast(p.id);
  if (!b) throw httpError(404, 'Broadcast not found');
  const body = await readJson(req);
  const pf = await preflight(b, { prepareMissing: !!body.prepareMissing });
  send(res, 200, { ok: pf.ok, checks: pf.checks, totalDuration: pf.totalDuration });
});
r.add('POST', '/runs/:id/stop', async (req, res, p) => {
  const c = active.get(p.id);
  if (!c) throw httpError(404, 'Run is not active');
  c.stop();
  send(res, 200, { ok: true });
});
r.add('POST', '/runs/:id/outputs/:dest/retry', async (req, res, p) => {
  const c = active.get(p.id);
  if (!c) throw httpError(404, 'Run is not active');
  c.retryOutput(p.dest);
  send(res, 200, { ok: true });
});
r.add('POST', '/media/:id/ingest', async (req, res, p) => { media.ingest(p.id); send(res, 202, { ok: true }); });
r.add('POST', '/media/:id/prepare', async (req, res, p) => {
  const body = await readJson(req);
  media.enqueue(p.id, body.profile, { fit: body.fit, quality: body.quality });
  send(res, 202, { ok: true });
});
r.add('DELETE', '/media/:id', async (req, res, p) => { media.deleteMedia(p.id); send(res, 200, { ok: true }); });
r.add('POST', '/notify/test', async (req, res) => {
  const body = await readJson(req);
  send(res, 200, await notify('Test notification', 'Stream Studio alerts are working', 'info', body.url));
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://engine');
  try {
    if (url.pathname === '/mediamtx/auth' && req.method === 'POST') {
      const body = await readJson(req);
      return authorize(body) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'unauthorized' });
    }
    if (!safeEq(req.headers['x-internal-token'], config.INTERNAL_TOKEN)) return send(res, 401, { error: 'unauthorized' });
    const m = r.match(req.method, url.pathname);
    if (!m) return send(res, 404, { error: 'Not found' });
    await m.handler(req, res, m.params);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
});

server.listen(config.ENGINE_PORT, config.ENGINE_HOST, async () => {
  console.log(`[engine] listening on ${config.ENGINE_HOST}:${config.ENGINE_PORT}`);
  logEvent('info', 'system', 'Engine started');
  await recover();
  setInterval(tick, 5000);
  setInterval(() => { sampleNet(); sampleCpu(); }, 2000);
  tick();
});

function shutdown(sig) {
  console.log(`[engine] ${sig}: stopping workers`);
  // Leave runs in their active state so the next boot resumes them.
  for (const c of active.values()) {
    c.finished = true;
    for (const p of [c.source.proc, ...[...c.outputs.values()].map((o) => o.proc)]) if (p) p.kill('SIGKILL');
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { startBroadcast, tick };
