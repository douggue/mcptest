import { Activity, Compass, HardDrive, MessagesSquare, Radar, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

const TOP_NAV = [
  { label: 'Topics', built: false },
  { label: 'Map', built: true },
  { label: 'Map chat', built: false },
  { label: 'Results', built: false },
] as const;

const RAIL = [
  { label: 'Radar field', icon: Compass, built: true },
  { label: 'Topic streams', icon: TrendingUp, built: false },
  { label: 'Map chat', icon: MessagesSquare, built: false },
  { label: 'Breakout signals', icon: Activity, built: false },
] as const;

/** The frame around every screen: top bar, left rail and the content area. */
export function Shell({ children }: { readonly children: ReactNode }) {
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
          <nav aria-label="Main" className="hidden h-16 items-center gap-space-lg lg:flex">
            {TOP_NAV.map((item) =>
              item.built ? (
                <a
                  key={item.label}
                  href="/"
                  aria-current="page"
                  className="flex h-full items-center border-b-2 border-primary-container font-semibold text-primary"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  key={item.label}
                  aria-disabled="true"
                  title="Not built yet"
                  className="flex h-full cursor-not-allowed items-center text-outline"
                >
                  {item.label}
                </span>
              ),
            )}
          </nav>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-64 flex-col justify-between border-r border-border-subtle bg-space-canvas py-space-md md:flex">
        <div className="flex flex-col gap-space-xs px-space-sm">
          <div className="px-3 py-2 text-label-caps uppercase text-outline">Intelligence radar</div>
          <nav aria-label="Sections" className="flex flex-col gap-1">
            {RAIL.map((item) =>
              item.built ? (
                <a
                  key={item.label}
                  href="/"
                  aria-current="page"
                  className="flex items-center gap-3 rounded border border-border-highlight bg-surface-card px-3 py-2 text-body-sm text-primary"
                >
                  <item.icon aria-hidden="true" className="h-[18px] w-[18px]" />
                  {item.label}
                </a>
              ) : (
                <span
                  key={item.label}
                  aria-disabled="true"
                  className="flex cursor-not-allowed items-center gap-3 rounded px-3 py-2 text-body-sm text-outline"
                >
                  <item.icon aria-hidden="true" className="h-[18px] w-[18px]" />
                  {item.label}
                  <span className="ml-auto text-label-caps uppercase text-outline-variant">
                    Soon
                  </span>
                </span>
              ),
            )}
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
        <main className="relative min-h-screen bg-space-deep pt-16">{children}</main>
      </div>
    </>
  );
}
