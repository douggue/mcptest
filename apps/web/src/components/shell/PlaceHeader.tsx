import { leadOf, screenHref, tabHref, type Where } from '../../lib/places';
import { Tabs, ViewPills } from '../ui/Tabs';

interface Props {
  /** Where the screen on show sits. */
  readonly where: Where;
  /** The owner's channel, named in the place's one line; null before any. */
  readonly channelTitle: string | null;
}

/**
 * The top of every screen of a place: the place's name with one line under
 * it, its tabs, and, when the tab holds several screens, those as pills.
 */
export function PlaceHeader({ where, channelTitle }: Props) {
  const { place, tab, screen } = where;
  return (
    <div className="mx-auto flex w-full max-w-[1260px] min-w-0 flex-col gap-4 px-4 pt-5 sm:px-8 sm:pt-7">
      <header className="min-w-0">
        <h1 className="text-[28px] font-[650] leading-[34px] tracking-tight text-ink sm:text-headline-lg">
          {place.label}
        </h1>
        <p className="mt-1 hidden text-body-md text-muted sm:block">
          {leadOf(place, channelTitle)}
        </p>
      </header>
      {place.tabs.length > 1 && (
        <Tabs
          label={`${place.label} tabs`}
          active={tab.label}
          items={place.tabs.map((each) => ({
            key: each.label,
            label: each.label,
            href: tabHref(each),
          }))}
        />
      )}
      {tab.screens.length > 1 && (
        <ViewPills
          label={`${tab.label} views`}
          active={screen.view}
          items={tab.screens.map((each) => ({
            key: each.view,
            label: each.label,
            href: screenHref(each.view),
          }))}
        />
      )}
    </div>
  );
}
