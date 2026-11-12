import { h, mount, icon, api, modal, field, input, select, toggle, platformBadge, platform, relTime, toast, errorToast, confirmDialog, emptyState, store } from '../ui.js';

export async function destinationsView(root) {
  const grid = h('div');
  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Destinations'), h('p', null, 'Where your broadcasts go. Stream keys are encrypted on the server and never shown again in full.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => addFlow(reload) }, icon('plus'), 'Add destination'))),
    grid);
  async function reload() {
    const list = await api('GET', '/api/destinations');
    if (!list.length) return mount(grid, emptyState('send', 'Connect your first platform', 'Add YouTube, Facebook, TikTok, Instagram, Twitch, Kick, X, LinkedIn or any custom RTMP server. Each one gets its own independent connection.', h('button', { class: 'btn primary', onclick: () => addFlow(reload) }, icon('plus'), 'Add destination')));
    mount(grid, h('div', { class: 'dest-grid' }, list.map((d) => card(d, reload))));
  }
  await reload();
}

function card(d, reload) {
  const p = platform(d.platform);
  const host = (() => { try { return new URL(d.server_url).host; } catch { return d.server_url; } })();
  const test = d.last_test;
  const result = h('div', { class: 'small' }, test ? h('span', { class: ['pill', test.ok ? 'ok' : 'err'] }, test.ok ? `Reachable · ${test.ms} ms` : test.error, ' · ', relTime(test.at)) : h('span', { class: 'muted' }, 'Not tested yet'));
  let gate = null;
  if (p.gated) {
    gate = !d.authorized ? h('div', { class: 'notice warn' }, icon('alert'), h('span', null, 'LIVE encoder access not confirmed — this destination is blocked.'))
      : !d.allow_prerecorded ? h('div', { class: 'notice info' }, icon('shield'), h('span', null, 'Real-time LIVE only. Pre-recorded broadcasts skip this destination.')) : null;
  }
  return h('div', { class: ['card', 'dest', !d.enabled && 'off'], style: { '--c': p.color } },
    h('div', { class: 'row between' },
      h('div', { class: 'row', style: { 'min-width': '0' } }, platformBadge(d.platform, 'lg'), h('div', { style: { 'min-width': '0' } }, h('h3', { class: 'ellipsis' }, d.name), h('div', { class: 'muted small' }, p.name))),
      toggle(null, d.enabled, async (v) => { try { await api('PUT', `/api/destinations/${d.id}`, { enabled: v }); toast(v ? `${d.name} enabled` : `${d.name} turned off`); reload(); } catch (e) { errorToast(e); } })),
    h('dl', { class: 'kv' },
      h('dt', null, 'Server'), h('dd', { class: 'mono', title: d.server_url }, host),
      h('dt', null, 'Stream key'), h('dd', { class: 'mono' }, d.keySet ? d.keyHint : h('span', { style: { color: 'var(--warn)' } }, 'Not set')),
      h('dt', null, 'Formats'), h('dd', null, (p.formats || []).map((f) => (f === 'portrait' ? '9:16' : '16:9')).join(' · '))),
    gate,
    d.notes && h('div', { class: 'muted small' }, d.notes),
    h('div', { class: 'row between wrap' }, result,
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn sm', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const r = await api('POST', `/api/destinations/${d.id}/test`); toast(r.ok ? `${d.name}: server reachable (${r.ms} ms)` : `${d.name}: ${r.error}`, r.ok ? 'ok' : 'err'); reload(); } catch (x) { errorToast(x); } finally { b.disabled = false; }
        } }, icon('wifi'), 'Test'),
        h('button', { class: 'btn sm icon', 'aria-label': 'Edit', onclick: () => editForm(d.platform, d, reload) }, icon('edit')),
        h('button', { class: 'btn sm icon danger', 'aria-label': 'Delete', onclick: async () => {
          if (!(await confirmDialog('Delete destination?', `“${d.name}” will be removed from all broadcasts. Its stream key is deleted from the server.`, { label: 'Delete' }))) return;
          try { await api('DELETE', `/api/destinations/${d.id}`); toast('Destination deleted'); reload(); } catch (x) { errorToast(x); }
        } }, icon('trash')))));
}

function addFlow(reload) {
  const plats = store.meta.platforms;
  const m = modal({
    title: 'Add destination', wide: true,
    body: [h('p', { class: 'muted' }, 'Choose a platform. You can add several of the same (for example two YouTube channels).'),
      h('div', { class: 'platform-grid' }, Object.entries(plats).map(([id, p]) => h('button', { type: 'button', class: 'platform-tile', onclick: () => { m.close(); editForm(id, null, reload); } }, platformBadge(id, 'lg'), p.name, p.gated && h('span', { class: 'tiny muted' }, 'Access required'))))],
  });
}

