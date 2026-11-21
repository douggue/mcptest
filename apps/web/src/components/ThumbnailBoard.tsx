import type { ThumbnailBoard as Board } from '@jgtube/core';
import { useState } from 'react';
import { BOARD_MODES, boardTotals, type BoardMode } from '../lib/board';
import {
  ChannelCard,
  OwnCard,
  type DownloadThumbnails,
  type DownloadTranscripts,
} from './ThumbnailChannel';
import { Notice, ShowMore } from './layout/Notice';
import { Segmented } from './layout/Segmented';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import type { BoardState } from './useThumbnailBoard';

const CHANNELS_PER_PAGE = 5;

interface ToggleProps {
  readonly mode: BoardMode;
  readonly onChange: (mode: BoardMode) => void;
}

/** Switches between winners alone and winners next to ordinary videos. */
function ModeToggle({ mode, onChange }: ToggleProps) {
  return (
    <Segmented<BoardMode>
      label="Which thumbnails to show"
      options={BOARD_MODES.map((option) => ({ value: option.id, label: option.label }))}
      value={mode}
      onChange={onChange}
    />
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
    <div className="flex flex-col gap-space-lg">
      <OwnCard center={board.center} board={board} onDownload={onDownload} />
      {board.channels.length === 0 && (
        <Notice>
          No channel on this map is counted as like yours yet, so there is nothing to compare with.
          Make a larger map, or name a channel you want to be like.
        </Notice>
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
        <ShowMore
          left={hidden}
          noun="channels"
          onClick={() => setShown((count) => count + CHANNELS_PER_PAGE)}
        />
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
    <ViewPage id="thumbnail-board" labelledBy="thumbnail-board-title">
      <ViewHeader
        titleId="thumbnail-board-title"
        title="Thumbnails that worked"
        lead={
          hasChannels
            ? `${totals.winners} that took off on the ${totals.channels} channels like ${centerTitle}, beside ones that did not, and yours.`
            : `What took off on the channels like ${centerTitle}, beside what did not, and yours.`
        }
        actions={hasChannels && <ModeToggle mode={mode} onChange={setMode} />}
      />
      {state.status === 'loading' && <Notice tone="working">Gathering thumbnails</Notice>}
      {state.status === 'failed' && (
        <Notice tone="problem">The thumbnails could not be loaded: {state.message}</Notice>
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
    </ViewPage>
  );
}
