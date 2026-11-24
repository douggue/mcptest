import type { BoardCenter, BoardChannel, BoardVideo, ThumbnailBoard } from '@jgtube/core';
import { Download, FileText } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ThumbnailsSaved } from '../lib/api';
import { describeTranscripts, type TranscriptsSaved } from '../lib/breakdown';
import {
  describeHitRate,
  describeOwn,
  describeSaved,
  scoreTone,
  type BoardMode,
} from '../lib/board';
import { channelUrl, formatCount, initials } from '../lib/format';
import { Card } from './layout/Card';
import { ThumbnailTile } from './ThumbnailTile';

/** Six across on a wide screen, so a channel's handful sits on one line. */
const FULL_GRID = 'grid grid-cols-2 gap-x-3 gap-y-space-md sm:grid-cols-3 xl:grid-cols-6';
/** Three across, for two groups side by side. */
const HALF_GRID = 'grid grid-cols-2 gap-x-3 gap-y-space-md sm:grid-cols-3';
const AVATAR =
  'flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface-container-high text-body-sm font-bold ring-2 ring-border-subtle';
const EMPTY = 'rounded-lg bg-space-deep p-space-md text-body-sm text-on-surface-variant';

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
        <ThumbnailTile
          key={video.videoId}
          video={video}
          tone={scoreTone(video.score, board)}
          addable
        />
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
      <div className="flex flex-wrap items-center gap-1.5 text-body-sm text-outline">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-label text-on-surface-variant">{label}</span>
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

/** Saves one channel's thumbnails as files; resolves with where they went. */
export type DownloadThumbnails = (channelId: string) => Promise<ThumbnailsSaved>;
/** Saves the transcripts of one channel's videos that took off; resolves with where they went. */
export type DownloadTranscripts = (channelId: string) => Promise<TranscriptsSaved>;

type SaveState =
  | { readonly status: 'idle' }
  | { readonly status: 'saving' }
  | { readonly status: 'done'; readonly text: string }
  | { readonly status: 'failed'; readonly text: string };

interface SaveButtonProps {
  /** The button's words, while idle and while saving. */
  readonly label: string;
  readonly savingLabel: string;
  readonly ariaLabel: string;
  readonly icon: ReactNode;
  /** Saves the files and resolves with the sentence that says where they are. */
  readonly onSave: () => Promise<string>;
  /** What to say when the save fails without a reason of its own. */
  readonly failedText: string;
}

/**
 * Saves files of one channel to the owner's computer and says where they
 * are. The folder's path is long, so it is allowed to break anywhere and
 * never pushes the card wider than the screen.
 */
function SaveButton(props: SaveButtonProps) {
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const save = () => {
    setState({ status: 'saving' });
    props
      .onSave()
      .then((text) => setState({ status: 'done', text }))
      .catch((error: unknown) =>
        setState({
          status: 'failed',
          text: error instanceof Error ? error.message : props.failedText,
        }),
      );
  };
  return (
    <div className="flex min-w-0 flex-col items-start gap-space-sm sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={save}
        disabled={state.status === 'saving'}
        aria-label={props.ariaLabel}
        className="flex min-h-9 flex-none items-center gap-1.5 rounded-full bg-surface-container-high px-3 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-wait disabled:opacity-60"
      >
        {props.icon}
        {state.status === 'saving' ? props.savingLabel : props.label}
      </button>
      {state.status === 'done' && (
        <p role="status" className="min-w-0 break-all text-body-sm text-on-surface-variant">
          {state.text}
        </p>
      )}
      {state.status === 'failed' && (
        <p role="alert" className="min-w-0 break-words text-body-sm text-error">
          {state.text}
        </p>
      )}
    </div>
  );
}

interface SaveProps {
  readonly channelId: string;
  readonly channelTitle: string;
  readonly onDownload: DownloadThumbnails;
}

