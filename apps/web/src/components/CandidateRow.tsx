import type { ReactNode } from 'react';
import {
  brokenDownText,
  closenessWord,
  metaLine,
  type Candidate,
  type CandidateFacts,
} from '../lib/breakdownPicks';
import { breakdownHref } from '../lib/routes';
import { formatScore, thumbnailUrl } from '../lib/format';
import { ChannelLogo } from './ChannelLogo';

const TONE = { close: 'text-primary', medium: 'text-secondary', far: 'text-outline' } as const;

/**
 * Where another part of the app may put a small badge on a channel's row
 * (a monetization badge is being built). Nothing is shown until it is set.
 */
export type CandidateBadge = (channelId: string) => ReactNode;
export const NO_BADGE: CandidateBadge = () => null;

/** Three of the channel's best videos, as small thumbnails with their score. */
export function TopStrip({ facts }: { readonly facts: CandidateFacts }) {
  if (facts.top.length === 0) return null;
  return (
    <ul aria-label={`Top videos of ${facts.title}`} className="grid min-w-0 grid-cols-3 gap-2">
      {facts.top.map((video) => {
        const src = thumbnailUrl(video.videoId);
        return (
          <li key={video.videoId} className="relative min-w-0 overflow-hidden rounded">
            {src && (
              <img
                src={src}
                alt={video.title}
                title={video.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="aspect-video w-full object-cover"
              />
            )}
            {video.score !== null && (
              <span className="absolute bottom-1 right-1 rounded bg-space-deep/90 px-1 text-metric-badge font-semibold text-metric-amber">
                {formatScore(video.score)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A channel's logo in a round frame. */
export function CandidateLogo({
  facts,
  size = 'md',
}: {
  readonly facts: CandidateFacts;
  readonly size?: 'md' | 'lg';
}) {
  return (
    <span
      className={`flex flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high font-bold text-secondary ring-2 ring-border-subtle ${
        size === 'lg' ? 'h-16 w-16 text-body-lg' : 'h-12 w-12 text-body-sm'
      }`}
    >
      <ChannelLogo title={facts.title} logoUrl={facts.logoUrl} />
    </span>
  );
}

/** The meta line: subscribers, breaking out, closeness and the last breakdown, each labelled. */
export function CandidateMeta({ candidate }: { readonly candidate: Candidate }) {
  const done = brokenDownText(candidate.brokenDownAt);
  return (
    <p className="flex min-w-0 flex-wrap gap-x-2 text-body-sm text-on-surface-variant">
      {metaLine(candidate).map((part) => (
        <span key={part}>{part}</span>
      ))}
      {candidate.closeness && (
        <span className={TONE[candidate.closeness]}>{closenessWord(candidate.closeness)}</span>
      )}
      {done !== '' && <span className="text-outline">{done}</span>}
    </p>
  );
}

interface Props {
  readonly candidate: Candidate;
  readonly badge: CandidateBadge;
  /** A line under the name saying why it is suggested; absent in the plain list. */
  readonly reason?: string;
}

/** One channel the owner could break down: logo, name, numbers, three top videos, and the way in. */
export function CandidateRow({ candidate, badge, reason }: Props) {
  return (
    <li className="flex min-w-0 flex-col gap-space-sm rounded-lg border border-border-subtle bg-surface-card p-space-md">
      <a
        href={breakdownHref(candidate.id)}
        className="flex min-w-0 items-center gap-space-sm rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
      >
        <CandidateLogo facts={candidate} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-title-md font-semibold text-on-surface">
              {candidate.label}
            </span>
            {badge(candidate.id)}
          </span>
          <CandidateMeta candidate={candidate} />
        </span>
        <span className="hidden flex-none text-body-sm font-semibold text-primary sm:inline">
          Open
        </span>
      </a>
      {reason && <p className="text-body-sm text-on-surface-variant">{reason}</p>}
      <TopStrip facts={candidate} />
    </li>
  );
}
