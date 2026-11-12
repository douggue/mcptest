import { h, mount, icon, api, poll, modal, field, input, select, toggle, segmented, fmtDuration, fmtHuman, fmtDate, relTime, ratioTag, platformBadge, platform, toast, errorToast, confirmDialog, emptyState, copyButton, store, tz, tzAbbr, zonedToUtc, utcToZonedInput } from '../ui.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RUN_STATE = { starting: 'info', waiting: 'warn', live: 'live', ending: 'warn', completed: 'ok', stopped: '', failed: 'err', blocked: 'err', missed: 'warn', interrupted: 'warn' };

export async function broadcastsView(root, [id, ...rest]) {
  const listEl = h('div', { class: 'bc-list' });
  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Broadcasts'), h('p', null, 'Each broadcast is a show: what to stream, in which format, to which platforms, and when.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => openEditor(null, {}, refresh) }, icon('plus'), 'New broadcast'))),
    listEl);

  let data = { broadcasts: [], media: [], playlists: [], destinations: [] };
  let sig = '';
  async function refresh(force) {
    const [broadcasts, media, playlists, destinations] = await Promise.all([api('GET', '/api/broadcasts'), api('GET', '/api/media'), api('GET', '/api/playlists'), api('GET', '/api/destinations')]);
    data = { broadcasts, media, playlists, destinations };
    const s = JSON.stringify(broadcasts.map((b) => [b.id, b.updated_at, b.active_run?.state, b.last_run?.id, b.next_at, b.enabled]));
    if (force === true || s !== sig) { sig = s; renderList(listEl, data, refresh); }
  }
  await refresh(true);
  poll(root, refresh, 3000);

  if (id === 'new') {
    const preset = rest[0] === 'media' ? { source: { type: 'media', mediaId: rest[1] } } : {};
    openEditor(null, preset, refresh);
    history.replaceState(null, '', '#/broadcasts');
  } else if (id) {
    const b = data.broadcasts.find((x) => x.id === id);
    if (b) showHistory(b, data);
    history.replaceState(null, '', '#/broadcasts');
  }
  root.__data = () => data;
  window.__bcData = () => data;
}

function scheduleText(s) {
  if (!s || s.type === 'manual') return 'Manual start';
  if (s.type === 'once') return `Once · ${fmtDate(Date.parse(s.at), { tz: s.tz || tz(), weekday: true })}`;
  const d = s.days || [];
  const days = d.length === 7 ? 'Every day' : d.join() === '1,2,3,4,5' ? 'Weekdays' : d.join() === '0,6' ? 'Weekends' : d.map((x) => DAY_NAMES[x]).join(', ');
  return `${days} at ${s.time} ${tzAbbr(s.tz)}`;
}

function sourceText(b, data) {
  if (b.source.type === 'live') return 'Live from OBS / encoder';
  if (b.source.type === 'media') return data.media.find((m) => m.id === b.source.mediaId)?.title || 'Missing video';
  const p = data.playlists.find((x) => x.id === b.source.playlistId);
  return p ? `Playlist · ${p.title} (${p.items.length})` : 'Missing playlist';
}

