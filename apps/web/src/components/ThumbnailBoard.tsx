import type { ThumbnailBoard as Board } from '@jgtube/core';
import { Images } from 'lucide-react';
import { useState } from 'react';
import { BOARD_MODES, boardTotals, type BoardMode } from '../lib/board';
import {
  ChannelCard,
  OwnCard,
  type DownloadThumbnails,
  type DownloadTranscripts,
} from './ThumbnailChannel';
import type { BoardState } from './useThumbnailBoard';

const CHANNELS_PER_PAGE = 5;
const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';

interface ToggleProps {
  readonly mode: BoardMode;
  readonly onChange: (mode: BoardMode) => void;
}

/** Switches between winners alone and winners next to ordinary videos. */
function ModeToggle({ mode, onChange }: ToggleProps) {
  return (
    <div
      role="group"
      aria-label="Which thumbnails to show"
      className="flex flex-wrap items-center gap-1.5 pb-1"
    >
      {BOARD_MODES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={mode === option.id}
          onClick={() => onChange(option.id)}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-label-caps transition-colors ${
            mode === option.id
              ? 'bg-surface-card font-semibold text-primary shadow-sm'
              : 'bg-surface-container text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface CardsProps {
  readonly board: Board;
  readonly mode: BoardMode;
  readonly modelId: string | null;
  readonly onDownload: DownloadThumbnails;
  readonly onDownloadTranscripts: DownloadTranscripts;
}

/** The owner's own row, then one card per channel like theirs, a few at a time. */
function Cards({ board, mode, modelId, onDownload, onDownloadTranscripts }: CardsProps) {
  const [shown, setShown] = useState(CHANNELS_PER_PAGE);
  const hidden = board.channels.length - shown;
  return (
    <div className="flex flex-col gap-space-md">
      <OwnCard center={board.center} board={board} onDownload={onDownload} />
      {board.channels.length === 0 && (
        <p className={NOTE}>
          No channel on this map is counted as like yours yet, so there is nothing to compare with.
          Make a larger map, or name a channel you want to be like.
        </p>
      )}
      {board.channels.slice(0, shown).map((channel) => (
        <ChannelCard
          key={channel.id}
          channel={channel}
          board={board}
          mode={mode}
          isModel={channel.id === modelId}
          onDownload={onDownload}
          onDownloadTranscripts={onDownloadTranscripts}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShown((count) => count + CHANNELS_PER_PAGE)}
          className="self-center rounded-full bg-surface-container px-5 py-2.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-card"
        >
          Show more channels ({hidden} left)
        </button>
      )}
    </div>
  );
}

interface Props {
  readonly state: BoardState;
  readonly centerTitle: string;
  /** The channel the map is measured against, when the owner named one. */
  readonly modelId: string | null;
  /** Saves one channel's thumbnails as files on the owner's computer. */
  readonly onDownload: DownloadThumbnails;
  /** Saves the transcripts of one channel's videos that took off as files. */
  readonly onDownloadTranscripts: DownloadTranscripts;
}

/** Thumbnails that worked on the channels like yours, beside ordinary ones and your own. */
export function ThumbnailBoard(props: Props) {
  const { state, centerTitle, modelId, onDownload, onDownloadTranscripts } = props;
  const [mode, setMode] = useState<BoardMode>('compare');
  if (state.status === 'idle') return null;
  const board = state.status === 'ready' ? state.board : null;
  const totals = board ? boardTotals(board) : null;
  const hasChannels = totals !== null && totals.channels > 0;

  return (
    <section
      aria-labelledby="thumbnail-board-title"
      className="w-full bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div className="flex flex-col justify-between gap-space-md pb-space-sm sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2">
              <Images aria-hidden="true" className="h-[22px] w-[22px] text-metric-amber" />
              <h2
                id="thumbnail-board-title"
                className="text-headline-lg font-bold tracking-tight text-on-surface"
              >
                Thumbnails that worked
              </h2>
            </div>
            <p className="mt-1 text-body-md text-on-surface-variant">
              {hasChannels
                ? `${totals.winners} thumbnails that took off on the ${totals.channels} channels like ${centerTitle}, beside ones that did not, and yours.`
                : `What took off on the channels like ${centerTitle}, beside what did not, and yours.`}
            </p>
          </div>
          {hasChannels && <ModeToggle mode={mode} onChange={setMode} />}
        </div>

        {state.status === 'loading' && (
          <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
            Gathering thumbnails
          </p>
        )}
        {state.status === 'failed' && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            The thumbnails could not be loaded: {state.message}
          </p>
        )}
        {board && (
          <Cards
            key={board.mapId}
            board={board}
            mode={mode}
            modelId={modelId}
            onDownloadTranscripts={onDownloadTranscripts}
            onDownload={onDownload}
          />
        )}
      </div>
    </section>
  );
}
