import { useEffect, useState } from 'react';

import { api } from './api';
import Agency from './pages/Agency';
import Clipper from './pages/Clipper';
import Library from './pages/Library';
import Settings from './pages/Settings';
import Studio from './pages/Studio';
import { Icon, IconName, Toasts } from './ui';

const PAGES: { id: string; label: string; icon: IconName; el: () => JSX.Element }[] = [
  { id: 'clipper', label: 'Clipper', icon: 'scissors', el: () => <Clipper /> },
  { id: 'studio', label: 'Shorts studio', icon: 'film', el: () => <Studio /> },
  { id: 'library', label: 'Library', icon: 'folder', el: () => <Library /> },
  { id: 'agency', label: 'Agency', icon: 'chart', el: () => <Agency /> },
  { id: 'settings', label: 'Settings', icon: 'gear', el: () => <Settings /> },
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

export function App() {
  const route = useRoute();
  const page = PAGES.find((p) => p.id === route[0]) ?? PAGES[0];
  const [health, setHealth] = useState<{ ffmpeg: boolean; ai: boolean } | null>(null);

  useEffect(() => {
    api.get('/api/health').then(setHealth).catch(() => setHealth(null));
  }, [route[0]]);

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">
          <span className="brand-mark">K</span>
          <span className="brand-name">Cutroom</span>
        </div>
        {PAGES.map((p) => (
          <button key={p.id} className={'nav-item' + (p.id === page.id ? ' active' : '')} onClick={() => go(p.id)}>
            <Icon name={p.icon} />
            <span>{p.label}</span>
          </button>
        ))}
        <div className="nav-foot">
          {health === null && <span className="pill bad">API offline</span>}
          {health && !health.ffmpeg && <span className="pill bad">ffmpeg missing</span>}
          {health && <span className={'pill ' + (health.ai ? 'good' : 'muted')}>{health.ai ? 'AI ready' : 'AI key not set'}</span>}
        </div>
      </nav>
      <main className="main">{page.el()}</main>
      <Toasts />
    </div>
  );
}