function renderList(el, data, refresh) {
  if (!data.broadcasts.length) {
    return mount(el, emptyState('radio', 'Create your first broadcast', 'Pick a video, playlist or live OBS input, choose 16:9 or 9:16, select your platforms and set a schedule — or go live right away.',
      h('button', { class: 'btn primary', onclick: () => openEditor(null, {}, refresh) }, icon('plus'), 'New broadcast')));
  }
  mount(el, data.broadcasts.map((b) => {
    const run = b.active_run;
    const isLive = run && run.state === 'live';
    const dests = b.destination_ids.map((id) => data.destinations.find((d) => d.id === id)).filter(Boolean);
    let status;
    if (run) status = h('span', { class: ['pill', RUN_STATE[run.state]] }, h('span', { class: ['dot', isLive && 'pulse'] }), run.state === 'waiting' ? 'WAITING FOR SOURCE' : run.state.toUpperCase());
    else if (!b.enabled) status = h('span', { class: 'pill' }, 'OFF');
    else if (b.next_at) status = h('span', { class: 'pill accent' }, icon('clock'), `Next ${relTime(b.next_at)}`);
    else status = h('span', { class: 'pill' }, 'READY');
    const last = b.last_run && h('span', { title: b.last_run.reason || '' }, icon(b.last_run.state === 'completed' ? 'checkCircle' : b.last_run.state === 'stopped' ? 'stop' : 'alert'), `Last: ${b.last_run.state} ${relTime(b.last_run.ended_at || b.last_run.created_at)}`);
    return h('div', { class: ['card', 'bc', isLive && 'is-live'] },
      h('div', { class: 'bc-icon' }, icon(b.source.type === 'live' ? 'camera' : b.source.type === 'playlist' ? 'list' : 'film')),
      h('div', { style: { 'min-width': '0' } },
        h('div', { class: 'row wrap', style: { gap: '10px' } }, h('h3', { class: 'ellipsis' }, b.title), status),
        h('div', { class: 'bc-meta' },
          h('span', null, ratioTag(b.orientation)),
          h('span', { class: 'ellipsis' }, icon(b.source.type === 'live' ? 'camera' : 'film'), sourceText(b, data)),
          h('span', null, icon(b.schedule.type === 'recurring' ? 'repeat' : 'calendar'), scheduleText(b.schedule)),
          b.duration_min ? h('span', null, icon('clock'), fmtHuman(b.duration_min * 60)) : b.loop ? h('span', null, icon('repeat'), 'Loops until stopped') : null,
          dests.length ? h('span', { class: 'avatars', title: dests.map((d) => d.name).join(', ') }, dests.map((d) => platformBadge(d.platform, 'sm'))) : h('span', { style: { color: 'var(--warn)' } }, icon('alert'), 'No destinations'),
          last)),
      h('div', { class: 'bc-actions' },
        run ? h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmDialog('Stop broadcast?', `“${b.title}” will end on every platform now.`, { label: 'Stop broadcast' }))) return;
          try { await api('POST', `/api/broadcasts/${b.id}/stop`); toast('Stopping…'); setTimeout(refresh, 1500); } catch (e) { errorToast(e); }
        } }, icon('stop'), 'Stop')
          : h('button', { class: 'btn live', onclick: () => goLive(b, refresh) }, icon('play'), 'Go live'),
        b.source.type === 'live' && h('button', { class: 'btn', onclick: () => showIngest(b, refresh) }, icon('key'), 'OBS setup'),
        h('button', { class: 'btn icon', title: 'Edit', 'aria-label': 'Edit', onclick: () => openEditor(b, {}, refresh) }, icon('edit')),
        h('button', { class: 'btn icon', title: 'More', 'aria-label': 'More actions', onclick: (e) => moreMenu(e.currentTarget, b, data, refresh) }, icon('more'))));
  }));
}

function moreMenu(anchor, b, data, refresh) {
  modal({
    title: b.title,
    body: h('div', { class: 'col', style: { gap: '8px' } },
      h('button', { class: 'btn block', onclick: () => { document.querySelector('.overlay')?.remove(); runPreflight(b); } }, icon('checkCircle'), 'Run preflight check'),
      h('button', { class: 'btn block', onclick: () => { document.querySelector('.overlay')?.remove(); showHistory(b, data); } }, icon('clock'), 'History & logs'),
      h('button', { class: 'btn block', onclick: async () => { document.querySelector('.overlay')?.remove(); try { await api('POST', `/api/broadcasts/${b.id}/duplicate`); toast('Duplicated (turned off until you enable it)'); refresh(true); } catch (e) { errorToast(e); } } }, icon('copy'), 'Duplicate'),
      h('button', { class: 'btn block danger', onclick: async () => {
        document.querySelector('.overlay')?.remove();
        if (!(await confirmDialog('Delete broadcast?', `“${b.title}” and its history will be deleted.`, { label: 'Delete' }))) return;
        try { await api('DELETE', `/api/broadcasts/${b.id}`); toast('Broadcast deleted'); refresh(true); } catch (e) { errorToast(e); }
      } }, icon('trash'), 'Delete')),
  });
}

async function goLive(b, refresh) {
  const btn = document.activeElement;
  if (btn) btn.disabled = true;
  try {
    const pf = await api('POST', `/api/broadcasts/${b.id}/preflight`, {});
    if (!pf.ok) { if (btn) btn.disabled = false; return showChecks(b, pf, true, refresh); }
    const warn = pf.checks.filter((c) => c.level !== 'ok');
    if (warn.length && !(await confirmDialog('Go live with warnings?', warn.map((c) => c.label).join(' · '), { label: 'Go live', kind: 'live' }))) return;
    const run = await api('POST', `/api/broadcasts/${b.id}/start`);
    if (run.state === 'blocked') toast(`Blocked: ${run.reason}`, 'err', 8000);
    else if (b.source.type === 'live') { toast('Armed — start streaming from OBS'); showIngest(b, refresh); }
    else toast('Going live…');
    refresh(true);
  } catch (e) { errorToast(e); } finally { if (btn) btn.disabled = false; }
}

