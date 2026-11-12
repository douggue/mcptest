// DOM helpers, icons, formatting, API client, toasts and modals.

export function h(tag, attrs, ...children) {
  const el = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'rect' || tag === 'polyline' || tag === 'line'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && !(el instanceof SVGElement) && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function mount(target, ...children) { target.replaceChildren(); append(target, children); return target; }

// ---- Icons (24px stroke icons) ----
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  radio: 'M12 12h.01M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  play: 'M7 4.5v15l13-7.5z',
  stop: 'M6 6h12v12H6z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6 9 17l-5-5',
  checkCircle: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  xCircle: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  calendar: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  cpu: 'M5 5h14v14H5zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  disk: 'M22 12H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1zM6 16h.01M10 16h.01',
  wifi: 'M5 12.6a10 10 0 0 1 14 0M1.4 9a15 15 0 0 1 21.2 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  video: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z',
  layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  server: 'M2 2h20v8H2zM2 14h20v8H2zM6 6h.01M6 18h.01',
};
export function icon(name, cls) {
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: cls, 'aria-hidden': 'true' },
    h('path', { d: ICONS[name] || ICONS.info }));
}
export function logoMark() {
  return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round' },
    h('circle', { cx: '12', cy: '12', r: '2.4', fill: 'currentColor' }), h('path', { d: 'M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2' }));
}

// ---- State shared across views ----
export const store = { meta: null, auth: null };

