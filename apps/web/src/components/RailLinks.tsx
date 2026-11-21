import {
  CalendarDays,
  Ruler,
  MessageSquareText,
  Circle,
  Compass,
  Eye,
  Flame,
  Globe,
  Image,
  LayoutDashboard,
  Layers,
  Lightbulb,
  PenLine,
  Quote,
  Shapes,
  Sparkles,
  Sprout,
  ShieldAlert,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { viewHref, type ViewId } from '../lib/routes';
import { OVERVIEW_ITEM, RAIL_GROUPS, type RailItem } from '../lib/sections';

/** The icon of each view in the rail. A new view adds one line here. */
const ICONS: Readonly<Partial<Record<ViewId, LucideIcon>>> = {
  home: LayoutDashboard,
  radar: Compass,
  'what-changed': Eye,
  breakouts: Flame,
  'same-topic': Layers,
  thumbnails: Image,
  transfers: Globe,
  niches: Sprout,
  formats: Shapes,
  hooks: Quote,
  ideas: Lightbulb,
  script: PenLine,
  ask: Sparkles,
  'own-videos': Target,
  calendar: CalendarDays,
  pacing: Ruler,
  comments: MessageSquareText,
  risk: ShieldAlert,
};

const LINK =
  'flex items-center gap-3 rounded px-3 py-1.5 text-body-sm transition-colors hover:bg-surface-card hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

interface LinkProps {
  readonly item: RailItem;
  readonly active: boolean;
  readonly onPick?: () => void;
}

function RailLink({ item, active, onPick }: LinkProps) {
  const Icon = ICONS[item.view] ?? Circle;
  return (
    <a
      href={viewHref(item.view)}
      onClick={onPick}
      aria-current={active ? 'page' : undefined}
      className={`${LINK} ${
        active
          ? 'bg-surface-card font-semibold text-primary ring-1 ring-inset ring-border-highlight'
          : 'text-on-surface-variant'
      }`}
    >
      <Icon aria-hidden="true" className="h-[18px] w-[18px] flex-none" />
      {item.label}
    </a>
  );
}

/**
 * The overview, then the views under Research, Create and Study, each a link
 * that opens its own view. The view on screen is marked. `onPick` closes a
 * menu the links sit in.
 */
export function RailLinks({
  active,
  onPick,
}: {
  readonly active: ViewId;
  readonly onPick?: () => void;
}) {
  return (
    <nav aria-label="Views" className="flex flex-col gap-space-sm">
      <RailLink item={OVERVIEW_ITEM} active={active === 'home'} onPick={onPick} />
      {RAIL_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 pt-2 text-label text-outline">{group.label}</div>
          {group.items.map((item) => (
            <RailLink key={item.view} item={item} active={item.view === active} onPick={onPick} />
          ))}
        </div>
      ))}
    </nav>
  );
}
