// One RunController per active broadcast run.
//
//   source worker ──► MediaMTX path ──► output worker (YouTube)
//   (or OBS push)                  ├──► output worker (Facebook)
//                                  └──► output worker (TikTok …)
//
// Each output is its own ffmpeg process with its own retry budget, so one platform failing
// never interrupts the others.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const { get, run, prefs, logEvent, mappers } = require('../db');
const { decrypt } = require('../crypto');
const { PLATFORMS, ingestUrl } = require('../platforms');
const { notify } = require('../notify');
const mtx = require('./mtx');
const { preflight } = require('./preflight');

const ACTIVE_STATES = ['starting', 'waiting', 'live', 'ending'];
const BACKOFF = [5000, 15000, 45000, 90000, 180000];
const HEALTHY_RESET_MS = 120000;

class RunController {
  constructor(runRow, broadcast, { offsetSec = 0, onDone } = {}) {
    this.id = runRow.id;
    this.row = runRow;
    this.b = broadcast;
    this.isLive = broadcast.source.type === 'live';
    this.offsetSec = offsetSec;
    this.onDone = onDone;
    this.outputs = new Map();
    this.source = { proc: null, state: 'idle', restarts: 0, position: offsetSec };
    this.sourcePath = this.isLive ? `live/${broadcast.ingest_key}` : `src/${runRow.id}`;
    this.timers = new Set();
    this.state = runRow.state;
    this.finished = false;
    this.sourceDone = false;
    this.log = [];
  }

  note(level, msg) {
    this.log.push({ ts: Date.now(), level, msg });
    if (this.log.length > 200) this.log.shift();
    logEvent(level, 'broadcast', `${this.b.title}: ${msg}`, this.b.id);
  }

