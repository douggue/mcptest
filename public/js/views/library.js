import { h, mount, icon, api, poll, modal, field, input, select, segmented, fmtDuration, fmtBytes, relTime, ratioTag, toast, errorToast, confirmDialog, emptyState, store } from '../ui.js';

const CHUNK = 8 * 1024 * 1024;
const uploads = new Map(); // shared across navigations: key -> { file, id, received, state, el }

export async function libraryView(root) {
  const fileInput = h('input', { type: 'file', accept: 'video/*,.mkv,.mov,.mp4,.m4v,.webm,.avi', multiple: true, class: 'hidden', onchange: (e) => { [...e.target.files].forEach(startUpload); e.target.value = ''; } });
  const drop = h('div', { class: 'dropzone', role: 'button', tabindex: '0', onclick: () => fileInput.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); } },
    icon('upload'), h('b', null, 'Drop videos here or click to upload'),
    h('span', { class: 'muted small' }, 'MP4, MOV, MKV, WEBM · large files upload in chunks and resume if your connection drops'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); [...e.dataTransfer.files].forEach(startUpload); });

  const queue = h('div', { class: 'uploads' });
  const grid = h('div');
  const usage = h('span', { class: 'muted small' });
  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Library'), h('p', null, 'Upload once. Each video is converted into streaming-ready 16:9 and 9:16 versions.')),
      h('div', { class: 'actions' }, usage, h('button', { class: 'btn primary', onclick: () => fileInput.click() }, icon('upload'), 'Upload'))),
    fileInput, drop, queue, grid);

  for (const u of uploads.values()) queue.append(u.el);
  window.__libQueue = queue;

  let lastSig = '';
  poll(root, async () => {
    const media = await api('GET', '/api/media');
    const total = media.reduce((t, m) => t + (m.size || 0) + m.variants.reduce((a, v) => a + (v.size || 0), 0), 0);
    usage.textContent = media.length ? `${media.length} videos · ${fmtBytes(total)}` : '';
    const sig = JSON.stringify(media.map((m) => [m.id, m.title, m.status, m.variants.map((v) => [v.profile, v.status, Math.round(v.progress * 50)])]));
    if (sig !== lastSig) { lastSig = sig; renderGrid(grid, media, () => { lastSig = ''; }); }
  }, 2000);
}

function renderGrid(grid, media, invalidate) {
  if (!media.length) return mount(grid, emptyState('film', 'Your library is empty', 'Upload your first video. It will be checked, given a thumbnail and converted to a streaming-ready format automatically.'));
  mount(grid, h('div', { class: 'media-grid' }, media.map((m) => mediaCard(m, invalidate))));
}

function mediaCard(m, invalidate) {
  const variant = (p) => m.variants.find((v) => v.profile === p);
  const playable = m.variants.find((v) => v.status === 'ready');
  const title = h('div', { class: 'media-title ellipsis', title: 'Click to rename', onclick: () => rename(m, invalidate) }, m.title);
  const chips = ['landscape', 'portrait'].map((p) => {
    const v = variant(p);
    const label = p === 'portrait' ? '9:16' : '16:9';
    if (!v) return h('button', { class: 'variant add', title: `Create a ${label} version`, onclick: () => prepareDialog(m, p, invalidate) }, icon('plus'), label);
    if (v.status === 'ready') return h('button', { class: 'variant ready', title: `${v.quality}p · ${v.fit} fit · ${fmtBytes(v.size)} — click to redo`, onclick: () => prepareDialog(m, p, invalidate, v) }, icon('check'), `${label} · ${v.quality}p`);
    if (v.status === 'error') return h('button', { class: 'variant error', title: v.error, onclick: () => prepareDialog(m, p, invalidate, v) }, icon('alert'), `${label} failed`);
    return h('span', { class: ['variant', v.status] }, h('span', { class: 'spinner', style: { width: '11px', height: '11px' } }), v.status === 'queued' ? `${label} queued` : `${label} ${Math.round(v.progress * 100)}%`);
  });
  return h('div', { class: 'card media-card' },
    h('div', { class: 'thumb', onclick: () => playable && previewDialog(m, playable) },
      m.status !== 'uploaded' && h('img', { src: `/files/thumbs/${m.id}.jpg?${m.created_at}`, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }),
      m.orientation && h('span', { class: 'orient' }, ratioTag(m.orientation)),
      m.duration ? h('span', { class: 'dur' }, fmtDuration(m.duration)) : null,
      playable && h('div', { class: 'play' }, icon('play'))),
    h('div', { class: 'media-body' },
      title,
      m.status === 'error' ? h('div', { class: 'notice err' }, icon('xCircle'), m.error)
        : m.status === 'uploaded' ? h('div', { class: 'muted small row' }, h('span', { class: 'spinner' }), 'Inspecting video…')
          : h('div', { class: 'muted small' }, [m.width && `${m.width}×${m.height}`, m.fps && `${Math.round(m.fps)} fps`, m.vcodec, m.acodec ? m.acodec : 'no audio (silence added)', fmtBytes(m.size)].filter(Boolean).join(' · ')),
      h('div', { class: 'variants' }, chips),
      h('div', { class: 'media-foot' },
        h('span', { class: 'muted tiny' }, `Added ${relTime(m.created_at)}`),
        h('div', { class: 'row', style: { gap: '4px' } },
          h('a', { class: 'btn sm', href: `#/broadcasts/new/media/${m.id}`, title: 'Create a broadcast with this video' }, icon('radio'), 'Broadcast'),
          h('button', { class: 'btn sm icon danger', title: 'Delete', 'aria-label': 'Delete video', onclick: () => remove(m, invalidate) }, icon('trash'))))));
}

