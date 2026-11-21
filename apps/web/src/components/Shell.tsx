import { HardDrive, Menu, Radar, Settings as SettingsIcon, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { RailLinks } from './RailLinks';
import { Settings } from './Settings';

/** The frame around every screen: top bar, left rail and the content area. */
export function Shell({ children }: { readonly children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <header className="fixed left-0 top-0 z-50 w-full border-b border-border-subtle bg-space-canvas/90 shadow-[0_4px_24px_rgba(5,7,14,0.6)] backdrop-blur-xl">
        <div className="flex h-16 w-full items-center gap-space-xl px-gutter-desktop">
          <div className="flex items-center gap-space-sm">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface-card">
              <Radar aria-hidden="true" className="h-5 w-5 text-primary" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
            </div>
            <span className="text-headline-md font-bold tracking-tight text-on-surface">
              Jgtube
            </span>
          </div>
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="section-menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className="ml-auto flex min-h-11 items-center gap-2 rounded-full px-3 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-card hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container md:hidden"
          >
            {menuOpen ? (
              <X aria-hidden="true" className="h-[18px] w-[18px]" />
            ) : (
              <Menu aria-hidden="true" className="h-[18px] w-[18px]" />
            )}
            Sections
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-full px-3 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-card hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container md:ml-auto"
          >
            <SettingsIcon aria-hidden="true" className="h-[18px] w-[18px]" />
            Settings
          </button>
        </div>
      </header>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {menuOpen && (
        <div
          id="section-menu"
          className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-space-canvas p-space-sm md:hidden"
        >
          <RailLinks onPick={() => setMenuOpen(false)} />
        </div>
      )}

      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-64 flex-col justify-between border-r border-border-subtle bg-space-canvas py-space-md md:flex">
        <div className="flex min-h-0 flex-col gap-space-xs overflow-y-auto px-space-sm">
          <RailLinks />
        </div>
        <div className="border-t border-border-subtle px-space-sm pt-space-sm">
          <div className="flex items-center justify-between rounded border border-border-subtle bg-surface-card p-3">
            <div className="flex flex-col">
              <span className="text-label-caps uppercase text-outline">Data</span>
              <span className="text-body-sm text-secondary">Stored on this computer</span>
            </div>
            <HardDrive aria-hidden="true" className="h-[18px] w-[18px] text-outline" />
          </div>
        </div>
      </aside>

      <div className="md:pl-64">
        <main id="top" className="relative min-h-screen bg-space-deep pt-16">
          {children}
        </main>
      </div>
    </>
  );
}
