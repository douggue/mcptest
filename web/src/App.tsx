import { useEffect, useState } from 'react';

import { api } from './api';
import Agency from './pages/Agency';
import Clipper from './pages/Clipper';
import Generate from './pages/Generate';
import Home from './pages/Home';
import Library from './pages/Library';
import Settings from './pages/Settings';
import Studio from './pages/Studio';
import { Button, Icon, IconName, Toasts } from './ui';

type Page = { id: string; label: string; short: string; icon: IconName; group: 'main' | 'create' | 'manage' | 'foot'; el: () => JSX.Element };
const PAGES: Page[] = [
  { id: 'home', label: 'Home', short: 'Home', icon: 'home', group: 'main', el: () => <Home /> },
  { id: 'clipper', label: 'Clipper', short: 'Clipper', icon: 'scissors', group: 'create', el: () => <Clipper /> },
  { id: 'studio', label: 'Shorts studio', short: 'Studio', icon: 'film', group: 'create', el: () => <Studio /> },
  { id: 'generate', label: 'Generate', short: 'Generate', icon: 'sparkle', group: 'create', el: () => <Generate /> },
  { id: 'library', label: 'Library', short: 'Library', icon: 'folder', group: 'manage', el: () => <Library /> },
  { id: 'agency', label: 'Agency', short: 'Agency', icon: 'chart', group: 'manage', el: () => <Agency /> },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: 'gear', group: 'foot', el: () => <Settings /> },
];

/** Hash routing: #/studio/<projectId>/<clipId>. Pages read the rest with useRoute(). */
export function useRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export const go = (path: string) => {
  window.location.hash = '#/' + path.replace(/^\/+/, '');
};

export type Health = { ffmpeg: boolean; ai: boolean; ai_provider?: string; ai_problem?: string; data?: string; auth?: boolean; signed_in?: boolean };

function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/login', { password });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><Mark /><span className="brand-name">Cutroom</span></div>
        <div>
          <h1>Sign in</h1>
          <p className="muted" style={{ marginTop: 6 }}>Enter the password set for this server.</p>
        </div>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="notice bad" role="alert">{error}</div>}
        <Button variant="primary" busy={busy} disabled={!password} type="submit">Sign in</Button>
      </form>
    </div>
  );
}

function Mark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3 2.2v11.6a.6.6 0 0 0 .93.5L7 12.3V3.7L3.93 1.7A.6.6 0 0 0 3 2.2z" />
        <path d="M9 5v6l4.2-2.5a.6.6 0 0 0 0-1z" />
      </svg>
    </span>
  );
}

export function App() {
  const route = useRoute();
  const page = PAGES.find((p) => p.id === route[0]) ?? PAGES[0];
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [locked, setLocked] = useState(false);
  const compact = page.id === 'studio' && route.length >= 3;   // the editor needs the width

  useEffect(() => {
    api.get<Health>('/api/health').then((h) => { setHealth(h); setOffline(false); setLocked(!!h.auth && !h.signed_in); }).catch(() => setOffline(true));
  }, [route[0]]);
  useEffect(() => {
    const on = () => setLocked(true);
    window.addEventListener('cutroom:locked', on);
    return () => window.removeEventListener('cutroom:locked', on);
  }, []);

  if (locked) return <Login />;
  if (health === null && !offline) return <div className="app" />;   // wait for the first check, so a locked server never flashes the app

  const item = (p: Page) => (
    <button key={p.id} className={'nav-item' + (p.id === page.id ? ' active' : '')} onClick={() => go(p.id)} title={p.label}
      aria-current={p.id === page.id ? 'page' : undefined}>
      <Icon name={p.icon} size={17} />
      <span>{p.label}</span>
    </button>
  );
  const status = offline ? { cls: 'bad', text: 'Server offline' }
    : health && !health.ffmpeg ? { cls: 'bad', text: 'ffmpeg missing' }
    : health?.ai ? { cls: 'good', text: `AI ready · ${health.ai_provider || 'on'}` }
    : { cls: '', text: 'AI not set up', title: health?.ai_problem };

  return (
    <div className={'app' + (compact ? ' compact' : '')}>
      <nav className="nav" aria-label="Main">
        <a className="brand" href="#/home"><Mark /><span className="brand-name">Cutroom</span></a>
        {PAGES.filter((p) => p.group === 'main').map(item)}
        <span className="nav-label">Create</span>
        {PAGES.filter((p) => p.group === 'create').map(item)}
        <span className="nav-label">Manage</span>
        {PAGES.filter((p) => p.group === 'manage').map(item)}
        <div className="nav-foot">
          <div className="nav-status" title={('title' in status && status.title) || status.text} onClick={() => !health?.ai && go('settings')} style={!health?.ai ? { cursor: 'pointer' } : undefined}><i className={'dot ' + status.cls} /><span>{status.text}</span></div>
          {PAGES.filter((p) => p.group === 'foot').map(item)}
        </div>
      </nav>
      <header className="topbar">
        <a className="brand" href="#/home"><Mark /><span className="brand-name">Cutroom</span></a>
        <button className="btn ghost icon-only" onClick={() => go('settings')} aria-label="Settings"><Icon name="gear" size={18} /></button>
      </header>
      <main className="main">{page.el()}</main>
      <nav className="tabbar" aria-label="Main">
        {PAGES.filter((p) => p.group !== 'foot' && p.id !== 'generate').map((p) => (
          <button key={p.id} className={p.id === page.id ? 'active' : ''} onClick={() => go(p.id)} aria-current={p.id === page.id ? 'page' : undefined}>
            <Icon name={p.icon} size={20} />
            {p.short}
          </button>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
