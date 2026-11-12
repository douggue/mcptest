import { h, mount, icon, api, poll, fmtDuration, fmtHuman, fmtBytes, fmtDate, fmtTime, relTime, fmtMbps, platformBadge, ratioTag, stateDot, confirmDialog, toast, errorToast, store } from '../ui.js';

const STATE_LABEL = { starting: 'Starting', waiting: 'Waiting for source', live: 'Live', ending: 'Ending' };
const OUT_LABEL = { pending: 'Queued', connecting: 'Connecting', live: 'Live', retrying: 'Retrying', waiting: 'Waiting for source', failed: 'Failed', blocked: 'Blocked', completed: 'Completed', stopped: 'Stopped' };

export async function overviewView(root) {
  const head = h('div', { class: 'page-head' },
    h('div', null, h('h1', null, 'Overview'), h('p', null, 'What is on air, what is next, and how the server is doing.')),
    h('div', { class: 'actions' },
      h('a', { class: 'btn', href: '#/library' }, icon('upload'), 'Upload video'),
      h('a', { class: 'btn primary', href: '#/broadcasts/new' }, icon('plus'), 'New broadcast')));
  const kpis = h('div', { class: 'kpis' }, Array.from({ length: 5 }, () => h('div', { class: 'card kpi skeleton', style: { height: '96px' } })));
  const liveWrap = h('div');
  const side = h('div', { class: 'col', style: { gap: '18px' } });
  mount(root, head, kpis, h('div', { class: 'overview-grid' }, liveWrap, side));

  const players = new Map(); // runId -> { card, hls }
  let data;
  const stop = poll(root, async () => {
    data = await api('GET', '/api/overview');
    renderKpis(kpis, data);
    renderLive(liveWrap, data, players);
    renderSide(side, data);
  }, 2500);
  // Tick timers between polls
  const tick = setInterval(() => { if (!root.isConnected) { clearInterval(tick); stop(); players.forEach((p) => p.hls && p.hls.destroy()); return; } root.querySelectorAll('[data-since]').forEach((el) => { el.textContent = fmtDuration((Date.now() - +el.dataset.since) / 1000); }); root.querySelectorAll('[data-until]').forEach((el) => { el.textContent = fmtHuman(Math.max(0, (+el.dataset.until - Date.now()) / 1000)); }); }, 1000);
}

function kpi(ic, label, value, meta, meter) {
  return h('div', { class: 'card kpi' }, h('div', { class: 'label' }, icon(ic), label), h('div', { class: 'value' }, value), meter, meta && h('div', { class: 'meta' }, meta));
}
function meterEl(frac) {
  const pct = Math.max(0, Math.min(100, frac * 100));
  return h('div', { class: ['meter', pct > 90 ? 'err' : pct > 75 ? 'warn' : ''] }, h('i', { style: { width: pct + '%' } }));
}

function renderKpis(el, d) {
  const hl = d.health || {};
  const next = d.upcoming[0];
  const liveCount = d.live.filter((l) => l.state === 'live').length;
  const disk = hl.disk;
  mount(el,
    kpi('radio', 'On air', liveCount ? h('span', { style: { color: 'var(--live)' } }, `${liveCount} live`) : 'Off air', `${d.live.length} active · ${store.meta.prefs.maxConcurrent} max`),
    kpi('clock', 'Next broadcast', next ? h('span', { 'data-until': next.at }, fmtHuman((next.at - Date.now()) / 1000)) : '—', next ? `${next.title} · ${fmtDate(next.at, { weekday: true })}` : 'Nothing scheduled'),
    kpi('wifi', 'Upload now', hl.network ? `${hl.network.txMbps.toFixed(1)} Mbps` : '—', hl.relay === false ? h('span', { style: { color: 'var(--err)' } }, 'Media relay offline') : `${d.counts.destinations} destinations ready`),
    kpi('cpu', 'CPU', hl.cpu ? `${hl.cpu.percent}%` : '—', hl.prepQueue && (hl.prepQueue.processing || hl.prepQueue.queued) ? `Preparing ${hl.prepQueue.processing + hl.prepQueue.queued} video(s)` : hl.cpu ? `${hl.cpu.cores} cores · load ${hl.cpu.load[0].toFixed(2)}` : 'Engine offline', hl.cpu && meterEl(hl.cpu.percent / 100)),
    kpi('disk', 'Storage', disk ? `${fmtBytes(disk.free)} free` : '—', disk ? `${fmtBytes(hl.mediaBytes)} of media` : '', disk && meterEl(1 - disk.free / disk.total)));
}

