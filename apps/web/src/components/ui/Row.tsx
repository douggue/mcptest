import type { ReactNode } from 'react';
import { ChannelLogo } from '../ChannelLogo';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'xl';

const AVATAR: Readonly<Record<AvatarSize, string>> = {
  xs: 'h-5 w-5 text-[9px] border',
  sm: 'h-7 w-7 text-[11px] border-[1.5px]',
  md: 'h-10 w-10 text-body-sm border-[1.5px]',
  xl: 'h-[84px] w-[84px] text-[30px] border-2 !border-signal/50 shadow-[0_0_0_6px_rgba(0,210,255,0.08)]',
};

interface AvatarProps {
  readonly title: string;
  readonly logoUrl: string | null | undefined;
  readonly size?: AvatarSize;
}

/** A channel's logo in a circle, or its initials on a gradient when none is stored. */
export function Avatar({ title, logoUrl, size = 'md' }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center overflow-hidden rounded-full border-white/15 bg-gradient-to-br from-[#3B5BDB] to-[#7048E8] font-bold text-white ${AVATAR[size]}`}
    >
      <ChannelLogo
        title={title}
        logoUrl={logoUrl}
        letters={size === 'xs' || size === 'sm' ? 1 : 2}
      />
    </span>
  );
}

interface RowProps {
  /** A logo or an icon before the words. */
  readonly media?: ReactNode;
  readonly title: ReactNode;
  /** One grey line under the title. */
  readonly meta?: ReactNode;
  /** One thing at the right: a badge, a level, a button. */
  readonly right?: ReactNode;
  /** Lets the grey line run onto more lines instead of being cut: for a sentence, not a fact. */
  readonly wrap?: boolean;
  /** With an address, the title and its line open it. */
  readonly href?: string;
  readonly as?: 'div' | 'li';
}

/**
 * A row of a list: logo, name, one grey line, one thing on the right. Rows
 * are separated by a line and sit straight inside a card.
 */
export function Row({ media, title, meta, right, href, wrap, as: Tag = 'div' }: RowProps) {
  const words = (
    <>
      <div className={`text-body-md font-semibold text-ink ${wrap ? 'break-words' : 'truncate'}`}>
        {title}
      </div>
      {meta !== undefined && (
        <div className={`text-body-sm text-muted ${wrap ? 'break-words' : 'truncate'}`}>{meta}</div>
      )}
    </>
  );
  return (
    <Tag className="flex min-h-16 min-w-0 items-center gap-3.5 border-t border-line py-3 first:border-t-0">
      {media}
      {href !== undefined ? (
        <a
          href={href}
          className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal [&:hover>div:first-child]:text-link"
        >
          {words}
        </a>
      ) : (
        <div className="min-w-0 flex-1">{words}</div>
      )}
      {right !== undefined && (
        <div className="ml-auto flex flex-none items-center gap-2.5">{right}</div>
      )}
    </Tag>
  );
}
