import { Compass, Layers, PenLine, Sun, Tv, type LucideIcon } from 'lucide-react';
import { PLACES, placeHref, type PlaceId } from '../../lib/places';

/** The icon of each place, in the rail and in the phone's bottom bar. */
const ICONS: Readonly<Record<PlaceId, LucideIcon>> = {
  today: Sun,
  discover: Compass,
  create: PenLine,
  style: Layers,
  'my-channel': Tv,
};

interface Props {
  /** The place on screen, marked; null on Ask and Settings. */
  readonly active: PlaceId | null;
}

/** The five places down the left of a wide screen, the one on screen marked in cyan. */
export function Rail({ active }: Props) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {PLACES.map((place) => {
        const Icon = ICONS[place.id];
        const on = place.id === active;
        return (
          <a
            key={place.id}
            href={placeHref(place)}
            aria-current={on ? 'page' : undefined}
            className={`flex h-[46px] items-center gap-3 rounded px-3.5 text-body-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
              on
                ? 'bg-signal/[0.09] font-semibold text-white shadow-[inset_2px_0_0_#00D2FF]'
                : 'font-medium text-muted hover:bg-white/[0.04] hover:text-ink'
            }`}
          >
            <Icon aria-hidden="true" className={`h-5 w-5 flex-none ${on ? 'text-signal' : ''}`} />
            {place.label}
          </a>
        );
      })}
    </nav>
  );
}

/** The same five places at the foot of a phone: icon over a short name. */
export function BottomBar({ active }: Props) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[rgba(7,10,18,0.94)] px-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-5">
        {PLACES.map((place) => {
          const Icon = ICONS[place.id];
          const on = place.id === active;
          return (
            <li key={place.id} className="min-w-0">
              <a
                href={placeHref(place)}
                aria-current={on ? 'page' : undefined}
                className={`flex h-14 min-w-0 flex-col items-center justify-center gap-[3px] rounded text-[13px] font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal ${
                  on ? 'text-signal' : 'text-dim'
                }`}
              >
                <Icon aria-hidden="true" className="h-[22px] w-[22px] flex-none" />
                <span className="max-w-full truncate">{place.short}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
