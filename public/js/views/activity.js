import { h, mount, icon, api, poll, fmtBytes, fmtHuman, fmtDate, segmented } from '../ui.js';

export async function activityView(root) {
  const health = h('div', { class: 'health-grid' });
  const list = h('div');
  let level = '', category = '', events = [];
  const more = h('button', { class: 'btn sm', onclick: () => load(true) }, 'Load older');
  const filters = h('div', { class: 'filters' },
    segmented([['', 'All'], ['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Info']], level, (v) => { level = v; load(); }),
    segmented([['', 'Everything'], ['broadcast', 'Broadcasts'], ['schedule', 'Schedule'], ['media', 'Media'], ['security', 'Security'], ['system', 'System']], category, (v) => { category = v; load(); }));
  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Activity'), h('p', null, 'Server health and a complete log of what happened, kept for 60 days.'))),
    health,
    h('div', { class: 'card' }, filters, list, h('div', { class: 'row', style: { padding: '12px 18px', 'justify-content': 'center' } }, more)));

  async function load(older) {
    const q = new URLSearchParams();
    if (level) q.set('level', level);
    if (category) q.set('category', category);
    if (older && events.length) q.set('before', events[events.length - 1].id);
    const batch = await api('GET', `/api/events?${q}`);
    events = older ? [...events, ...batch] : batch;
    more.classList.toggle('hidden', batch.length < 100);
    mount(list, events.length ? events.map((e) => h('div', { class: ['event', e.level] }, h('span', { class: 'dot' }), h('span', { class: 'tag' }, e.category), h('span', { class: 'grow' }, e.message), h('time', { title: new Date(e.ts).toISOString() }, fmtDate(e.ts, { extra: { second: '2-digit' } }))))
      : h('div', { class: 'event muted' }, 'Nothing here.'));
  }
  load();

  poll(root, async () => {
    const hl = await api('GET', '/api/health');
    if (!hl.ok) return mount(health, h('div', { class: 'card card-pad notice err', style: { 'grid-column': '1 / -1' } }, icon('xCircle'), `Streaming engine offline: ${hl.error || ''}`));
    const tile = (ic, label, value, sub, ok = true) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, icon(ic), label), h('div', { class: 'value', style: { color: ok ? '' : 'var(--err)' } }, value), sub && h('div', { class: 'meta' }, sub));
    mount(health,
      tile('server', 'Engine', 'Running', `Up ${fmtHuman(hl.uptimeSec)}`),
      tile('layers', 'Media relay', hl.relay ? 'Online' : 'Offline', 'MediaMTX', hl.relay),
      tile('cpu', 'CPU', `${hl.cpu.percent}%`, `${hl.cpu.cores} cores · load ${hl.cpu.load.map((x) => x.toFixed(2)).join(' ')}`),
      tile('zap', 'Memory', fmtBytes(hl.memory.total - hl.memory.free), `of ${fmtBytes(hl.memory.total)}`),
      tile('disk', 'Disk free', hl.disk ? fmtBytes(hl.disk.free) : '—', hl.disk ? `of ${fmtBytes(hl.disk.total)}` : ''),
      tile('wifi', 'Network', `↑ ${hl.network.txMbps.toFixed(1)} Mbps`, `↓ ${hl.network.rxMbps.toFixed(1)} Mbps`),
      tile('film', 'Conversions', hl.prepQueue.processing + hl.prepQueue.queued || 'Idle', hl.prepQueue.queued ? `${hl.prepQueue.queued} waiting` : ''));
  }, 3000);
}
