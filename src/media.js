// Media inspection and preparation. Videos are converted once, at upload time, into a
// streaming-ready H.264/AAC MP4 per format, so broadcasts can stream-copy with almost no CPU.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const config = require('./config');
const { all, get, run, newId, prefs, logEvent } = require('./db');

const PROFILES = {
  landscape: { '1080': [1920, 1080, 6000], '720': [1280, 720, 3500] },
  portrait: { '1080': [1080, 1920, 6000], '720': [720, 1280, 3500] },
};
const FPS = 30;

function probe(file) {
  return new Promise((resolve, reject) => {
    execFile(config.FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return reject(new Error('Not a readable video file'));
      try {
        const j = JSON.parse(out);
        const v = (j.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
        const a = (j.streams || []).find((s) => s.codec_type === 'audio');
        if (!v) return reject(new Error('File has no video stream'));
        let { width, height } = v;
        const rot = Math.abs(parseInt(v.tags?.rotate || v.side_data_list?.find((s) => s.rotation != null)?.rotation || 0, 10));
        if (rot === 90 || rot === 270) [width, height] = [height, width];
        const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number);
        resolve({
          duration: parseFloat(j.format?.duration) || parseFloat(v.duration) || 0,
          width, height, vcodec: v.codec_name, acodec: a ? a.codec_name : null,
          fps: d ? Math.round((n / d) * 100) / 100 : null,
          orientation: height > width ? 'portrait' : 'landscape',
        });
      } catch (e) { reject(e); }
    });
  });
}

