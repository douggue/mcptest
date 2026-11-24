import type { ReactNode } from 'react';
import { thumbnailUrl } from '../../lib/format';
import { Avatar } from './Row';

const CHIP =
  'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border border-line-2 bg-white/[0.07] py-0.5 pl-1 pr-2 align-[1px] text-body-sm font-semibold leading-[18px] text-ink';

interface ShellProps {
  readonly picture: ReactNode;
  readonly children: ReactNode;
  /** With an address the chip opens the channel's or the video's page. */
  readonly href?: string;
}

function Chip({ picture, children, href }: ShellProps) {
  const inside = (
    <>
      {picture}
      <span className="truncate">{children}</span>
    </>
  );
  return href !== undefined ? (
    <a href={href} className={`${CHIP} hover:border-signal/50`}>
      {inside}
    </a>
  ) : (
    <span className={CHIP}>{inside}</span>
  );
}

interface ChannelProps {
  readonly title: string;
  readonly logoUrl?: string | null;
  readonly href?: string;
}

/** A channel named inside a sentence: its logo and its name, small. */
export function ChannelChip({ title, logoUrl, href }: ChannelProps) {
  return (
    <Chip href={href} picture={<Avatar title={title} logoUrl={logoUrl ?? null} size="xs" />}>
      {title}
    </Chip>
  );
}

interface VideoProps {
  readonly videoId: string;
  /** What stands for the video in the sentence: its score in amber, or a few words. */
  readonly children: ReactNode;
  /** The words are a breakout score. */
  readonly score?: boolean;
  readonly href?: string;
}

/** A video named inside a sentence: its thumbnail, tiny, and its score or a few words. */
export function VideoChip({ videoId, children, score, href }: VideoProps) {
  const picture = thumbnailUrl(videoId);
  return (
    <Chip
      href={href}
      picture={
        <span className="h-[17px] w-[30px] flex-none overflow-hidden rounded border border-white/20 bg-gradient-to-br from-[#1A1A1A] to-[#3B5BDB]">
          {picture && (
            <img
              src={picture}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          )}
        </span>
      }
    >
      <span className={score ? 'font-bold text-score' : ''}>{children}</span>
    </Chip>
  );
}