function editForm(platformId, existing, reload) {
  const p = platform(platformId);
  const name = input({ value: existing?.name || p.name, maxlength: 80 });
  const servers = p.servers || [];
  const custom = !servers.length || (existing && !servers.includes(existing.server_url));
  const serverInput = input({ value: existing?.server_url || servers[0] || '', placeholder: 'rtmps://… or rtmp://…', class: ['input', !custom && servers.length && 'hidden'].filter(Boolean).join(' ') });
  const serverSelect = servers.length ? select([...servers.map((s) => [s, s.startsWith('rtmps') ? `${s}  (encrypted, recommended)` : s]), ['__custom', 'Custom server URL…']], custom ? '__custom' : (existing?.server_url || servers[0]), {
    onchange: (e) => { const c = e.target.value === '__custom'; serverInput.classList.toggle('hidden', !c); if (!c) serverInput.value = e.target.value; else serverInput.focus(); },
  }) : null;
  let showKey = false;
  const key = input({ type: 'password', autocomplete: 'off', spellcheck: false, placeholder: existing?.keySet ? `Saved (${existing.keyHint}) — leave empty to keep` : 'Paste your stream key' });
  const eye = h('button', { type: 'button', class: 'btn icon', 'aria-label': 'Show key', onclick: () => { showKey = !showKey; key.type = showKey ? 'text' : 'password'; mount(eye, icon(showKey ? 'eyeOff' : 'eye')); } }, icon('eye'));
  const notes = input({ value: existing?.notes || '', placeholder: 'Optional — e.g. which channel or page', maxlength: 500 });
  const state = { authorized: existing ? existing.authorized : false, allow_prerecorded: existing ? existing.allow_prerecorded : false };

  const gate = p.gated ? h('div', { class: 'col' },
    h('div', { class: 'notice warn' }, icon('shield'), h('span', null, h('b', null, `${p.name} policy gate. `), 'LIVE via streaming software is only available to some accounts, and TikTok Shop LIVE rules prohibit pre-recorded and looped content. Confirm what applies to your account.')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.authorized, onchange: (e) => (state.authorized = e.target.checked) }),
      h('span', null, h('b', null, 'My account has LIVE encoder access'), h('div', { class: 'muted small' }, `${p.name} gave me a server URL and stream key for third-party streaming software.`))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.allow_prerecorded, onchange: (e) => (state.allow_prerecorded = e.target.checked) }),
      h('span', null, h('b', null, 'Allow pre-recorded broadcasts to this destination'), h('div', { class: 'muted small' }, 'Only tick this if you have confirmed pre-recorded/looped LIVE is permitted for your account and content. Otherwise this destination is used for real-time OBS broadcasts only.')))) : null;

  const guide = h('div', { class: 'guide' }, h('div', { class: 'row between' }, h('b', null, `How to get your ${p.name} key`), p.docs && h('a', { href: p.docs, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Official help ', icon('external'))),
    h('ol', null, (p.guide || []).map((g) => h('li', null, g))));

  modal({
    title: existing ? `Edit ${existing.name}` : `Add ${p.name}`, wide: true,
    body: [
      h('div', { class: 'row' }, platformBadge(platformId, 'lg'), h('div', null, h('h3', null, p.name), h('div', { class: 'muted small' }, `Best formats: ${(p.formats || []).map((f) => (f === 'portrait' ? '9:16' : '16:9')).join(' · ')}`))),
      guide,
      h('div', { class: 'form-grid' },
        field('Name', name, 'Shown on your dashboard'),
        field('Notes', notes),
        h('div', { class: 'field full' }, h('label', null, 'Server URL'), serverSelect, serverInput),
        h('div', { class: 'field full' }, h('label', null, p.keyLabel || 'Stream key'), h('div', { class: 'input-group' }, key, eye), h('div', { class: 'hint' }, 'Encrypted with AES-256-GCM on your server. It is never sent back to the browser.'))),
      gate,
    ],
    actions: [
      { label: 'Cancel' },
      { label: existing ? 'Save' : 'Add destination', kind: 'primary', icon: 'check', onClick: async () => {
        const body = { platform: platformId, name: name.value, server_url: serverInput.value.trim(), notes: notes.value, ...state };
        if (key.value.trim()) body.key = key.value.trim();
        if (existing) await api('PUT', `/api/destinations/${existing.id}`, body);
        else await api('POST', '/api/destinations', body);
        toast(existing ? 'Destination saved' : `${p.name} added`);
        reload();
      } },
    ],
  });
}
