import {
  CalendarDays,
  Ruler,
  Circle,
  Compass,
  Eye,
  Flame,
  Globe,
  Image,
  Layers,
  Lightbulb,
  PenLine,
  Quote,
  Shapes,
  Sparkles,
  Sprout,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { RAIL_GROUPS } from '../lib/sections';

/** The icon of each rail item, by the element it jumps to. A new section adds one line here. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  top: Compass,
  'what-changed-title': Eye,
  'breakouts-title': Flame,
  'same-topic-title': Layers,
  'thumbnail-board-title': Image,
  'transfers-title': Globe,
  'niches-title': Sprout,
  'formulas-title': Shapes,
  'hook-library-title': Quote,
  'idea-lab-title': Lightbulb,
  'script-writer-title': PenLine,
  'ask-claude-title': Sparkles,
  'own-videos-title': Target,
  'upload-calendar-title': CalendarDays,
  'length-pacing-title': Ruler,
};

/**
 * The page's sections under Research, Create and Study, each a link that
 * jumps to its section. A section not on the page yet simply has nowhere to
 * jump to. `onPick` closes a menu the links sit in.
 */
export function RailLinks({ onPick }: { readonly onPick?: () => void }) {
  return (
    <nav aria-label="Sections" className="flex flex-col gap-space-sm">
      {RAIL_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 pt-2 text-label-caps uppercase text-outline">{group.label}</div>
          {group.items.map((item) => {
            const Icon = ICONS[item.target] ?? Circle;
            return (
              <a
                key={item.target}
                href={`#${item.target}`}
                onClick={onPick}
                className="flex items-center gap-3 rounded px-3 py-1.5 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-card hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
              >
                <Icon aria-hidden="true" className="h-[18px] w-[18px] flex-none" />
                {item.label}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
