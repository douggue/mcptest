import { X } from 'lucide-react';
import { ChannelLogo } from '../ChannelLogo';

/** The colours a level label may take. */
export type LevelTone = 'close' | 'medium' | 'far' | 'neutral';

const TONE: Readonly<Record<LevelTone, string>> = {
  close: 'text-primary',
  medium: 'text-secondary',
  far: 'text-outline',
  neutral: 'text-on-surface-variant',
};

interface Props {
  readonly title: string;
  readonly logoUrl?: string | null;
  /** Opens the channel's own view. */
  readonly href: string;
  /** A short level, such as "Close", in its colour. */
  readonly level?: { readonly text: string; readonly tone: LevelTone };
  /** A count after the level, such as subscribers. */
  readonly count?: string;
  /** Takes the channel off the list; absent where it cannot be. */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
}

/** One channel in a clean list: its logo, name, a coloured level and a count, and a remove cross. */
export function ChannelRow(props: Props) {
  const { title, logoUrl, href, level, count, onRemove, removeLabel } = props;
  return (
    <li className="flex min-w-0 items-center gap-space-sm py-2">
      <a
        href={href}
        className="flex min-w-0 flex-1 items-center gap-space-sm rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
      >
        <span className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-body-sm font-bold text-secondary ring-2 ring-border-subtle">
          <ChannelLogo title={title} logoUrl={logoUrl ?? null} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-md text-on-surface">{title}</span>
          <span className="text-body-sm">
            {level && <span className={TONE[level.tone]}>{level.text}</span>}
            {level && count && <span className="text-outline"> · </span>}
            {count && <span className="text-on-surface-variant">{count}</span>}
          </span>
        </span>
      </a>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? `Remove ${title}`}
          onClick={onRemove}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-card hover:text-on-surface"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      )}
    </li>
  );
}