// ---- API ----
export class ApiError extends Error {}
export async function api(method, path, body, { raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Requested-With': 'stream-studio', ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: raw || (body !== undefined ? JSON.stringify(body) : undefined),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) { window.dispatchEvent(new CustomEvent('studio:unauthorized')); }
  if (!res.ok) { const e = new ApiError(data.error || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
  return data;
}

// ---- Formatting ----
export const tz = () => store.meta?.prefs?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
export function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
export function fmtHuman(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), hh = Math.floor(m / 60), d = Math.floor(hh / 24);
  if (d) return `${d}d ${hh % 24}h`;
  if (hh) return `${hh}h ${m % 60}m`;
  return `${m}m`;
}
export function fmtBytes(b) {
  if (b == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export function fmtDate(ms, opts = {}) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(undefined, { timeZone: opts.tz || tz(), weekday: opts.weekday ? 'short' : undefined, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts.extra }).format(new Date(ms));
}
export function fmtTime(ms) { return new Intl.DateTimeFormat(undefined, { timeZone: tz(), hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(ms)); }
export function relTime(ms) {
  const diff = ms - Date.now(), a = Math.abs(diff) / 1000;
  const s = a < 45 ? 'moments' : fmtHuman(a);
  return diff > 0 ? `in ${s}` : `${s} ago`;
}
export function tzAbbr(zone = tz()) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value; } catch { return zone; }
}
export function fmtMbps(kbps) { return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`; }

// Wall-clock in a time zone → UTC ms (mirrors server/schedule.js)
function tzOffset(ms, zone) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))) p[type] = value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
export function zonedToUtc(localStr, zone) { // 'YYYY-MM-DDTHH:MM'
  const [d, t] = localStr.split('T'); const [y, mo, da] = d.split('-').map(Number); const [hh, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, hh, mi);
  const o1 = tzOffset(guess, zone); let r = guess - o1; const o2 = tzOffset(r, zone); if (o2 !== o1) r = guess - o2; return r;
}
export function utcToZonedInput(ms, zone) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms))) p[type] = value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// ---- Platforms ----
export function platform(id) { return store.meta?.platforms?.[id] || { name: id, color: '#94a3b8' }; }
const SHORT = { youtube: 'YT', facebook: 'f', tiktok: 'TT', instagram: 'IG', twitch: 'TV', kick: 'K', x: 'X', linkedin: 'in', custom: '·' };
export function platformBadge(id, size = '') {
  const p = platform(id);
  const dark = ['#25f4ee', '#53fc18', '#e7e9ea'].includes(p.color);
  return h('span', { class: ['platform-badge', size], style: { background: p.color, color: dark ? '#0b0f17' : '#fff' }, title: p.name }, SHORT[id] || p.name[0]);
}
export function ratioTag(o) {
  return h('span', { class: 'tag' }, h('span', { class: ['ratio', o] }), o === 'portrait' ? '9:16' : '16:9');
}

// ---- Feedback ----
export function toast(message, type = 'ok', ms = 4200) {
  const ic = { ok: 'checkCircle', err: 'xCircle', warn: 'alert', info: 'info' }[type] || 'info';
  const t = h('div', { class: ['toast', type], role: 'status' }, icon(ic), h('div', { class: 'grow' }, message));
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
export function errorToast(e) { toast(e.message || String(e), 'err', 6000); }

export function modal({ title, body, actions = [], wide = false, drawer = false, onClose } = {}) {
  let resolve;
  const done = new Promise((r) => (resolve = r));
  const close = (value) => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); resolve(value); };
  const onKey = (e) => { if (e.key === 'Escape') close(null); };
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
    class: ['btn', a.kind], type: 'button', onclick: async (e) => {
      if (!a.onClick) return close(a.value);
      const btn = e.currentTarget; btn.disabled = true;
      try { const r = await a.onClick(); if (r !== false) close(r === undefined ? a.value : r); } catch (err) { errorToast(err); } finally { btn.disabled = false; }
    },
  }, a.icon && icon(a.icon), a.label))) : null;
  const box = h('div', { class: ['card', drawer ? 'drawer' : 'modal', wide && 'wide'], role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'btn ghost icon sm', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    foot);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(null); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  setTimeout(() => box.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea')?.focus(), 30);
  return { done, close, el: box };
}
export function confirmDialog(title, message, { label = 'Confirm', kind = 'danger' } = {}) {
  return modal({ title, body: h('p', { class: 'muted' }, message), actions: [{ label: 'Cancel', value: false }, { label, kind: kind === 'danger' ? 'danger' : kind, value: true }] }).done.then(Boolean);
}

// ---- Form controls ----
export function field(label, control, hint) {
  return h('div', { class: 'field' }, label && h('label', null, label), control, hint && h('div', { class: 'hint' }, hint));
}
export function input(attrs = {}) { return h('input', { class: 'input', ...attrs }); }
export function select(options, value, attrs = {}) {
  return h('select', { class: 'input', ...attrs }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}
export function toggle(label, checked, onchange) {
  const cb = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange && onchange(e.target.checked) });
  return h('label', { class: 'switch' }, cb, h('span', { class: 'track' }), label && h('span', null, label));
}
export function segmented(options, value, onchange) {
  const wrap = h('div', { class: 'segmented', role: 'tablist' });
  const render = (v) => mount(wrap, options.map(([val, label, ic]) => h('button', { type: 'button', class: v === val ? 'on' : '', role: 'tab', 'aria-selected': String(v === val), onclick: () => { render(val); onchange(val); } }, ic && icon(ic), label)));
  render(value);
  return wrap;
}
export function copyButton(getText, label = 'Copy') {
  return h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
    try { await navigator.clipboard.writeText(getText()); toast('Copied'); } catch { toast('Copy failed — select and copy manually', 'warn'); }
    e.currentTarget.blur();
  } }, icon('copy'), label);
}
export function stateDot(state) {
  const map = { live: 'ok', connecting: 'warn', retrying: 'warn', waiting: 'warn', pending: 'info', failed: 'err', blocked: 'err', completed: 'ok', stopped: '', skipped: '' };
  return map[state] ?? '';
}
export function emptyState(ic, title, text, action) {
  return h('div', { class: 'card empty-hero' }, h('div', { class: 'orb' }, icon(ic)), h('h2', null, title), h('p', null, text), action);
}

// Poll helper that stops when the view is replaced.
export function poll(el, fn, ms) {
  let stopped = false, timer;
  const loop = async () => {
    if (stopped || !el.isConnected) return;
    try { await fn(); } catch (e) { if (e.status !== 401) console.warn(e); }
    if (!stopped && el.isConnected) timer = setTimeout(loop, ms);
  };
  loop();
  return () => { stopped = true; clearTimeout(timer); };
}
