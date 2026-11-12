import { h, mount, icon, api, modal, input, toggle, fmtDuration, ratioTag, toast, errorToast, confirmDialog, emptyState } from '../ui.js';

export async function playlistsView(root, [selectedId]) {
  const [playlists, media] = await Promise.all([api('GET', '/api/playlists'), api('GET', '/api/media')]);
  const byId = new Map(media.map((m) => [m.id, m]));
  let current = playlists.find((p) => p.id === selectedId) || playlists[0] || null;

  const listEl = h('div', { class: 'card', style: { padding: '8px' } });
  const editorEl = h('div');
  const body = h('div');
  const newPlaylist = () => { current = { id: null, title: 'New playlist', items: [], shuffle: false }; render(); };
  mount(root,
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, 'Playlists'), h('p', null, 'Line up videos into a show. Broadcasts can play a playlist once or loop it.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: newPlaylist }, icon('plus'), 'New playlist'))),
    body);

  const duration = (items) => items.reduce((t, id) => t + (byId.get(id)?.duration || 0), 0);

  function render() {
    if (!current) return mount(body, emptyState('list', 'No playlists yet', 'Combine several videos into one programme, in the order you choose.', h('button', { class: 'btn primary', onclick: newPlaylist }, icon('plus'), 'Create playlist')));
    if (!body.contains(listEl)) mount(body, h('div', { class: 'split' }, listEl, editorEl));
    mount(listEl, playlists.length ? playlists.map((p) => h('div', { class: ['pl-item', current && current.id === p.id && 'on'], onclick: () => { current = p; location.hash = `#/playlists/${p.id}`; } },
      h('div', { class: 'bc-icon', style: { width: '38px', height: '38px' } }, icon('list')),
      h('div', { class: 'grow' }, h('div', { class: 'ellipsis', style: { 'font-weight': '600' } }, p.title), h('div', { class: 'muted small' }, `${p.items.length} videos · ${fmtDuration(duration(p.items))}${p.shuffle ? ' · shuffle' : ''}`))))
      : h('div', { class: 'muted small', style: { padding: '12px' } }, 'Unsaved playlist'));
    renderEditor();
  }

  function renderEditor() {
    const draft = { ...current, items: [...current.items] };
    const title = input({ value: draft.title, maxlength: 120, style: { 'font-size': '16px', 'font-weight': '600' }, oninput: (e) => (draft.title = e.target.value) });
    const tracks = h('div');
    const summary = h('span', { class: 'muted small' });
    let dragIndex = null;
    const renderTracks = () => {
      summary.textContent = `${draft.items.length} videos · ${fmtDuration(duration(draft.items))}`;
      if (!draft.items.length) return mount(tracks, h('div', { class: 'muted small', style: { padding: '24px', 'text-align': 'center', border: '1px dashed var(--line-2)', 'border-radius': '12px' } }, 'No videos yet. Add some from your library.'));
      mount(tracks, draft.items.map((id, i) => {
        const m = byId.get(id);
        const row = h('div', { class: 'track', draggable: 'true' },
          h('span', { class: 'handle', title: 'Drag to reorder' }, icon('grip')),
          h('span', { class: 'num' }, i + 1),
          h('div', { class: 'mini' }, m && h('img', { src: `/files/thumbs/${id}.jpg`, alt: '', onerror: (e) => e.target.remove() })),
          h('div', { class: 'grow' }, h('div', { class: 'ellipsis', style: { 'font-weight': '600' } }, m ? m.title : 'Deleted video'), h('div', { class: 'row small muted', style: { gap: '8px' } }, m && ratioTag(m.orientation), m && fmtDuration(m.duration))),
          h('button', { class: 'btn ghost sm icon', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]]; renderTracks(); } }, icon('up')),
          h('button', { class: 'btn ghost sm icon', 'aria-label': 'Move down', disabled: i === draft.items.length - 1, onclick: () => { [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]]; renderTracks(); } }, icon('down')),
          h('button', { class: 'btn ghost sm icon danger', 'aria-label': 'Remove', onclick: () => { draft.items.splice(i, 1); renderTracks(); } }, icon('x')));
        row.addEventListener('dragstart', () => { dragIndex = i; row.classList.add('dragging'); });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-before'); });
        row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
        row.addEventListener('drop', (e) => { e.preventDefault(); if (dragIndex == null) return; const [moved] = draft.items.splice(dragIndex, 1); draft.items.splice(dragIndex < i ? i - 1 : i, 0, moved); dragIndex = null; renderTracks(); });
        return row;
      }));
    };
    renderTracks();

    mount(editorEl, h('div', { class: 'card card-pad col', style: { gap: '16px' } },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, title)),
      h('div', { class: 'row between wrap' }, summary, toggle('Shuffle order each time it plays', draft.shuffle, (v) => (draft.shuffle = v))),
      tracks,
      h('div', { class: 'row between wrap' },
        h('button', { class: 'btn', onclick: async () => { const picked = await pickMedia(media, draft.items); if (picked) { draft.items.push(...picked); renderTracks(); } } }, icon('plus'), 'Add videos'),
        h('div', { class: 'row' },
          draft.id && h('button', { class: 'btn danger', onclick: async () => {
            if (!(await confirmDialog('Delete playlist?', `“${draft.title}” will be deleted. Videos stay in your library.`, { label: 'Delete' }))) return;
            try { await api('DELETE', `/api/playlists/${draft.id}`); toast('Playlist deleted'); location.hash = '#/playlists'; playlistsView(root, []); } catch (e) { errorToast(e); }
          } }, icon('trash'), 'Delete'),
          h('button', { class: 'btn primary', onclick: async () => {
            try {
              if (draft.id) await api('PUT', `/api/playlists/${draft.id}`, draft);
              else draft.id = (await api('POST', '/api/playlists', draft)).id;
              toast('Playlist saved');
              location.hash = `#/playlists/${draft.id}`;
              playlistsView(root, [draft.id]);
            } catch (e) { errorToast(e); }
          } }, icon('check'), 'Save playlist'))),
      h('div', { class: 'notice info' }, icon('info'), h('span', null, 'Every video is streamed from its converted version for the broadcast’s format, so mixed 16:9 and 9:16 videos play smoothly in one show.'))));
  }
  render();
}

function pickMedia(media, existing) {
  const chosen = [];
  const ready = media.filter((m) => m.status === 'ready');
  const grid = h('div', { class: 'pick-grid' }, ready.map((m) => {
    const el = h('div', { class: 'pick', onclick: () => {
      const i = chosen.indexOf(m.id);
      if (i >= 0) chosen.splice(i, 1); else chosen.push(m.id);
      el.classList.toggle('on', chosen.includes(m.id));
    } }, h('div', { class: 'mini' }, h('img', { src: `/files/thumbs/${m.id}.jpg`, alt: '', onerror: (e) => e.target.remove() })), h('div', { class: 't ellipsis' }, m.title, existing.includes(m.id) ? ' ✓' : ''));
    return el;
  }));
  return modal({
    title: 'Add videos', wide: true,
    body: ready.length ? [h('p', { class: 'muted small' }, 'Click videos in the order you want them added.'), grid] : h('p', { class: 'muted' }, 'Upload videos to your library first.'),
    actions: [{ label: 'Cancel' }, { label: 'Add selected', kind: 'primary', onClick: () => chosen }],
  }).done;
}
