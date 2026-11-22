import { House, Lightbulb, Flame, Microscope, Sparkles, Tv, type LucideIcon } from 'lucide-react';
import {
  DESTINATIONS,
  destinationHref,
  type Destination,
  type DestinationId,
} from '../lib/sections';

/** The icon of each destination in the rail. */
const ICONS: Readonly<Record<DestinationId, LucideIcon>> = {
  home: House,
  channel: Tv,
  research: Flame,
  create: Lightbulb,
  breakdown: Microscope,
  ask: Sparkles,
};

const LINK =
  'flex min-h-12 items-center gap-3 rounded px-3 text-body-md transition-colors hover:bg-surface-card hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

interface LinkProps {
  readonly destination: Destination;
  readonly href: string;
  readonly active: boolean;
  readonly onPick?: () => void;
}

function RailLink({ destination, href, active, onPick }: LinkProps) {
  const Icon = ICONS[destination.id];
  return (
    <a
      href={href}
      onClick={onPick}
      aria-current={active ? 'page' : undefined}
      className={`${LINK} ${
        active ? 'bg-surface-card font-semibold text-primary' : 'text-on-surface-variant'
      }`}
    >
      <Icon aria-hidden="true" className="h-5 w-5 flex-none" />
      {destination.label}
    </a>
  );
}

/**
 * The five destinations, each a link to its first tab, with the one on
 * screen marked. `centerId` is the map's own channel, which the Channel
 * entry opens; `onPick` closes a menu the links sit in.
 */
export function RailLinks({
  active,
  centerId,
  onPick,
}: {
  readonly active: DestinationId | null;
  readonly centerId: string | null;
  readonly onPick?: () => void;
}) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {DESTINATIONS.map((destination) => (
        <RailLink
          key={destination.id}
          destination={destination}
          href={destinationHref(destination, centerId)}
          active={destination.id === active}
          onPick={onPick}
        />
      ))}
    </nav>
  );
}

/**
 * The destinations at the foot of a phone: one tab each, icon over a short
 * name, the one on screen marked. Six fit at 390px; a new destination adds
 * itself from the same list as the rail.
 */
export function BottomTabs({
  active,
  centerId,
}: {
  readonly active: DestinationId | null;
  readonly centerId: string | null;
}) {
  return (
    <nav
      aria-label="Main tabs"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-space-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid auto-cols-fr grid-flow-col">
        {DESTINATIONS.map((destination) => {
          const Icon = ICONS[destination.id];
          const current = destination.id === active;
          return (
            <li key={destination.id} className="min-w-0">
              <a
                href={destinationHref(destination, centerId)}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
                  current ? 'font-semibold text-primary' : 'text-on-surface-variant'
                }`}
              >
                <Icon aria-hidden="true" className="h-5 w-5 flex-none" />
                <span className="max-w-full truncate tracking-tight">{destination.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