async function rename(m, invalidate) {
  const t = input({ value: m.title, maxlength: 150 });
  await modal({ title: 'Rename video', body: field('Title', t), actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => { await api('PATCH', `/api/media/${m.id}`, { title: t.value }); invalidate(); } }] }).done;
}

async function remove(m, invalidate) {
  const extra = m.usedBy.length ? ` It is used by: ${m.usedBy.join(', ')}.` : '';
  if (!(await confirmDialog('Delete video?', `“${m.title}”, its converted versions and thumbnail will be permanently deleted.${extra}`, { label: 'Delete' }))) return;
  try { await api('DELETE', `/api/media/${m.id}`); toast('Video deleted'); invalidate(); } catch (e) { errorToast(e); }
}

function prepareDialog(m, profile, invalidate, existing) {
  const label = profile === 'portrait' ? '9:16 (vertical)' : '16:9 (horizontal)';
  let fit = existing?.fit || store.meta.prefs.defaultFit;
  const quality = select([['1080', '1080p — best quality'], ['720', '720p — lighter on bandwidth']], existing?.quality || store.meta.prefs.quality);
  const mismatch = m.orientation && m.orientation !== profile;
  const fits = [
    ['blur', 'Blurred background', 'The full video sits on a soft, zoomed copy of itself — the familiar social look.'],
    ['pad', 'Black bars', 'The full video with black bars filling the empty space.'],
    ['crop', 'Fill & crop', 'Zooms in to fill the frame. Edges are cut off.'],
  ];
  const desc = h('div', { class: 'hint' });
  const seg = segmented(fits.map(([v, l]) => [v, l]), fit, (v) => { fit = v; desc.textContent = fits.find((f) => f[0] === v)[2]; });
  desc.textContent = fits.find((f) => f[0] === fit)[2];
  return modal({
    title: `${existing ? 'Re-create' : 'Create'} ${label} version`,
    body: [
      h('p', { class: 'muted' }, `“${m.title}” is ${m.orientation === 'portrait' ? 'vertical' : 'horizontal'}. ${mismatch ? `Converting it to ${label} needs a framing choice.` : 'It already matches this format.'}`),
      field('Framing', h('div', { class: 'col', style: { gap: '8px' } }, seg, desc)),
      field('Quality', quality, 'Conversion runs on the server. You can close this page.'),
    ],
    actions: [{ label: 'Cancel' }, { label: existing ? 'Re-create' : 'Create', kind: 'primary', onClick: async () => { await api('POST', `/api/media/${m.id}/prepare`, { profile, fit, quality: quality.value }); toast('Queued for conversion'); invalidate(); } }],
  }).done;
}

