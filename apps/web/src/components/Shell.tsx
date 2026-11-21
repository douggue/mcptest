import {
  Compass,
  Eye,
  Flame,
  Globe,
  HardDrive,
  Image,
  Layers,
  Lightbulb,
  PenLine,
  Quote,
  Radar,
  Settings as SettingsIcon,
  Shapes,
  Sparkles,
  Sprout,
  Target,
  CalendarDays,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Settings } from './Settings';

/**
 * The sections of the one page, in the order they appear. Each entry jumps to
 * its section; a section that is not on the page yet (no map has been made)
 * simply has nowhere to jump to.
 */
const RAIL = [
  { label: 'Radar', icon: Compass, target: 'top' },
  { label: 'What changed', icon: Eye, target: 'what-changed-title' },
  { label: 'Breaking out', icon: Flame, target: 'breakouts-title' },
  { label: 'Same topic, other words', icon: Layers, target: 'same-topic-title' },
  { label: 'Thumbnails that worked', icon: Image, target: 'thumbnail-board-title' },
  { label: 'Ask AI', icon: Sparkles, target: 'ask-claude-title' },
  { label: 'Trending formats', icon: Shapes, target: 'formulas-title' },
  { label: 'Hook library', icon: Quote, target: 'hook-library-title' },
  { label: 'Idea lab', icon: Lightbulb, target: 'idea-lab-title' },
  { label: 'Script writer', icon: PenLine, target: 'script-writer-title' },
  { label: 'Your videos against the plan', icon: Target, target: 'own-videos-title' },
  { label: 'Upload calendar', icon: CalendarDays, target: 'upload-calendar-title' },
  { label: 'Transfer opportunities', icon: Globe, target: 'transfers-title' },
  { label: 'New niches', icon: Sprout, target: 'niches-title' },
] as const;

/** The frame around every screen: top bar, left rail and the content area. */
export function Shell({ children }: { readonly children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
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
            onClick={() => setSettingsOpen(true)}
            className="ml-auto flex min-h-11 items-center gap-2 rounded-full px-3 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-card hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
          >
            <SettingsIcon aria-hidden="true" className="h-[18px] w-[18px]" />
            Settings
          </button>
        </div>
      </header>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-64 flex-col justify-between border-r border-border-subtle bg-space-canvas py-space-md md:flex">
        <div className="flex flex-col gap-space-xs px-space-sm">
          <div className="px-3 py-2 text-label-caps uppercase text-outline">On this page</div>
          <nav aria-label="Sections" className="flex flex-col gap-1">
            {RAIL.map((item) => (
              <a
                key={item.target}
                href={`#${item.target}`}
                className="flex items-center gap-3 rounded px-3 py-2 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-card hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
              >
                <item.icon aria-hidden="true" className="h-[18px] w-[18px]" />
                {item.label}
              </a>
            ))}
          </nav>
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
