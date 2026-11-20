import type { BoardCenter, BoardChannel, BoardVideo, ThumbnailBoard } from '@jgtube/core';
import { describeHitRate, describeOwn, scoreTone, type BoardMode } from '../lib/board';
import { channelUrl, formatCount, initials } from '../lib/format';
import { ThumbnailTile } from './ThumbnailTile';

/** Six across on a wide screen, so a channel's handful sits on one line. */
const FULL_GRID = 'grid grid-cols-2 gap-x-3 gap-y-space-md sm:grid-cols-3 xl:grid-cols-6';
/** Three across, for two groups side by side. */
const HALF_GRID = 'grid grid-cols-2 gap-x-3 gap-y-space-md sm:grid-cols-3';
const CARD = 'flex flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md';
const AVATAR =
  'flex h-8 w-8 flex-none items-center justify-center rounded-full bg-space-deep text-xs font-bold';
const EMPTY = 'rounded bg-surface-container-low p-space-md text-body-sm text-on-surface-variant';

interface TilesProps {
  readonly videos: readonly BoardVideo[];
  readonly grid: string;
  readonly emptyText: string;
  readonly board: ThumbnailBoard;
}

/** A grid of thumbnails, or a line saying why there are none. */
function Tiles({ videos, grid, emptyText, board }: TilesProps) {
  if (videos.length === 0) return <p className={EMPTY}>{emptyText}</p>;
  return (
    <div className={grid}>
      {videos.map((video) => (
        <ThumbnailTile key={video.videoId} video={video} tone={scoreTone(video.score, board)} />
      ))}
    </div>
  );
}

interface GroupProps extends TilesProps {
  readonly label: string;
  readonly hint: string;
  /** The colour of the dot before the label. */
  readonly dot: string;
}

/** One labelled set of a channel's thumbnails. */
function Group({ label, hint, dot, ...tiles }: GroupProps) {
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-label-caps text-outline">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="uppercase text-on-surface-variant">{label}</span>
        <span>{hint}</span>
      </div>
      <Tiles {...tiles} />
    </div>
  );
}

function ChannelName({ channel }: { readonly channel: BoardChannel }) {
  const link = channelUrl(channel.id);
  return (
    <h3 className="truncate text-title-md text-on-surface">
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-primary"
        >
          {channel.title}
        </a>
      ) : (
        channel.title
      )}
    </h3>
  );
}

interface ChannelProps {
  readonly channel: BoardChannel;
  readonly board: ThumbnailBoard;
  readonly mode: BoardMode;
  /** This is the channel the owner said they want to be like. */
  readonly isModel: boolean;
}

/** One channel like yours: what worked for it, and beside that what did not. */
export function ChannelCard({ channel, board, mode, isModel }: ChannelProps) {
  const comparing = mode === 'compare';
  return (
    <article className={CARD}>
      <div className="flex min-w-0 items-center gap-space-sm">
        <div className={`${AVATAR} text-secondary`}>{initials(channel.title).charAt(0)}</div>
        <div className="flex min-w-0 flex-col">
          <ChannelName channel={channel} />
          <span className="truncate text-label-caps text-outline">
            {formatCount(channel.subscribers)} subscribers · {describeHitRate(channel)}
          </span>
        </div>
        {isModel && (
          <span className="ml-auto flex-none rounded-full bg-surface-container-high px-2 py-0.5 text-label-caps text-primary-fixed-dim">
            Your model
          </span>
        )}
      </div>
      <div className={comparing ? 'grid grid-cols-1 gap-space-lg xl:grid-cols-2' : undefined}>
        <Group
          label="Worked"
          hint={`${board.winnerMinScore}× its usual views or more`}
          dot="bg-metric-amber"
          videos={channel.winners}
          grid={comparing ? HALF_GRID : FULL_GRID}
          emptyText={`No video here has reached ${board.winnerMinScore}× this channel’s usual views yet.`}
          board={board}
        />
        {comparing && (
          <Group
            label="Ordinary"
            hint="its usual views or fewer"
            dot="bg-outline"
            videos={channel.ordinary}
            grid={HALF_GRID}
            emptyText="No video old enough to judge sits at or below this channel’s usual views."
            board={board}
          />
        )}
      </div>
    </article>
  );
}

interface OwnProps {
  readonly center: BoardCenter;
  readonly board: ThumbnailBoard;
}

/** The owner's own newest thumbnails, to hold up against the rest. */
export function OwnCard({ center, board }: OwnProps) {
  return (
    <article className={`${CARD} ring-1 ring-border-highlight`}>
      <div className="flex min-w-0 items-center gap-space-sm">
        <div className={`${AVATAR} text-primary-container`}>{initials(center.title).charAt(0)}</div>
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-title-md text-on-surface">Your thumbnails</h3>
          <span className="truncate text-label-caps text-outline">{describeOwn(center)}</span>
        </div>
      </div>
      <Tiles
        videos={center.videos}
        grid={FULL_GRID}
        emptyText="No videos are stored for your channel yet. Make a new map once you have published."
        board={board}
      />
    </article>
  );
}