async function runPreflight(b) {
  try { showChecks(b, await api('POST', `/api/broadcasts/${b.id}/preflight`, {}), false); } catch (e) { errorToast(e); }
}

function checksList(checks) {
  return h('div', { class: 'checklist' }, checks.map((c) => h('div', { class: ['checkline', c.level] }, icon(c.level === 'ok' ? 'checkCircle' : c.level === 'warn' ? 'alert' : 'xCircle'), h('div', null, h('div', null, c.label), c.detail && h('div', { class: 'muted small' }, c.detail)))));
}

function showChecks(b, pf, blocking, refresh) {
  const missing = pf.checks.some((c) => /needs a .* version/.test(c.label));
  modal({
    title: pf.ok ? 'Ready to go live' : 'Not ready yet',
    body: [blocking && !pf.ok && h('div', { class: 'notice err' }, icon('xCircle'), 'Fix the items below before going live.'), checksList(pf.checks)],
    actions: [
      missing && { label: 'Prepare missing formats', kind: 'primary', onClick: async () => { await api('POST', `/api/broadcasts/${b.id}/preflight`, { prepareMissing: true }); toast('Conversion queued. Check the Library for progress.'); } },
      { label: 'Close' },
    ].filter(Boolean),
  });
}

function showIngest(b, refresh) {
  let reveal = false;
  const keyCode = h('code', null, '••••••••••••••••••••');
  const portrait = b.orientation === 'portrait';
  modal({
    title: 'Go live from OBS',
    body: [
      h('p', { class: 'muted' }, 'In OBS: Settings → Stream → Service “Custom…”, then paste these. Every platform in this broadcast receives your feed while it is armed.'),
      h('div', { class: 'ingest-box' },
        field('Server', h('div', { class: 'copy-row' }, h('code', null, b.ingest.server), copyButton(() => b.ingest.server))),
        field('Stream key', h('div', { class: 'copy-row' }, keyCode,
          h('button', { class: 'btn sm icon', 'aria-label': 'Show key', onclick: (e) => { reveal = !reveal; keyCode.textContent = reveal ? b.ingest.key : '••••••••••••••••••••'; mount(e.currentTarget, icon(reveal ? 'eyeOff' : 'eye')); } }, icon('eye')),
          copyButton(() => b.ingest.key)))),
      h('div', { class: 'guide' }, h('b', null, 'Recommended OBS output settings'),
        h('ol', null,
          h('li', null, `Output resolution ${portrait ? '1080×1920 (vertical canvas)' : '1920×1080'}, 30 fps`),
          h('li', null, 'Encoder x264 or hardware H.264, rate control CBR, 4500–6000 Kbps'),
          h('li', null, 'Keyframe interval 2 s, profile high'),
          h('li', null, 'Audio AAC 160 Kbps, 44.1 or 48 kHz'))),
      h('div', { class: 'notice info' }, icon('info'), h('span', null, 'The key only works while this broadcast exists. If it leaks, rotate it — the old key stops working immediately.')),
    ],
    actions: [
      { label: 'Rotate key', onClick: async () => { if (!(await confirmDialog('Rotate stream key?', 'OBS will need the new key.', { label: 'Rotate' }))) return false; await api('POST', `/api/broadcasts/${b.id}/rotate-key`); toast('New key generated'); refresh(true); } },
      { label: 'Done', kind: 'primary' },
    ],
  });
}

