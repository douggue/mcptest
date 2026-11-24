import { Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LastScreens, PlaceId } from '../lib/places';
import { viewHref, type ViewId } from '../lib/routes';
import { BottomBar, Rail } from './shell/PlaceNav';
import { IconButton } from './ui/Button';
import { WorkingIndicator } from './WorkingIndicator';

interface Props {
  /** The screen on show. */
  readonly active: ViewId;
  /** The place it sits in, marked in the rail; null for Ask and Settings. */
  readonly place: PlaceId | null;
  /** The screen last open in each place, which the menu leads back to. */
  readonly last: LastScreens;
  /** Which channel the app is about and the way to switch, beside the logo. */
  readonly switcher?: ReactNode;
  /** The search box, in the middle of the bar. */
  readonly search: ReactNode;
  /** The Ask panel is open. */
  readonly asking: boolean;
  readonly onAsk: () => void;
  readonly children: ReactNode;
}

function Logo() {
  return (
    <a
      href={viewHref('home')}
      aria-label="Jgtube, Today"
      className="flex flex-none items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal md:w-[196px]"
    >
      <span className="relative h-[30px] w-[30px] flex-none rounded-full border-[1.5px] border-signal shadow-[inset_0_0_18px_rgba(0,210,255,0.35)]">
        <span className="absolute inset-2 rounded-full bg-signal" />
      </span>
      <span className="hidden text-[19px] font-bold tracking-tight text-ink md:inline">Jgtube</span>
    </a>
  );
}

function AskButton({ asking, onAsk }: Pick<Props, 'asking' | 'onAsk'>) {
  return (
    <button
      type="button"
      onClick={onAsk}
      aria-label="Ask the AI about this screen"
      aria-expanded={asking}
      className="flex h-10 w-10 flex-none items-center justify-center gap-2 rounded border border-signal/45 bg-signal/[0.07] text-[15px] font-semibold text-signal transition-colors hover:bg-signal/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal md:w-auto md:px-3.5"
    >
      <Sparkles aria-hidden="true" className="h-[18px] w-[18px] flex-none" />
      <span className="hidden md:inline">Ask</span>
    </button>
  );
}

/**
 * The frame around every screen: the top bar with the open channel, search,
 * the work under way, Ask and Settings; the five places in a rail on a wide
 * screen and in a bar at the foot of a phone; and the screen itself.
 */
export function Shell(props: Props) {
  const { active, place, last, switcher, search, asking, onAsk, children } = props;
  return (
    <>
      <header className="fixed left-0 top-0 z-50 flex h-14 w-full min-w-0 items-center gap-2 border-b border-line bg-ground/85 px-4 backdrop-blur-[14px] md:h-16 md:gap-4 md:px-6">
        <Logo />
        <div className="min-w-0">{switcher}</div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 md:justify-start md:gap-2.5">
          {search}
          <WorkingIndicator active={active} />
          <AskButton asking={asking} onAsk={onAsk} />
          <IconButton
            icon={SettingsIcon}
            label="Settings"
            href={viewHref('settings')}
            className={active === 'settings' ? '!text-signal' : ''}
          />
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-16 z-40 hidden w-[220px] flex-col border-r border-line px-3 py-4 md:flex">
        <Rail active={place} last={last} />
      </aside>
      <BottomBar active={place} last={last} />

      <div className="md:pl-[220px]">
        <main id="top" className="relative min-h-screen min-w-0 pb-24 pt-14 md:pb-10 md:pt-16">
          {children}
        </main>
      </div>
    </>
  );
}
