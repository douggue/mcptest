import { ExternalLink, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import {
  folderNote,
  savedText,
  sendingText,
  type UploadedVideo,
  type VideoToSupply,
} from '../lib/breakdown';
import { watchUrl } from '../lib/format';

/** Sends one video file for a video, reporting the fraction sent as it goes. */
export type SendVideo = (
  videoId: string,
  file: File,
  onProgress: (fraction: number) => void,
) => Promise<UploadedVideo>;

type SendState =
  | { readonly status: 'idle' }
  | { readonly status: 'sending'; readonly fraction: number }
  | { readonly status: 'saved'; readonly text: string }
  | { readonly status: 'failed'; readonly text: string };

interface RowProps {
  readonly video: VideoToSupply;
  readonly onSend: SendVideo;
}

/** One video the owner can give a file for: what it is, why Jgtube has none, and the control to choose it. */
function SupplyRow({ video, onSend }: RowProps) {
  const [state, setState] = useState<SendState>({ status: 'idle' });
  const link = watchUrl(video.videoId);
  const sending = state.status === 'sending';

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again after a failure still sends it.
    event.target.value = '';
    if (!file) return;
    setState({ status: 'sending', fraction: 0 });
    onSend(video.videoId, file, (fraction) => setState({ status: 'sending', fraction }))
      .then((saved) => setState({ status: 'saved', text: savedText(saved) }))
      .catch((error: unknown) =>
        setState({
          status: 'failed',
          text: error instanceof Error ? error.message : 'The file could not be sent',
        }),
      );
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded bg-space-deep p-space-md">
      <div className="flex min-w-0 flex-col gap-1">
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1.5 text-body-md text-on-surface underline decoration-border-highlight underline-offset-2 hover:text-primary"
          >
            <span className="min-w-0 break-words">{video.title}</span>
            <ExternalLink aria-hidden="true" className="h-4 w-4 flex-none" />
          </a>
        ) : (
          <span className="break-words text-body-md text-on-surface">{video.title}</span>
        )}
        <p className="break-words text-body-sm text-on-surface-variant">{video.reason}</p>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-space-sm sm:flex-row sm:items-center">
        <label
          className={`flex flex-none items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-2 text-label text-on-surface transition-colors focus-within:ring-1 focus-within:ring-primary-container hover:bg-surface-variant ${
            sending ? 'cursor-wait opacity-60' : 'cursor-pointer'
          }`}
        >
          <Upload aria-hidden="true" className="h-4 w-4" />
          Choose the video file
          <input
            type="file"
            accept="video/mp4,.mp4"
            disabled={sending}
            onChange={choose}
            aria-label={`Choose the video file for ${video.title}`}
            className="sr-only"
          />
        </label>
        {state.status === 'sending' && (
          <p role="status" className="text-label text-on-surface-variant">
            {sendingText(state.fraction)}
          </p>
        )}
        {state.status === 'saved' && (
          <p role="status" className="min-w-0 break-words text-label text-on-surface-variant">
            {state.text}
          </p>
        )}
        {state.status === 'failed' && (
          <p role="alert" className="min-w-0 break-words text-label text-error">
            {state.text}
          </p>
        )}
      </div>
    </li>
  );
}

interface Props {
  readonly videos: readonly VideoToSupply[];
  /** The folder the owner's own files go in; null when there is nowhere to save. */
  readonly folder: string | null;
  readonly onSend: SendVideo;
}

/**
 * The videos Jgtube could not download, each with a control to give it the
 * file. A file given is studied the next time the breakdown is run: every
 * second of the picture, and the sound when an engine that watches is there.
 */
export function SupplyVideos({ videos, folder, onSend }: Props) {
  if (videos.length === 0) return null;
  const note = folderNote(folder);
  return (
    <div className="flex min-w-0 flex-col gap-space-sm rounded bg-surface-card p-space-lg">
      <h4 className="text-label text-primary">Videos you can give Jgtube</h4>
      <p className="text-body-sm text-on-surface-variant">
        Jgtube could not download {videos.length === 1 ? 'this video' : 'these videos'}. If you have
        the file as an MP4, choose it here and run the breakdown again: Jgtube then studies the
        video itself, one frame for every second, instead of YouTube&rsquo;s small preview pictures.
      </p>
      <ul className="flex flex-col gap-2">
        {videos.map((video) => (
          <SupplyRow key={video.videoId} video={video} onSend={onSend} />
        ))}
      </ul>
      {note !== '' && <p className="break-all text-body-sm text-outline">{note}</p>}
    </div>
  );
}