function thumbnail(src, dest, atSec) {
  return new Promise((resolve) => {
    const p = spawn(config.FFMPEG, ['-y', '-v', 'error', '-ss', String(Math.max(0, atSec)), '-i', src, '-frames:v', '1',
      '-vf', 'scale=480:480:force_original_aspect_ratio=decrease', '-q:v', '4', dest]);
    p.on('exit', (code) => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

function filterFor(fit, W, H) {
  const tail = `fps=${FPS},format=yuv420p,setsar=1`;
  if (fit === 'crop') return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${tail}[v]`;
  if (fit === 'pad') return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,${tail}[v]`;
  // blur: the video fits inside a blurred, zoomed copy of itself (the "vertical video" look).
  return `[0:v]split=2[bg][fg];[bg]scale=${Math.round(W / 4)}:${Math.round(H / 4)}:force_original_aspect_ratio=increase,crop=${Math.round(W / 4)}:${Math.round(H / 4)},boxblur=10:2,scale=${W}:${H},setsar=1[bgb];` +
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${tail}[v]`;
}

// ---- Preparation queue (runs inside the engine process) ----
const active = new Map(); // variantId -> child process

function enqueue(mediaId, profile, { fit, quality } = {}) {
  const p = prefs();
  const m = get('SELECT * FROM media WHERE id = ?', mediaId);
  if (!m) throw new Error('Media not found');
  if (!PROFILES[profile]) throw new Error('Unknown format');
  fit = ['blur', 'pad', 'crop'].includes(fit) ? fit : p.defaultFit;
  quality = PROFILES[profile][quality] ? quality : p.quality;
  const existing = get('SELECT * FROM variants WHERE media_id = ? AND profile = ?', mediaId, profile);
  if (existing) {
    if (active.has(existing.id)) { active.get(existing.id).kill('SIGKILL'); active.delete(existing.id); }
    run("UPDATE variants SET status = 'queued', progress = 0, error = NULL, fit = ?, quality = ?, updated_at = ? WHERE id = ?", fit, quality, Date.now(), existing.id);
  } else {
    run("INSERT INTO variants (id, media_id, profile, fit, quality, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)", newId(), mediaId, profile, fit, quality, Date.now());
  }
  pump();
}

function pump() {
  while (active.size < config.PREP_CONCURRENCY) {
    const v = get("SELECT * FROM variants WHERE status = 'queued' ORDER BY created_at LIMIT 1");
    if (!v) return;
    prepare(v);
  }
}

function prepare(v) {
  const m = get('SELECT * FROM media WHERE id = ?', v.media_id);
  if (!m) { run('DELETE FROM variants WHERE id = ?', v.id); return; }
  const [W, H, kbps] = PROFILES[v.profile][v.quality];
  const src = path.join(config.ORIGINALS, m.original_file);
  const outName = `${m.id}-${v.profile}-${v.quality}.mp4`;
  const tmpOut = path.join(config.PROCESSED, `.${outName}.part.mp4`);
  const args = ['-y', '-hide_banner', '-v', 'error', '-nostdin', '-progress', 'pipe:1', '-i', src];
  if (!m.acodec) args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  args.push(
    '-filter_complex', filterFor(v.fit, W, H), '-map', '[v]', '-map', m.acodec ? '0:a:0' : '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level:v', '4.2',
    '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
    '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-af', 'aresample=async=1:first_pts=0',
    '-movflags', '+faststart', '-max_muxing_queue_size', '2048',
  );
  if (!m.acodec) args.push('-shortest');
  args.push(tmpOut);

  run("UPDATE variants SET status = 'processing', progress = 0, updated_at = ? WHERE id = ?", Date.now(), v.id);
  const proc = spawn(config.FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  active.set(v.id, proc);
  let lastWrite = 0, errText = '';
  proc.stdout.on('data', (chunk) => {
    const mt = /out_time_us=(\d+)/g; let match, us = null;
    while ((match = mt.exec(chunk.toString()))) us = +match[1];
    if (us != null && m.duration && Date.now() - lastWrite > 1000) {
      lastWrite = Date.now();
      run('UPDATE variants SET progress = ? WHERE id = ?', Math.min(0.99, us / 1e6 / m.duration), v.id);
    }
  });
  proc.stderr.on('data', (c) => { errText = (errText + c.toString()).slice(-2000); });
  proc.on('exit', (code, signal) => {
    if (active.get(v.id) !== proc) return; // superseded by a re-queue
    active.delete(v.id);
    if (code === 0) {
      const final = path.join(config.PROCESSED, outName);
      fs.renameSync(tmpOut, final);
      if (v.file && v.file !== outName) fs.rmSync(path.join(config.PROCESSED, v.file), { force: true });
      run("UPDATE variants SET status = 'ready', progress = 1, file = ?, size = ?, error = NULL, updated_at = ? WHERE id = ?",
        outName, fs.statSync(final).size, Date.now(), v.id);
      logEvent('info', 'media', `"${m.title}" is ready in ${v.profile === 'portrait' ? '9:16' : '16:9'} ${v.quality}p`, m.id);
    } else {
      fs.rmSync(tmpOut, { force: true });
      const msg = signal ? `Stopped (${signal})` : (errText.trim().split('\n').pop() || `ffmpeg exited ${code}`);
      run("UPDATE variants SET status = 'error', error = ?, updated_at = ? WHERE id = ?", msg, Date.now(), v.id);
      logEvent('error', 'media', `Preparing "${m.title}" (${v.profile}) failed: ${msg}`, m.id);
    }
    pump();
  });
}

// Inspect a freshly uploaded original, make a thumbnail and queue the default formats.
async function ingest(mediaId) {
  const m = get('SELECT * FROM media WHERE id = ?', mediaId);
  if (!m) return;
  const src = path.join(config.ORIGINALS, m.original_file);
  try {
    const info = await probe(src);
    run("UPDATE media SET duration = ?, width = ?, height = ?, vcodec = ?, acodec = ?, fps = ?, orientation = ?, status = 'ready', error = NULL WHERE id = ?",
      info.duration, info.width, info.height, info.vcodec, info.acodec, info.fps, info.orientation, mediaId);
    await thumbnail(src, path.join(config.THUMBS, `${mediaId}.jpg`), Math.min(info.duration * 0.15, 30));
    const p = prefs();
    const formats = p.autoPrepare === 'both' ? ['landscape', 'portrait'] : [info.orientation];
    for (const f of formats) enqueue(mediaId, f);
  } catch (e) {
    run("UPDATE media SET status = 'error', error = ? WHERE id = ?", e.message, mediaId);
    logEvent('error', 'media', `"${m.title}" could not be read: ${e.message}`, mediaId);
  }
}

function deleteMedia(mediaId) {
  const m = get('SELECT * FROM media WHERE id = ?', mediaId);
  if (!m) return;
  for (const v of all('SELECT * FROM variants WHERE media_id = ?', mediaId)) {
    if (active.has(v.id)) { const p = active.get(v.id); active.delete(v.id); p.kill('SIGKILL'); }
    if (v.file) fs.rmSync(path.join(config.PROCESSED, v.file), { force: true });
  }
  fs.rmSync(path.join(config.ORIGINALS, m.original_file), { force: true });
  fs.rmSync(path.join(config.THUMBS, `${mediaId}.jpg`), { force: true });
  run('DELETE FROM media WHERE id = ?', mediaId);
  pump();
}

// After a restart, anything that was mid-conversion goes back in the queue.
function recover() {
  run("UPDATE variants SET status = 'queued', progress = 0 WHERE status = 'processing'");
  for (const m of all("SELECT id FROM media WHERE status = 'uploaded'")) ingest(m.id);
  pump();
}

module.exports = { probe, ingest, enqueue, deleteMedia, recover, PROFILES };