async function showHistory(b, data) {
  const d = await api('GET', `/api/broadcasts/${b.id}`);
  const rows = d.runs.map((r) => h('tr', null,
    h('td', null, h('div', null, fmtDate(r.started_at || r.scheduled_for, { weekday: true })), h('div', { class: 'muted tiny' }, r.trigger === 'schedule' ? 'Scheduled' : 'Manual')),
    h('td', null, h('span', { class: ['pill', RUN_STATE[r.state]] }, r.state)),
    h('td', null, r.live_at && r.ended_at ? fmtDuration((r.ended_at - r.live_at) / 1000) : '—'),
    h('td', null, h('div', { class: 'col', style: { gap: '4px' } }, r.outputs.map((o) => h('div', { class: 'row small', style: { gap: '6px' }, title: o.last_error || '' }, platformBadge(o.platform || 'custom', 'sm'), h('span', null, o.name || 'Deleted'), h('span', { class: 'muted' }, `· ${o.state}${o.retries ? ` · ${o.retries} retries` : ''}`)))),
      r.reason && h('div', { class: 'muted tiny', style: { 'margin-top': '4px' } }, r.reason))));
  modal({
    title: `History · ${b.title}`, wide: true,
    body: d.runs.length ? h('div', { style: { overflow: 'auto' } }, h('table', { class: 'table' }, h('thead', null, h('tr', null, ['When', 'Result', 'On air', 'Destinations'].map((t) => h('th', null, t)))), h('tbody', null, rows)))
      : h('p', { class: 'muted' }, 'This broadcast has not run yet.'),
  });
}