function renderLive(el, d, players) {
  const ids = new Set(d.live.map((l) => l.runId));
  for (const [id, p] of players) if (!ids.has(id)) { p.hls && p.hls.destroy(); players.delete(id); }
  if (!d.live.length) {
    if (!el.querySelector('.empty-hero')) {
      mount(el, h('div', { class: 'card empty-hero' },
        h('div', { class: 'orb' }, icon('radio')), h('h2', null, 'Nothing on air right now'),
        h('p', null, d.upcoming[0] ? `Next up: “${d.upcoming[0].title}” ${relTime(d.upcoming[0].at)}.` : 'Schedule a pre-recorded show or go live from OBS to every platform at once.'),
        h('div', { class: 'row wrap', style: { 'justify-content': 'center' } },
          h('a', { class: 'btn primary', href: '#/broadcasts/new' }, icon('plus'), 'New broadcast'),
          h('a', { class: 'btn', href: '#/broadcasts' }, icon('play'), 'Start an existing one'))));
    }
    return;
  }
  el.querySelector('.empty-hero')?.remove();
  for (const L of d.live) {
    let p = players.get(L.runId);
    if (!p) { p = { card: liveCard(L), hls: null, previewOn: false }; players.set(L.runId, p); el.append(p.card.root); }
    p.card.update(L, p);
  }
  for (const c of [...el.children]) if (!ids.has(c.dataset.run)) c.remove();
}

function liveCard(L) {
  const badge = h('span', { class: 'pill' });
  const title = h('h2', null, L.title);
  const sub = h('div', { class: 'muted small' });
  const preview = h('div', { class: 'preview' });
  const timeline = h('div', { class: 'timeline' });
  const stats = h('div', { class: 'stats-row' });
  const outputs = h('div', { class: 'outputs' });
  const stopBtn = h('button', { class: 'btn danger sm', onclick: async () => {
    if (!(await confirmDialog('Stop broadcast?', `“${L.title}” will end on every platform now.`, { label: 'Stop broadcast' }))) return;
    try { await api('POST', `/api/runs/${L.runId}/stop`); toast('Stopping broadcast…'); } catch (e) { errorToast(e); }
  } }, icon('stop'), 'Stop');
  const root = h('div', { class: ['card', 'live-card', L.orientation], 'data-run': L.runId },
    h('div', { class: 'live-body' }, preview,
      h('div', { class: 'col', style: { gap: '4px', 'min-width': '0' } },
        h('div', { class: 'row between' }, h('div', { class: 'live-title' }, badge, title, ratioTag(L.orientation)), stopBtn),
        sub, timeline, stats, outputs)));

  function setPreview(L, p) {
    const playing = preview.querySelector('video');
    if (p.previewOn && L.state === 'live' && !playing) {
      const video = h('video', { muted: true, autoplay: true, playsinline: true, controls: true });
      video.muted = true;
      mount(preview, video, h('span', { class: 'badge pill live' }, h('span', { class: 'dot pulse' }), 'PREVIEW'));
      const src = `/preview/${L.previewPath}/index.m3u8`;
      const play = () => video.play().catch(() => {});
      if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = src; video.addEventListener('loadedmetadata', play, { once: true }); }
      else loadHls().then((Hls) => {
        if (!Hls?.isSupported()) return;
        p.hls = new Hls({ liveSyncDurationCount: 2 });
        p.hls.on(Hls.Events.MANIFEST_PARSED, play);
        p.hls.loadSource(src); p.hls.attachMedia(video);
      });
    } else if ((!p.previewOn || L.state !== 'live') && (playing || p.placeholderFor !== L.state)) {
      if (p.hls) { p.hls.destroy(); p.hls = null; }
      p.placeholderFor = L.state;
      if (L.state !== 'live') p.previewOn = false;
      mount(preview, h('div', { class: 'placeholder' }, icon(L.state === 'live' ? 'eye' : 'clock'),
        L.state === 'live' ? h('button', { class: 'btn sm', onclick: () => { p.previewOn = true; setPreview(L, p); } }, 'Show preview') : STATE_LABEL[L.state] || L.state,
        L.state === 'live' && h('span', null, 'Uses about 6 Mbps of your download')));
    }
  }

  function update(L, p) {
    const isLive = L.state === 'live';
    badge.className = ['pill', isLive ? 'live' : 'warn'].join(' ');
    mount(badge, h('span', { class: ['dot', isLive && 'pulse'] }), isLive ? 'LIVE' : (STATE_LABEL[L.state] || L.state).toUpperCase());
    const src = L.sourceType === 'live' ? (L.sourceState === 'connected' ? 'OBS / encoder connected' : 'Waiting for OBS / encoder to connect') : `Pre-recorded${L.loop ? ' · looping' : ''}${L.sourceRestarts ? ` · playback restarted ${L.sourceRestarts}×` : ''}`;
    mount(sub, src);
    if (L.sourceType !== 'live' && L.totalDuration) {
      const pos = L.loop ? L.position % L.totalDuration : L.position;
      mount(timeline, h('div', { class: 'meter' }, h('i', { style: { width: Math.min(100, (pos / L.totalDuration) * 100) + '%' } })),
        h('div', { class: 'row between tiny muted', style: { 'margin-top': '6px' } }, h('span', null, fmtDuration(pos)), h('span', null, fmtDuration(L.totalDuration))));
    } else mount(timeline);
    const totalKbps = L.outputs.reduce((t, o) => t + (o.kbps || 0), 0);
    mount(stats,
      h('div', { class: 'stat' }, h('b', L.liveAt ? { 'data-since': L.liveAt } : null, L.liveAt ? fmtDuration((Date.now() - L.liveAt) / 1000) : '—'), h('span', null, 'On air')),
      h('div', { class: 'stat' }, h('b', L.endsAt ? { 'data-until': L.endsAt } : null, L.endsAt ? fmtHuman((L.endsAt - Date.now()) / 1000) : (L.sourceType === 'live' || L.loop ? 'Until stopped' : 'End of video')), h('span', null, 'Ends in')),
      h('div', { class: 'stat' }, h('b', null, `${L.outputs.filter((o) => o.state === 'live').length}/${L.outputs.length}`), h('span', null, 'Outputs live')),
      h('div', { class: 'stat' }, h('b', null, fmtMbps(totalKbps)), h('span', null, 'Total upload')));
    mount(outputs, L.outputs.map((o) => h('div', { class: ['output', o.state] },
      platformBadge(o.platform),
      h('div', { class: 'grow' },
        h('div', { class: 'name ellipsis' }, o.name),
        h('div', { class: 'state ellipsis', title: o.lastError || '' },
          h('span', { class: ['pill', stateDot(o.state)], style: { height: '18px', 'font-size': '10.5px' } }, OUT_LABEL[o.state] || o.state),
          ' ', o.state === 'live' ? h('span', { class: 'kbps' }, fmtMbps(o.kbps)) : o.state === 'retrying' && o.retryAt ? `in ${Math.max(0, Math.round((o.retryAt - Date.now()) / 1000))}s` : o.lastError ? o.lastError : '')),
      o.state === 'failed' && h('button', { class: 'btn sm', onclick: async () => { try { await api('POST', `/api/runs/${L.runId}/outputs/${o.destinationId}/retry`); toast(`Reconnecting ${o.name}…`); } catch (e) { errorToast(e); } } }, icon('refresh'), 'Retry'))));
    setPreview(L, p);
  }
  return { root, update };
}

