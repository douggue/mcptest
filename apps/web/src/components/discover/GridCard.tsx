import type { BankCollection } from '@jgtube/core';
import { Bookmark, Check, Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { createBankApi } from '../../lib/bank';
import { channelHref, videoHref } from '../../lib/routes';
import type { GridVideo } from '../../lib/videoViews';
import { AddToFormat } from '../AddToFormat';
import { BankSave } from '../BankSave';
import { Button } from '../ui/Button';
import { VideoCard } from '../ui/VideoCard';

interface SavedState {
  readonly collections: readonly BankCollection[];
  readonly saved: readonly number[];
}

/**
 * Save for a video whose collections are not known yet: they are read when
 * the owner presses Save, then the same Save as everywhere opens.
 */
export function SaveVideo({ videoId }: { readonly videoId: string }) {
  const api = useMemo(() => createBankApi(), []);
  const [state, setState] = useState<SavedState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (state) {
    return (
      <BankSave
        defaultOpen
        videoId={videoId}
        collections={state.collections}
        inCollections={state.saved}
        onChanged={(collections, saved) => setState({ collections, saved })}
      />
    );
  }
  const read = (): void => {
    api.video(videoId).then(
      (found) => {
        if (found) setState({ collections: found.collections, saved: found.saved });
        else setProblem('This video is not in the bank yet, so it cannot be saved.');
      },
      (error: unknown) =>
        setProblem(error instanceof Error ? error.message : 'It could not be saved'),
    );
  };
  return (
    <>
      <Button small icon={Bookmark} onClick={read}>
        Save
      </Button>
      {problem && (
        <span role="alert" className="basis-full text-body-sm text-bad">
          {problem}
        </span>
      )}
    </>
  );
}

interface Props {
  readonly video: GridVideo;
  /** It is among the picks of the idea lab. */
  readonly picked: boolean;
  readonly onPick: () => void;
  /** The Save control; one that already knows the video's collections where the list does. */
  readonly save: ReactNode;
}

/**
 * A video of the grid, the same in every view: its thumbnail and title open
 * its page, then the same three actions (Ideas, Format, Save) and what its
 * score rests on, shown when asked.
 */
export function GridCard({ video, picked, onPick, save }: Props) {
  const [why, setWhy] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <VideoCard
        videoId={video.videoId}
        href={videoHref(video.videoId)}
        title={video.title}
        score={video.score}
        durationSeconds={video.durationSeconds}
        channel={{
          title: video.channelTitle,
          logoUrl: video.channelLogoUrl,
          href: channelHref(video.channelId),
        }}
        meta={video.meta}
        actions={
          <>
            <Button small icon={picked ? Check : Plus} onClick={onPick} pressed={picked}>
              {picked ? 'In ideas' : 'Ideas'}
            </Button>
            <AddToFormat
              small
              label="Format"
              source={{ kind: 'video', use: 'video', videoId: video.videoId, center: null }}
            />
            {save}
          </>
        }
        why={
          <button
            type="button"
            aria-expanded={why}
            onClick={() => setWhy((open) => !open)}
            className="rounded underline decoration-dotted underline-offset-[3px] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            Why this score
          </button>
        }
      />
      {why && <p className="break-words text-body-sm text-muted">{video.why}</p>}
    </div>
  );
}