// ---------- Editor ----------
async function openEditor(existing, preset, refresh) {
  const [media, playlists, destinations] = await Promise.all([api('GET', '/api/media'), api('GET', '/api/playlists'), api('GET', '/api/destinations')]);
  const zone = existing?.schedule?.tz || tz();
  const b = structuredClone(existing || {
    title: '', source: { type: media.length ? 'media' : 'live', mediaId: media[0]?.id }, orientation: 'landscape',
    destination_ids: [], schedule: { type: 'manual' }, duration_min: null, loop: false, enabled: true,
  });
  // Pre-select every destination that can actually take this source.
  if (!existing && !preset.destination_ids) {
    b.destination_ids = destinations.filter((d) => d.enabled && (!platform(d.platform).gated || (d.authorized && (b.source.type === 'live' || d.allow_prerecorded)))).map((d) => d.id);
  }
  Object.assign(b, preset);
  if (preset.source?.mediaId) {
    const m = media.find((x) => x.id === preset.source.mediaId);
    if (m) { b.orientation = m.orientation || b.orientation; b.title = b.title || m.title; }
  }
  b.schedule.tz = b.schedule.tz || zone;

  const title = input({ value: b.title, placeholder: 'e.g. Sunday Service, Daily Lo-fi, Product Launch', maxlength: 120, oninput: (e) => (b.title = e.target.value) });

  // Source
  const sourceBody = h('div');
  const renderSource = () => {
    if (b.source.type === 'media') {
      const ready = media.filter((m) => m.status === 'ready');
      if (!ready.length) return mount(sourceBody, h('div', { class: 'notice warn' }, icon('alert'), h('span', null, 'Your library is empty. ', h('a', { href: '#/library' }, 'Upload a video'), ' first.')));
      if (!ready.find((m) => m.id === b.source.mediaId)) b.source.mediaId = ready[0].id;
      mount(sourceBody, select(ready.map((m) => [m.id, `${m.title} · ${fmtDuration(m.duration)} · ${m.orientation === 'portrait' ? '9:16' : '16:9'}`]), b.source.mediaId, { onchange: (e) => (b.source.mediaId = e.target.value) }));
    } else if (b.source.type === 'playlist') {
      if (!playlists.length) return mount(sourceBody, h('div', { class: 'notice warn' }, icon('alert'), h('span', null, 'No playlists yet. ', h('a', { href: '#/playlists' }, 'Create one'), '.')));
      if (!playlists.find((p) => p.id === b.source.playlistId)) b.source.playlistId = playlists[0].id;
      mount(sourceBody, select(playlists.map((p) => [p.id, `${p.title} · ${p.items.length} videos${p.shuffle ? ' · shuffle' : ''}`]), b.source.playlistId, { onchange: (e) => (b.source.playlistId = e.target.value) }));
    } else {
      mount(sourceBody, h('div', { class: 'notice info' }, icon('camera'), h('span', null, 'Stream from OBS, vMix, a phone app or any RTMP encoder. After saving you get a private server URL and key. When the broadcast is armed (manually or on schedule) your feed is relayed to every selected platform.')));
    }
    renderTiming();
  };

  // Format
  const formatEl = h('div', { class: 'choice-grid', style: { 'grid-template-columns': '1fr 1fr' } });
  const renderFormat = () => mount(formatEl, [['landscape', '16:9 Horizontal', 'YouTube, Facebook, Twitch, X', 'l'], ['portrait', '9:16 Vertical', 'TikTok, Instagram, Shorts, Reels', 'p']].map(([v, l, d, s]) =>
    h('button', { type: 'button', class: ['choice', b.orientation === v && 'on'], onclick: () => { b.orientation = v; renderFormat(); renderDests(); } },
      h('div', { class: 'format-card' }, h('span', { class: ['shape', s] }), h('div', null, h('div', { class: 'title' }, l), h('div', { class: 'muted small' }, d))))));

  // Destinations
  const destEl = h('div', { class: 'choice-grid' });
  const renderDests = () => {
    if (!destinations.length) return mount(destEl, h('div', { class: 'notice warn', style: { 'grid-column': '1 / -1' } }, icon('alert'), h('span', null, 'No destinations yet. ', h('a', { href: '#/destinations' }, 'Add YouTube, Facebook, TikTok…'), ' first.')));
    mount(destEl, destinations.map((d) => {
      const p = platform(d.platform);
      const on = b.destination_ids.includes(d.id);
      const gatedBlock = p.gated && (!d.authorized || (b.source.type !== 'live' && !d.allow_prerecorded));
      const formatWarn = p.formats && !p.formats.includes(b.orientation);
      return h('button', { type: 'button', class: ['choice', on && 'on', !d.enabled && 'disabled'], disabled: !d.enabled, title: d.enabled ? '' : 'Turned off in Destinations', onclick: () => {
        b.destination_ids = on ? b.destination_ids.filter((x) => x !== d.id) : [...b.destination_ids, d.id]; renderDests();
      } },
      h('div', { class: 'title' }, platformBadge(d.platform, 'sm'), h('span', { class: 'ellipsis' }, d.name)),
      h('div', { class: 'muted tiny' }, p.name, !d.keySet && ' · no key'),
      on && gatedBlock && h('div', { class: 'tiny', style: { color: 'var(--err)' } }, d.authorized ? 'Pre-recorded not allowed' : 'LIVE access not confirmed'),
      on && !gatedBlock && formatWarn && h('div', { class: 'tiny', style: { color: 'var(--warn)' } }, `Usually ${p.formats.map((f) => (f === 'portrait' ? '9:16' : '16:9')).join('/')}`));
    }));
  };

  // Schedule
  const schedBody = h('div', { class: 'col' });
  let onceLocal = b.schedule.type === 'once' ? utcToZonedInput(Date.parse(b.schedule.at), b.schedule.tz) : utcToZonedInput(Date.now() + 3600000, b.schedule.tz).replace(/:\d\d$/, ':00');
  if (b.schedule.type !== 'recurring') Object.assign(b.schedule, { time: b.schedule.time || '20:00', days: b.schedule.days || [1, 2, 3, 4, 5] });
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [b.schedule.tz]);
  if (!zones.includes(b.schedule.tz)) zones.unshift(b.schedule.tz);
  const tzSelect = () => select(zones.map((z) => [z, z.replace(/_/g, ' ')]), b.schedule.tz, { onchange: (e) => { b.schedule.tz = e.target.value; renderSchedule(); } });
  const renderSchedule = () => {
    const s = b.schedule;
    if (s.type === 'manual') return mount(schedBody, h('p', { class: 'muted small' }, 'Starts only when you press “Go live”.'));
    if (s.type === 'once') {
      const dt = input({ type: 'datetime-local', value: onceLocal, oninput: (e) => (onceLocal = e.target.value) });
      return mount(schedBody, h('div', { class: 'form-grid' }, field('Start', dt), field('Time zone', tzSelect())));
    }
    const days = h('div', { class: 'days' }, DAY_NAMES.map((n, i) => h('button', { type: 'button', class: s.days.includes(i) && 'on', 'aria-pressed': String(s.days.includes(i)), onclick: () => { s.days = s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort(); renderSchedule(); } }, n.slice(0, 2))));
    const presets = h('div', { class: 'row wrap', style: { gap: '6px' } }, [['Every day', [0, 1, 2, 3, 4, 5, 6]], ['Weekdays', [1, 2, 3, 4, 5]], ['Weekends', [0, 6]]].map(([l, d]) => h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { s.days = d; renderSchedule(); } }, l)));
    mount(schedBody,
      h('div', { class: 'form-grid' },
        field('Start time', input({ type: 'time', value: s.time, oninput: (e) => (s.time = e.target.value) })),
        field('Time zone', tzSelect()),
        h('div', { class: 'field full' }, h('label', null, 'Days'), days, presets),
        field('Starting from (optional)', input({ type: 'date', value: s.from || '', oninput: (e) => (s.from = e.target.value || null) })),
        field('Until (optional)', input({ type: 'date', value: s.until || '', oninput: (e) => (s.until = e.target.value || null) }))),
      h('div', { class: 'hint' }, 'Times follow the selected time zone, including daylight-saving changes.'));
  };
  const schedSeg = segmented([['manual', 'Manual', 'play'], ['once', 'Once', 'calendar'], ['recurring', 'Recurring', 'repeat']], b.schedule.type, (v) => { b.schedule.type = v; renderSchedule(); });

  // Timing
  const timingEl = h('div', { class: 'col' });
  const renderTiming = () => {
    const isLive = b.source.type === 'live';
    const dur = input({ type: 'number', min: 1, step: 1, value: b.duration_min ?? '', placeholder: isLive || b.loop ? 'Until stopped' : 'Until the video ends', oninput: (e) => (b.duration_min = e.target.value === '' ? null : Number(e.target.value)) });
    mount(timingEl,
      h('div', { class: 'form-grid' },
        field('Duration (minutes)', dur, isLive ? 'Live broadcasts stay armed until this ends or you press Stop.' : 'Ends automatically. Leave empty to end with the video.'),
        h('div', { class: 'field' }, h('label', null, 'Quick pick'), h('div', { class: 'row wrap', style: { gap: '6px' } }, [[30, '30m'], [60, '1h'], [120, '2h'], [240, '4h'], [null, isLive ? 'Until stopped' : 'To end']].map(([v, l]) => h('button', { type: 'button', class: 'btn sm', onclick: () => { b.duration_min = v; renderTiming(); } }, l))))),
      !isLive && toggle('Loop the video / playlist', b.loop, (v) => { b.loop = v; renderTiming(); }),
      !isLive && b.loop && h('div', { class: 'notice warn' }, icon('alert'), h('span', null, 'Looping replays the same content. Some platforms (notably TikTok) prohibit looped or pre-recorded LIVE content — Stream Studio blocks those destinations unless you allow it.')));
  };

  const srcSeg = segmented([['media', 'Video', 'film'], ['playlist', 'Playlist', 'list'], ['live', 'Live (OBS)', 'camera']], b.source.type, (v) => { b.source = { type: v, mediaId: b.source.mediaId, playlistId: b.source.playlistId }; renderSource(); renderDests(); });
  const enabled = toggle('Schedule enabled', b.enabled, (v) => (b.enabled = v));

  renderSource(); renderFormat(); renderDests(); renderSchedule(); renderTiming();

  const section = (n, label, ...body) => h('div', { class: 'section' }, h('h3', null, h('span', { class: 'n' }, n), label), ...body);
  const m = modal({
    title: existing ? 'Edit broadcast' : 'New broadcast', drawer: true,
    body: [
      section(1, 'Title', title),
      section(2, 'What to stream', srcSeg, h('div', { style: { 'margin-top': '12px' } }, sourceBody)),
      section(3, 'Format', formatEl),
      section(4, 'Destinations', destEl),
      section(5, 'Schedule', h('div', { class: 'row between wrap' }, schedSeg, enabled), h('div', { style: { 'margin-top': '12px' } }, schedBody)),
      section(6, 'Length', timingEl),
    ],
    actions: [
      { label: 'Cancel' },
      { label: existing ? 'Save changes' : 'Create broadcast', kind: 'primary', icon: 'check', onClick: async () => {
        const body = { ...b, source: { ...b.source } };
        if (body.schedule.type === 'once') {
          if (!onceLocal) throw new Error('Pick a start date and time');
          const at = zonedToUtc(onceLocal, body.schedule.tz);
          if (at < Date.now() - 60000) throw new Error('That start time is in the past');
          body.schedule = { type: 'once', at: new Date(at).toISOString(), tz: body.schedule.tz };
        } else if (body.schedule.type === 'manual') body.schedule = { type: 'manual' };
        const res = existing ? await api('PUT', `/api/broadcasts/${existing.id}`, body) : await api('POST', '/api/broadcasts', body);
        toast(existing ? 'Broadcast saved' : 'Broadcast created');
        (res.warnings || []).forEach((w) => toast(w, 'warn', 9000));
        await refresh(true);
        if (!existing && body.source.type === 'live') {
          const created = (await api('GET', '/api/broadcasts')).find((x) => x.id === res.id);
          if (created) showIngest(created, refresh);
        }
      } },
    ],
  });
  return m.done;
}
