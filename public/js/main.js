import { h, mount, icon, logoMark, api, store, toast, errorToast, poll, input, field } from './ui.js';
import { overviewView } from './views/overview.js';
import { libraryView } from './views/library.js';
import { playlistsView } from './views/playlists.js';
import { broadcastsView } from './views/broadcasts.js';
import { destinationsView } from './views/destinations.js';
import { activityView } from './views/activity.js';
import { settingsView } from './views/settings.js';

const ROUTES = [
  { id: 'overview', label: 'Overview', icon: 'home', view: overviewView, tab: true },
  { id: 'broadcasts', label: 'Broadcasts', icon: 'radio', view: broadcastsView, tab: true },
  { id: 'library', label: 'Library', icon: 'film', view: libraryView, tab: true },
  { id: 'playlists', label: 'Playlists', icon: 'list', view: playlistsView },
  { id: 'destinations', label: 'Destinations', icon: 'send', view: destinationsView, tab: true },
  { id: 'activity', label: 'Activity', icon: 'activity', view: activityView },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settingsView, tab: true },
];

const app = document.getElementById('app');
let shell = null;

function brand(sub = 'Personal broadcast control') {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, logoMark()), h('span', null, 'Stream Studio', h('small', null, sub)));
}

// ---------- Auth screens ----------
function authScreen(state) {
  const err = h('div', { class: 'notice err hidden' });
  const showErr = (m) => { err.replaceChildren(icon('xCircle'), h('span', null, m)); err.classList.remove('hidden'); };
  let form;
  if (state.setupNeeded) {
    const pw = input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 10 characters' });
    const pw2 = input({ type: 'password', autocomplete: 'new-password' });
    const code = state.setupCodeRequired ? input({ placeholder: 'From SETUP_CODE in your .env file', autocomplete: 'off' }) : null;
    form = h('form', { class: 'col', onsubmit: async (e) => {
      e.preventDefault();
      if (pw.value !== pw2.value) return showErr('Passwords do not match');
      try { await api('POST', '/api/auth/setup', { password: pw.value, setupCode: code?.value }); boot(); } catch (x) { showErr(x.message); }
    } },
    h('div', null, h('h1', null, 'Welcome to your studio'), h('p', { class: 'muted', style: { 'margin-top': '6px' } }, 'Create the owner password. This dashboard has a single private account.')),
    code && field('Setup code', code), field('Password', pw), field('Confirm password', pw2), err,
    h('button', { class: 'btn primary block', type: 'submit' }, 'Create account'));
  } else if (state.mfaRequired) {
    const code = input({ inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123 456', maxlength: 7 });
    form = h('form', { class: 'col', onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/auth/mfa', { code: code.value }); boot(); } catch (x) { showErr(x.message); code.select(); }
    } },
    h('div', null, h('h1', null, 'Two-factor code'), h('p', { class: 'muted', style: { 'margin-top': '6px' } }, 'Enter the 6-digit code from your authenticator app.')),
    field(null, code), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Verify'),
    h('button', { class: 'btn ghost block', type: 'button', onclick: async () => { await api('POST', '/api/auth/logout'); boot(); } }, 'Use a different account'));
  } else {
    const pw = input({ type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
    form = h('form', { class: 'col', onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/auth/login', { password: pw.value }); boot(); } catch (x) { showErr(x.message); pw.select(); }
    } },
    h('div', null, h('h1', null, 'Sign in'), h('p', { class: 'muted', style: { 'margin-top': '6px' } }, 'Your private streaming control room.')),
    field(null, pw), err, h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in'));
  }
  shell = null;
  mount(app, h('div', { class: 'auth' }, h('div', { class: 'card auth-card' }, brand(), form)));
  setTimeout(() => form.querySelector('input')?.focus(), 30);
}

// ---------- App shell ----------
function buildShell() {
  const navLinks = ROUTES.map((r) => h('a', { class: 'nav-item', href: `#/${r.id}`, 'data-route': r.id }, icon(r.icon), h('span', null, r.label), r.id === 'broadcasts' && h('span', { class: 'count hidden', 'data-live-count': '' })));
  const onair = h('div', { class: 'onair' }, h('span', { class: 'dot' }), h('span', { 'data-onair-text': '' }, 'Off air'));
  const sidebar = h('aside', { class: 'sidebar' }, brand(), navLinks, h('div', { class: 'spacer' }), onair,
    h('button', { class: 'nav-item', onclick: logout }, icon('logout'), h('span', null, 'Sign out')));
  const tabbar = h('nav', { class: 'tabbar' }, ROUTES.filter((r) => r.tab).map((r) => h('a', { href: `#/${r.id}`, 'data-route': r.id }, icon(r.icon), r.label, r.id === 'broadcasts' && h('span', { class: 'count hidden', 'data-live-count': '' }))));
  const mobileBar = h('header', { class: 'mobile-bar' }, brand(''), h('div', { class: 'row' },
    h('a', { class: 'btn sm ghost', href: '#/activity' }, icon('activity')), h('a', { class: 'btn sm ghost', href: '#/playlists' }, icon('list'))));
  const main = h('main', { class: 'main', id: 'main' });
  mount(app, h('div', { class: 'shell' }, sidebar, h('div', null, mobileBar, main)), tabbar);
  shell = { main, onair };
  // Global on-air indicator
  poll(app.firstChild, async () => {
    const live = await api('GET', '/api/live');
    const n = live.filter((l) => l.state === 'live').length;
    const waiting = live.length - n;
    onair.classList.toggle('is-live', n > 0);
    onair.querySelector('.dot').classList.toggle('pulse', n > 0);
    onair.querySelector('.dot').style.color = n ? 'var(--live)' : waiting ? 'var(--warn)' : 'var(--faint)';
    onair.querySelector('[data-onair-text]').textContent = n ? `${n} broadcast${n > 1 ? 's' : ''} on air` : waiting ? 'Waiting for source' : 'Off air';
    document.querySelectorAll('[data-live-count]').forEach((c) => { c.textContent = n; c.classList.toggle('hidden', !n); });
    document.title = n ? `● LIVE · Stream Studio` : 'Stream Studio';
  }, 5000);
}

async function logout() {
  await api('POST', '/api/auth/logout').catch(() => {});
  boot();
}

let currentRoute = null;
async function route() {
  if (!shell) return;
  const [, id = 'overview', ...rest] = (location.hash || '#/overview').slice(1).split('/');
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  currentRoute = r.id;
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === r.id));
  const container = h('div');
  mount(shell.main, container);
  window.scrollTo(0, 0);
  try { await r.view(container, rest); } catch (e) { if (e.status !== 401) { errorToast(e); console.error(e); } }
}

async function boot() {
  try {
    store.auth = await api('GET', '/api/auth/state');
  } catch (e) {
    mount(app, h('div', { class: 'auth' }, h('div', { class: 'card auth-card' }, brand(), h('p', null, 'The dashboard is unreachable. Retrying…'))));
    return setTimeout(boot, 3000);
  }
  if (!store.auth.authenticated) return authScreen(store.auth);
  store.meta = await api('GET', '/api/meta');
  buildShell();
  route();
}

export async function refreshMeta() { store.meta = await api('GET', '/api/meta'); }

window.addEventListener('hashchange', route);
window.addEventListener('studio:unauthorized', () => { if (shell) { toast('Your session ended. Please sign in again.', 'warn'); boot(); } });
boot();