  setState(state, extra = {}) {
    this.state = state;
    const sets = ['state = ?'], vals = [state];
    for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(v); }
    run(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`, ...vals, this.id);
  }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  async start() {
    const pf = await preflight(this.b, { prepareMissing: true });
    this.totalDuration = pf.totalDuration;
    this.items = pf.items;
    if (!pf.ok) {
      const reason = pf.checks.filter((c) => c.level === 'error').map((c) => c.label).join('; ') || 'Preflight failed';
      for (const { dest, blocked } of pf.destinations) this.upsertOutput(dest.id, blocked ? 'blocked' : 'skipped', blocked);
      return this.finish('blocked', reason);
    }

    const startedAt = this.row.started_at || Date.now();
    const endsAt = this.row.ends_at || (this.b.duration_min ? startedAt + this.b.duration_min * 60000 : null);
    this.setState(this.isLive ? 'waiting' : 'starting', { started_at: startedAt, ends_at: endsAt, reason: this.row.reason || null });
    this.endsAt = endsAt;
    this.startedAt = startedAt;

    for (const { dest, blocked } of pf.destinations) {
      if (blocked) { this.upsertOutput(dest.id, 'blocked', blocked); continue; }
      const key = dest.key_enc ? decrypt(dest.key_enc) : '';
      this.outputs.set(dest.id, {
        dest, key, url: ingestUrl(dest.server_url, key), proc: null, state: 'pending', retries: 0,
        startedAt: null, lastError: null, kbps: 0, bytes: 0, lastBytes: 0, lastBytesAt: 0,
      });
      this.upsertOutput(dest.id, 'pending');
    }

    if (endsAt) {
      const ms = endsAt - Date.now();
      if (ms <= 0) return this.finish('completed', 'Scheduled end time already passed');
      this.later(() => this.stop('Scheduled end reached', 'completed'), ms);
    }

    if (!this.isLive) this.spawnSource();
    else this.note('info', 'Waiting for your encoder to connect');
    this.watch();
  }

  // ---- Source (pre-recorded playback) ----
  spawnSource() {
    const listFile = path.join(config.TMP, `${this.id}.txt`);
    let items = this.items.slice();
    if (this.b.source.type === 'playlist') {
      const p = mappers.playlist(get('SELECT * FROM playlists WHERE id = ?', this.b.source.playlistId));
      if (p && p.shuffle) items.sort(() => Math.random() - 0.5);
    }
    fs.writeFileSync(listFile, items.map((i) => `file '${i.file.replace(/'/g, "'\\''")}'`).join('\n') + '\n');

    let offset = this.source.position || 0;
    if (this.totalDuration > 0) {
      if (this.b.loop) offset %= this.totalDuration;
      else if (offset >= this.totalDuration - 1) { this.sourceDone = true; return this.finish('completed', 'Playback finished'); }
    }
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:1', '-re'];
    if (this.b.loop) args.push('-stream_loop', '-1');
    if (offset > 1) args.push('-ss', offset.toFixed(2));
    args.push('-f', 'concat', '-safe', '0', '-i', listFile,
      '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-f', 'flv', '-flvflags', 'no_duration_filesize', mtx.relayUrl(this.sourcePath));

    const base = offset;
    const proc = spawn(config.FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.source.proc = proc;
    this.source.state = 'running';
    this.source.startedAt = Date.now();
    let err = '';
    proc.stdout.on('data', (c) => {
      const m = /out_time_us=(\d+)/g; let x, us = null;
      while ((x = m.exec(c.toString()))) us = +x[1];
      if (us != null && us > 0) this.source.position = base + us / 1e6;
    });
    proc.stderr.on('data', (c) => { err = (err + c).slice(-1500); });
    proc.on('error', (e) => { err = e.message; });
    proc.on('exit', (code, signal) => {
      if (this.source.proc !== proc) return;
      this.source.proc = null;
      if (this.finished || this.stopping) return;
      if (code === 0) {
        this.source.state = 'done';
        this.sourceDone = true;
        this.note('info', 'Playback finished');
        this.setState('ending');
        // Outputs drain and exit on their own once the relay path closes.
        this.later(() => this.finish('completed', 'Playback finished'), 20000);
        this.maybeFinishAfterDrain();
        return;
      }
      this.source.state = 'error';
      const msg = lastLine(err) || `exited ${signal || code}`;
      if (this.source.restarts >= prefs().maxRetries) return this.finish('failed', `Playback worker failed: ${msg}`);
      this.source.restarts++;
      this.note('warn', `Playback worker stopped (${msg}); restarting (${this.source.restarts}/${prefs().maxRetries})`);
      this.later(() => !this.finished && this.spawnSource(), 3000);
    });
  }

  maybeFinishAfterDrain() {
    if (!this.sourceDone || this.finished) return;
    if ([...this.outputs.values()].every((o) => !o.proc)) this.finish('completed', 'Playback finished');
  }

  // ---- Watch loop: start outputs when the relay path is ready ----
  async watch() {
    if (this.finished) return;
    const info = await mtx.pathInfo(this.sourcePath);
    if (this.finished) return;
    this.pathReady = info.ready;
    if (info.ready && !this.sourceDone) {
      if (this.state !== 'live') {
        this.setState('live', { live_at: this.row.live_at || Date.now() });
        this.row.live_at = this.row.live_at || Date.now();
        this.note('info', this.isLive ? 'Encoder connected — going live' : 'Broadcast is live');
        notify(`LIVE: ${this.b.title}`, [...this.outputs.values()].map((o) => o.dest.name).join(', '));
      }
      for (const [id, o] of this.outputs) {
        if (!o.proc && (o.state === 'pending' || o.state === 'waiting')) this.spawnOutput(id);
      }
    } else if (!info.ready && this.isLive && this.state === 'live') {
      this.setState('waiting');
      this.note('warn', 'Encoder disconnected — waiting for it to reconnect');
      notify(`Encoder disconnected: ${this.b.title}`, 'Outputs resume automatically when your encoder reconnects', 'warn');
    }
    this.updateRates();
    // Poll quickly until outputs are up so the first seconds of the programme are not lost.
    const starting = [...this.outputs.values()].some((o) => o.state === 'pending' || o.state === 'connecting');
    this.later(() => this.watch(), starting || this.state !== 'live' ? 400 : 2000);
  }

  // ---- Output workers ----
  spawnOutput(destId) {
    const o = this.outputs.get(destId);
    if (!o || this.finished) return;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-rw_timeout', '15000000',
      '-probesize', '2000000', '-analyzeduration', '2000000', '-i', mtx.relayUrl(this.sourcePath), '-map', '0', '-c', 'copy',
      '-f', 'flv', '-flvflags', 'no_duration_filesize', '-progress', 'pipe:1', o.url];
    const proc = spawn(config.FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    o.proc = proc;
    o.state = 'connecting';
    o.startedAt = Date.now();
    o.bytes = 0; o.lastBytes = 0; o.lastBytesAt = Date.now();
    this.upsertOutput(destId, 'connecting');
    let err = '';
    proc.stdout.on('data', (c) => {
      const s = c.toString();
      const m = /total_size=(\d+)/g; let x;
      while ((x = m.exec(s))) o.bytes = +x[1];
      if (o.state === 'connecting' && o.bytes > 0) {
        o.state = 'live';
        this.upsertOutput(destId, 'live');
        this.note('info', `${o.dest.name} connected`);
      }
    });
    proc.stderr.on('data', (c) => { err = (err + c).slice(-1500); });
    proc.on('error', (e) => { err = e.message; });
    proc.on('exit', async (code, signal) => {
      if (o.proc !== proc) return;
      o.proc = null;
      o.kbps = 0;
      if (this.finished) return;
      if (this.stopping) { o.state = 'stopped'; return; }
      if (this.sourceDone) { o.state = 'completed'; this.upsertOutput(destId, 'completed'); return this.maybeFinishAfterDrain(); }
      // If the source went away (encoder disconnected, playback worker restarting) this is not
      // the destination's fault: wait for the source instead of spending a retry.
      const info = await mtx.pathInfo(this.sourcePath);
      if (this.finished || this.stopping || o.proc) return;
      if (!info.ready) { this.pathReady = false; o.state = 'waiting'; this.upsertOutput(destId, 'waiting'); return; }

      const msg = redact(lastLine(err) || `ffmpeg exited ${signal || code}`, o);
      o.lastError = msg;
      if (Date.now() - o.startedAt > HEALTHY_RESET_MS) o.retries = 0;
      const max = prefs().maxRetries;
      if (o.retries >= max) {
        o.state = 'failed';
        this.upsertOutput(destId, 'failed', msg);
        this.note('error', `${o.dest.name} failed after ${max} retries: ${msg}`);
        notify(`${o.dest.name} failed`, `${this.b.title}: ${msg}`, 'error');
        return;
      }
      const delay = BACKOFF[Math.min(o.retries, BACKOFF.length - 1)];
      o.retries++;
      o.state = 'retrying';
      o.retryAt = Date.now() + delay;
      this.upsertOutput(destId, 'retrying', msg);
      this.note('warn', `${o.dest.name} dropped (${msg}); retry ${o.retries}/${max} in ${delay / 1000}s`);
      this.later(() => { if (!this.finished && !o.proc && o.state === 'retrying') { o.state = 'pending'; this.spawnOutput(destId); } }, delay);
    });
  }

  retryOutput(destId) {
    const o = this.outputs.get(destId);
    if (!o) throw new Error('Output not part of this broadcast');
    if (o.proc) return;
    o.retries = 0;
    o.state = 'pending';
    this.upsertOutput(destId, 'pending');
    if (this.pathReady) this.spawnOutput(destId);
  }

  updateRates() {
    const now = Date.now();
    for (const o of this.outputs.values()) {
      if (!o.proc) continue;
      const dt = (now - o.lastBytesAt) / 1000;
      if (dt >= 1.5) {
        o.kbps = Math.max(0, Math.round(((o.bytes - o.lastBytes) * 8) / 1000 / dt));
        o.lastBytes = o.bytes; o.lastBytesAt = now;
      }
    }
  }

  upsertOutput(destId, state, error = null) {
    const o = this.outputs.get(destId);
    run(`INSERT INTO run_outputs (run_id, destination_id, state, retries, started_at, last_error, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, destination_id) DO UPDATE SET state = excluded.state, retries = excluded.retries,
         started_at = COALESCE(run_outputs.started_at, excluded.started_at), last_error = COALESCE(excluded.last_error, run_outputs.last_error), bytes = excluded.bytes`,
    this.id, destId, state, o ? o.retries : 0, o && o.startedAt ? o.startedAt : null, error, o ? o.bytes : 0);
  }

  // ---- Stop / finish ----
  stop(reason = 'Stopped from dashboard', finalState = 'stopped') {
    if (this.finished || this.stopping) return;
    this.stopping = true;
    this.setState('ending');
    this.note('info', reason);
    const procs = [this.source.proc, ...[...this.outputs.values()].map((o) => o.proc)].filter(Boolean);
    for (const p of procs) p.kill('SIGINT');
    const deadline = Date.now() + 6000;
    const check = () => {
      const alive = procs.filter((p) => p.exitCode === null && p.signalCode === null);
      if (!alive.length || Date.now() > deadline) { alive.forEach((p) => p.kill('SIGKILL')); this.finish(finalState, reason); }
      else setTimeout(check, 250);
    };
    check();
  }

  finish(state, reason) {
    if (this.finished) return;
    this.finished = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const p of [this.source.proc, ...[...this.outputs.values()].map((o) => o.proc)]) if (p) p.kill('SIGKILL');
    for (const [id, o] of this.outputs) {
      const final = ['failed', 'blocked'].includes(o.state) ? o.state : state === 'completed' ? 'completed' : 'stopped';
      o.state = final;
      this.upsertOutput(id, final);
      run('UPDATE run_outputs SET ended_at = ? WHERE run_id = ? AND destination_id = ?', Date.now(), this.id, id);
    }
    const isError = state === 'failed' || state === 'blocked';
    this.setState(state, { ended_at: Date.now(), error: isError ? reason : null, reason });
    fs.rmSync(path.join(config.TMP, `${this.id}.txt`), { force: true });
    this.note(isError ? 'error' : 'info', `Ended: ${state}${reason ? ` (${reason})` : ''}`);
    if (isError) notify(`${state === 'blocked' ? 'Blocked' : 'Failed'}: ${this.b.title}`, reason, 'error');
    else if (this.row.live_at) notify(`Ended: ${this.b.title}`, reason, 'info');
    if (this.onDone) this.onDone(this);
  }

  snapshot() {
    return {
      runId: this.id, broadcastId: this.b.id, title: this.b.title, orientation: this.b.orientation,
      sourceType: this.b.source.type, state: this.state, startedAt: this.startedAt, liveAt: this.row.live_at || null,
      endsAt: this.endsAt, loop: this.b.loop, position: this.source.position, totalDuration: this.totalDuration || null,
      sourceState: this.isLive ? (this.pathReady ? 'connected' : 'waiting') : this.source.state,
      sourceRestarts: this.source.restarts, previewPath: this.sourcePath,
      outputs: [...this.outputs.entries()].map(([id, o]) => ({
        destinationId: id, name: o.dest.name, platform: o.dest.platform,
        color: (PLATFORMS[o.dest.platform] || PLATFORMS.custom).color,
        state: o.state, kbps: o.kbps, bytes: o.bytes, retries: o.retries, lastError: o.lastError,
        since: o.startedAt, retryAt: o.state === 'retrying' ? o.retryAt : null,
      })),
      log: this.log.slice(-30),
    };
  }
}

function lastLine(s) {
  return String(s || '').trim().split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
}

// Never let stream keys reach logs or the dashboard.
function redact(text, o) {
  let t = String(text);
  if (o.url) t = t.split(o.url).join(o.dest.server_url + '/***');
  if (o.key && o.key.length >= 4) t = t.split(o.key).join('***');
  return t;
}

module.exports = { RunController, ACTIVE_STATES };