let hlsPromise;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  hlsPromise = hlsPromise || new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/vendor/hls.light.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => resolve(null);
    document.head.append(s);
  });
  return hlsPromise;
}

function renderSide(el, d) {
  const destName = (id) => d.destinations.find((x) => x.id === id);
  mount(el,
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Up next'), h('a', { class: 'small', href: '#/broadcasts' }, 'All broadcasts')),
      h('div', { class: 'list', style: { 'margin-top': '8px' } },
        d.upcoming.length ? d.upcoming.map((u) => h('a', { class: 'list-item', href: `#/broadcasts/${u.id}`, style: { color: 'inherit', 'text-decoration': 'none' } },
          h('div', { class: 'grow' },
            h('div', { class: 'ellipsis', style: { 'font-weight': '600' } }, u.title),
            h('div', { class: 'row small muted', style: { 'margin-top': '3px', gap: '8px' } }, ratioTag(u.orientation),
              h('span', { class: 'avatars' }, u.destinationIds.map((id) => destName(id) && platformBadge(destName(id).platform, 'sm'))))),
          h('div', { class: 'when small' }, h('b', null, relTime(u.at)), h('span', { class: 'muted' }, fmtDate(u.at, { weekday: true })))))
          : h('div', { class: 'list-item muted small' }, 'No scheduled broadcasts. Add a schedule to run shows automatically.'))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Recent activity'), h('a', { class: 'small', href: '#/activity' }, 'View all')),
      h('div', { style: { padding: '8px 0' } }, d.events.length ? d.events.map((e) => h('div', { class: ['event', e.level] }, h('span', { class: 'dot' }), h('span', { class: 'grow' }, e.message), h('time', null, relTime(e.ts)))) : h('div', { class: 'event muted' }, 'No activity yet.'))),
    h('div', { class: 'card card-pad' },
      h('div', { class: 'row between' }, h('h3', null, 'Last 7 days'), h('span', { class: 'muted small' }, `${d.counts.media} videos · ${d.counts.broadcasts} broadcasts`)),
      h('div', { class: 'stats-row', style: { 'margin-top': '12px' } },
        h('div', { class: 'stat' }, h('b', null, d.counts.runs7d), h('span', null, 'Broadcasts run')),
        h('div', { class: 'stat' }, h('b', { style: { color: d.counts.failed7d ? 'var(--err)' : 'inherit' } }, d.counts.failed7d), h('span', null, 'Failed / missed')))));
}
