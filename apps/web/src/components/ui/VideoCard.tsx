import type { ReactNode } from 'react';
import { formatDuration, thumbnailUrl } from '../../lib/format';
import { ScoreBadge } from './Badge';
import { Avatar } from './Row';

interface ThumbProps {
  readonly videoId: string;
  /** The breakout score as it reads, such as "269×"; left out when there is none. */
  readonly score?: string | null;
  readonly durationSeconds?: number | null;
}

/** A video's thumbnail with its score at the top left and its length at the bottom right. */
export function VideoThumb({ videoId, score, durationSeconds }: ThumbProps) {
  const picture = thumbnailUrl(videoId);
  const length = formatDuration(durationSeconds ?? null);
  return (
    <div className="relative aspect-video overflow-hidden rounded border border-white/[0.08] bg-gradient-to-br from-card-2 to-[#22345c]">
      {picture && (
        <img
          src={picture}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      )}
      {score && (
        <span className="absolute left-2 top-2">
          <ScoreBadge onThumb>{score}</ScoreBadge>
        </span>
      )}
      {length !== '' && (
        <span className="absolute bottom-2 right-2 rounded-md bg-ground/85 px-[7px] py-0.5 text-xs font-semibold leading-4 text-ink">
          {length}
        </span>
      )}
    </div>
  );
}

interface CardProps extends ThumbProps {
  readonly title: string;
  /** Where the thumbnail and the title lead; plain when left out. */
  readonly href?: string;
  readonly channel?: {
    readonly title: string;
    readonly logoUrl?: string | null;
    readonly href?: string;
  };
  /** After the channel's name: views and age, in a few words. */
  readonly meta?: string;
  /** Up to three actions under the card, the same on every card. */
  readonly actions?: ReactNode;
  /** A quiet link at the right of the actions, such as "Why this score". */
  readonly why?: ReactNode;
}

/**
 * A video, the same on every screen: thumbnail, amber score, length, a title
 * of two lines, channel · views · age, then its actions.
 */
export function VideoCard(props: CardProps) {
  const { title, href, channel, meta, actions, why } = props;
  const thumb = <VideoThumb {...props} />;
  const heading = <h3 className="mt-3 line-clamp-2 text-title-md text-ink">{title}</h3>;
  return (
    <article className="min-w-0">
      {href !== undefined ? (
        <a
          href={href}
          className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal [&:hover>h3]:text-link"
        >
          {thumb}
          {heading}
        </a>
      ) : (
        <>
          {thumb}
          {heading}
        </>
      )}
      {(channel || meta) && (
        <p className="mt-2 flex min-w-0 items-center gap-2 whitespace-nowrap text-body-sm text-muted">
          {channel && <Avatar title={channel.title} logoUrl={channel.logoUrl} size="xs" />}
          {channel &&
            (channel.href !== undefined ? (
              <a href={channel.href} className="flex-none font-medium text-ink hover:text-link">
                {channel.title}
              </a>
            ) : (
              <b className="flex-none font-medium text-ink">{channel.title}</b>
            ))}
          {meta && (
            <span className="min-w-0 truncate">
              {channel ? '· ' : ''}
              {meta}
            </span>
          )}
        </p>
      )}
      {(actions !== undefined || why !== undefined) && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          {actions}
          {why !== undefined && (
            <span className="ml-auto text-body-sm text-dim underline decoration-dotted underline-offset-[3px]">
              {why}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