/** Saves a channel's winning and ordinary thumbnails and says where they are. */
function SaveThumbnails({ channelId, channelTitle, onDownload }: SaveProps) {
  return (
    <SaveButton
      label="Download thumbnails"
      savingLabel="Saving thumbnails"
      ariaLabel={`Download the thumbnails of ${channelTitle}`}
      icon={<Download aria-hidden="true" className="h-4 w-4" />}
      onSave={async () => describeSaved(await onDownload(channelId))}
      failedText="The thumbnails could not be saved"
    />
  );
}

interface SaveTranscriptsProps {
  readonly channelId: string;
  readonly channelTitle: string;
  readonly onDownload: DownloadTranscripts;
}

/** Saves the transcripts of a channel's videos that took off, as text files, and says where they are. */
function SaveTranscripts({ channelId, channelTitle, onDownload }: SaveTranscriptsProps) {
  return (
    <SaveButton
      label="Download transcripts"
      savingLabel="Saving transcripts"
      ariaLabel={`Download the transcripts of ${channelTitle}`}
      icon={<FileText aria-hidden="true" className="h-4 w-4" />}
      onSave={async () => describeTranscripts(await onDownload(channelId))}
      failedText="The transcripts could not be saved"
    />
  );
}

interface ChannelProps {
  readonly channel: BoardChannel;
  readonly board: ThumbnailBoard;
  readonly mode: BoardMode;
  /** This is the channel the owner said they want to be like. */
  readonly isModel: boolean;
  readonly onDownload: DownloadThumbnails;
  readonly onDownloadTranscripts: DownloadTranscripts;
}

/** One channel like yours: what worked for it, and beside that what did not. */
export function ChannelCard(props: ChannelProps) {
  const { channel, board, mode, isModel, onDownload, onDownloadTranscripts } = props;
  const comparing = mode === 'compare';
  return (
    <Card as="article">
      <div className="flex min-w-0 items-center gap-space-sm">
        <div className={`${AVATAR} text-secondary`}>{initials(channel.title).charAt(0)}</div>
        <div className="flex min-w-0 flex-col">
          <ChannelName channel={channel} />
          <span className="truncate text-body-sm text-on-surface-variant">
            {formatCount(channel.subscribers)} subscribers · {describeHitRate(channel)}
          </span>
        </div>
        {isModel && (
          <span className="ml-auto flex-none rounded-full bg-surface-container-high px-2 py-0.5 text-label text-primary-fixed-dim">
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
      {channel.winners.length + channel.ordinary.length > 0 && (
        <div className="flex min-w-0 flex-col gap-space-sm border-t border-border-subtle pt-space-md sm:flex-row sm:flex-wrap sm:gap-space-md">
          <SaveThumbnails
            channelId={channel.id}
            channelTitle={channel.title}
            onDownload={onDownload}
          />
          {channel.winners.length > 0 && (
            <SaveTranscripts
              channelId={channel.id}
              channelTitle={channel.title}
              onDownload={onDownloadTranscripts}
            />
          )}
        </div>
      )}
    </Card>
  );
}

interface OwnProps {
  readonly center: BoardCenter;
  readonly board: ThumbnailBoard;
  readonly onDownload: DownloadThumbnails;
}

/** The owner's own newest thumbnails, to hold up against the rest. */
export function OwnCard({ center, board, onDownload }: OwnProps) {
  return (
    <Card as="article" highlighted>
      <div className="flex min-w-0 items-center gap-space-sm">
        <div className={`${AVATAR} text-primary-container`}>{initials(center.title).charAt(0)}</div>
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-title-md text-on-surface">Your thumbnails</h3>
          <span className="truncate text-body-sm text-on-surface-variant">
            {describeOwn(center)}
          </span>
        </div>
      </div>
      <Tiles
        videos={center.videos}
        grid={FULL_GRID}
        emptyText="No videos are stored for your channel yet. Make a new map once you have published."
        board={board}
      />
      {center.videos.length > 0 && (
        <SaveThumbnails channelId={center.id} channelTitle={center.title} onDownload={onDownload} />
      )}
    </Card>
  );
}