function previewDialog(m, v) {
  const others = m.variants.filter((x) => x.status === 'ready');
  const video = h('video', { controls: true, autoplay: true, playsinline: true, src: `/files/variants/${v.id}`, style: { 'max-height': '65vh', margin: '0 auto', 'border-radius': '12px', background: '#000' } });
  const switcher = others.length > 1 ? segmented(others.map((x) => [x.id, x.profile === 'portrait' ? '9:16' : '16:9']), v.id, (id) => { video.src = `/files/variants/${id}`; }) : null;
  modal({ title: m.title, wide: true, body: [switcher, video, h('div', { class: 'muted small' }, 'This is exactly what your viewers will receive.')], onClose: () => { video.pause(); video.removeAttribute('src'); video.load(); } });
}

// ---------- Resumable uploads ----------
function startUpload(file) {
  const key = `${file.name}:${file.size}:${file.lastModified}`;
  if (uploads.has(key)) return toast('That file is already uploading', 'warn');
  const bar = h('i', { style: { width: '0%' } });
  const status = h('span', { class: 'muted small' }, 'Starting…');
  const cancel = h('button', { class: 'btn sm ghost icon', 'aria-label': 'Cancel upload', onclick: () => { u.cancelled = true; u.ctrl?.abort(); } }, icon('x'));
  const u = { file, key, el: null, cancelled: false };
  u.el = h('div', { class: 'card upload-row' }, h('div', { class: 'ellipsis' }, h('b', null, file.name), ' ', h('span', { class: 'muted small' }, fmtBytes(file.size))), h('div', { class: 'row' }, status, cancel), h('div', { class: 'meter' }, bar));
  uploads.set(key, u);
  (window.__libQueue?.isConnected ? window.__libQueue : document.createElement('div')).append(u.el);
  const finish = (msg, type) => { uploads.delete(key); toast(msg, type); setTimeout(() => u.el.remove(), type === 'ok' ? 1200 : 6000); };

  (async () => {
    const saved = JSON.parse(localStorage.getItem('uploads') || '{}');
    let id = saved[key], received = 0;
    if (id) { try { received = (await api('GET', `/api/uploads/${id}`)).received; } catch { id = null; } }
    if (!id) { id = (await api('POST', '/api/uploads', { filename: file.name, size: file.size })).id; }
    saved[key] = id; localStorage.setItem('uploads', JSON.stringify(saved));
    const started = Date.now(), startBytes = received;
    let failures = 0;
    while (received < file.size) {
      if (u.cancelled) { await api('DELETE', `/api/uploads/${id}`).catch(() => {}); forget(key); return finish('Upload cancelled', 'warn'); }
      const chunk = file.slice(received, Math.min(file.size, received + CHUNK));
      try {
        u.ctrl = new AbortController();
        const res = await fetch(`/api/uploads/${id}?offset=${received}`, { method: 'PUT', body: chunk, headers: { 'X-Requested-With': 'stream-studio', 'Content-Type': 'application/octet-stream' }, signal: u.ctrl.signal });
        const j = await res.json().catch(() => ({}));
        if (res.status === 409 && j.received != null) { received = j.received; continue; }
        if (!res.ok) throw new Error(j.error || `Upload failed (${res.status})`);
        received = j.received; failures = 0;
      } catch (e) {
        if (u.cancelled) continue;
        if (++failures > 8) throw e;
        status.textContent = `Connection problem — retrying (${failures})…`;
        await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** failures)));
        continue;
      }
      const pct = (received / file.size) * 100;
      bar.style.width = pct.toFixed(1) + '%';
      const rate = (received - startBytes) / ((Date.now() - started) / 1000);
      status.textContent = `${pct.toFixed(0)}% · ${fmtBytes(rate)}/s · ${rate > 0 ? Math.round((file.size - received) / rate) + 's left' : ''}`;
    }
    status.textContent = 'Finishing…';
    await api('POST', `/api/uploads/${id}/complete`, {});
    forget(key);
    bar.style.width = '100%';
    status.textContent = 'Uploaded — converting';
    finish(`“${file.name}” uploaded. Converting for streaming…`, 'ok');
  })().catch((e) => { status.textContent = e.message; finish(`Upload failed: ${e.message}. Drop the same file again to resume.`, 'err'); });
}
function forget(key) { const s = JSON.parse(localStorage.getItem('uploads') || '{}'); delete s[key]; localStorage.setItem('uploads', JSON.stringify(s)); }
