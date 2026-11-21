import { HardDrive, Menu, Radar, Settings as SettingsIcon, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AiBadge as Badge } from '../lib/aiBadge';
import { viewHref, type ViewId } from '../lib/routes';
import { AiBadge } from './AiBadge';
import { RailLinks } from './RailLinks';

const TOP_BUTTON =
  'flex min-h-11 flex-none items-center gap-2 rounded-full px-3 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-card hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

interface Props {
  /** The view on screen, marked in the rail. */
  readonly active: ViewId;
  /** Which AI answers, shown in the top bar on every view. */
  readonly ai: Badge;
  readonly children: ReactNode;
}

/**
 * The frame around every view: the top bar with the AI that answers and
 * Settings, the left rail of views (a menu on a phone) and the view itself.
 */
export function Shell({ active, ai, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Opening a view from anywhere closes the phone menu.
  useEffect(() => setMenuOpen(false), [active]);
  return (
    <>
      <header className="fixed left-0 top-0 z-50 w-full border-b border-border-subtle bg-space-canvas/90 shadow-[0_4px_24px_rgba(5,7,14,0.6)] backdrop-blur-xl">
        <div className="flex h-16 w-full min-w-0 items-center gap-2 px-gutter-desktop sm:gap-space-md">
          <a
            href={viewHref('home')}
            aria-label="Jgtube overview"
            className="flex flex-none items-center gap-space-sm rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
          >
            <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface-card">
              <Radar aria-hidden="true" className="h-5 w-5 text-primary" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
            </span>
            <span className="hidden text-headline-md font-bold tracking-tight text-on-surface sm:inline">
              Jgtube
            </span>
          </a>
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <AiBadge badge={ai} />
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="view-menu"
              onClick={() => setMenuOpen(!menuOpen)}
              className={`${TOP_BUTTON} md:hidden`}
            >
              {menuOpen ? (
                <X aria-hidden="true" className="h-[18px] w-[18px]" />
              ) : (
                <Menu aria-hidden="true" className="h-[18px] w-[18px]" />
              )}
              Menu
            </button>
            <a
              href={viewHref('settings')}
              aria-current={active === 'settings' ? 'page' : undefined}
              aria-label="Settings"
              className={`${TOP_BUTTON} aria-[current=page]:text-primary`}
            >
              <SettingsIcon aria-hidden="true" className="h-[18px] w-[18px]" />
              <span className="hidden lg:inline">Settings</span>
            </a>
          </div>
        </div>
      </header>
      {menuOpen && (
        <div
          id="view-menu"
          className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-space-canvas p-space-sm md:hidden"
        >
          <RailLinks active={active} onPick={() => setMenuOpen(false)} />
        </div>
      )}

      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-64 flex-col justify-between border-r border-border-subtle bg-space-canvas py-space-md md:flex">
        <div className="flex min-h-0 flex-col gap-space-xs overflow-y-auto px-space-sm">
          <RailLinks active={active} />
        </div>
        <div className="border-t border-border-subtle px-space-sm pt-space-sm">
          <div className="flex items-center justify-between rounded border border-border-subtle bg-surface-card p-3">
            <div className="flex flex-col">
              <span className="text-label text-outline">Data</span>
              <span className="text-body-sm text-secondary">Stored on this computer</span>
            </div>
            <HardDrive aria-hidden="true" className="h-[18px] w-[18px] text-outline" />
          </div>
        </div>
      </aside>

      <div className="md:pl-64">
        <main id="top" className="relative min-h-screen min-w-0 bg-space-deep pt-16">
          {children}
        </main>
      </div>
    </>
  );
}
