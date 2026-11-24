import { Clapperboard, Link2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { thumbnailUrl } from '../../lib/format';
import { channelMeta, type LinkTarget, type SearchChannel, type VideoHit } from '../../lib/search';
import { Avatar } from '../ui/Row';
import type { SearchResults as Results } from './useSearch';

const ITEM =
  'flex min-h-14 w-full min-w-0 items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal disabled:opacity-60';

function Words({ title, meta }: { readonly title: string; readonly meta: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-body-md font-semibold text-ink">{title}</span>
      <span className="truncate text-body-sm text-muted">{meta}</span>
    </span>
  );
}

function IconTile({ icon: Icon }: { readonly icon: LucideIcon }) {
  return (
    <span className="grid h-10 w-10 flex-none place-items-center rounded-md border border-line text-signal">
      <Icon aria-hidden="true" className="h-5 w-5" />
    </span>
  );
}

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h3 className="px-3 pb-1 pt-2 text-body-sm text-dim">{title}</h3>
      {children}
    </section>
  );
}

function VideoThumbSmall({ videoId }: { readonly videoId: string }) {
  const picture = thumbnailUrl(videoId);
  return (
    <span className="h-10 w-[71px] flex-none overflow-hidden rounded-md border border-white/10 bg-card-2">
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
  );
}

export interface SearchActions {
  readonly openChannel: (channelId: string) => void;
  readonly openVideo: (videoId: string) => void;
  /** Reads a channel that is not stored from YouTube, then opens it. */
  readonly readChannel: (ref: string) => void;
  /** A channel is being read from YouTube. */
  readonly reading: boolean;
  /** Why the last read failed; null when it did not. */
  readonly readProblem: string | null;
}

interface LinkProps {
  readonly link: LinkTarget;
  readonly text: string;
  /** The stored channel the link names, when it is one. */
  readonly stored: SearchChannel | null;
  readonly actions: SearchActions;
}

/** The one row a pasted link gives: the video or the channel it names. */
function LinkRow({ link, text, stored, actions }: LinkProps) {
  if (link.kind === 'video') {
    return (
      <button type="button" className={ITEM} onClick={() => actions.openVideo(link.videoId)}>
        <VideoThumbSmall videoId={link.videoId} />
        <Words title="Open this video" meta="Break it down, or review its thumbnail" />
      </button>
    );
  }
  if (stored) {
    return (
      <button type="button" className={ITEM} onClick={() => actions.openChannel(stored.id)}>
        <Avatar title={stored.title} logoUrl={stored.logoUrl} />
        <Words title={stored.title} meta={`Open this channel · ${channelMeta(stored)}`} />
      </button>
    );
  }
  return (
    <button
      type="button"
      className={ITEM}
      disabled={actions.reading}
      onClick={() => actions.readChannel(text)}
    >
      <IconTile icon={Link2} />
      <Words
        title={actions.reading ? 'Reading the channel from YouTube…' : 'Open this channel'}
        meta="It is not stored yet. Jgtube reads it from YouTube first."
      />
    </button>
  );
}

interface Props {
  readonly text: string;
  readonly results: Results;
  /** The stored channel a pasted channel link names; null when none. */
  readonly storedLink: SearchChannel | null;
  readonly actions: SearchActions;
}

function Videos({
  videos,
  actions,
}: {
  readonly videos: readonly VideoHit[];
  readonly actions: SearchActions;
}) {
  return (
    <Group title="Videos">
      {videos.map((video) => (
        <button
          key={video.videoId}
          type="button"
          className={ITEM}
          onClick={() => actions.openVideo(video.videoId)}
        >
          <VideoThumbSmall videoId={video.videoId} />
          <Words title={video.title} meta={`${video.channelTitle} · ${video.meta}`} />
        </button>
      ))}
    </Group>
  );
}

/** What the search found, under the box: a pasted link's one row, or channels and videos. */
export function SearchResults({ text, results, storedLink, actions }: Props) {
  const { link, channels, videos, loading, problem } = results;
  if (link) {
    return (
      <div className="flex flex-col">
        <LinkRow link={link} text={text} stored={storedLink} actions={actions} />
        {actions.readProblem && (
          <p role="alert" className="px-3 pb-2 text-body-sm text-bad">
            {actions.readProblem}
          </p>
        )}
      </div>
    );
  }
  const nothing = channels.length === 0 && videos.length === 0;
  return (
    <div className="flex flex-col">
      {channels.length > 0 && (
        <Group title="Channels">
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={ITEM}
              onClick={() => actions.openChannel(channel.id)}
            >
              <Avatar title={channel.title} logoUrl={channel.logoUrl} />
              <Words title={channel.title} meta={channelMeta(channel)} />
            </button>
          ))}
        </Group>
      )}
      {videos.length > 0 && <Videos videos={videos} actions={actions} />}
      {problem && (
        <p role="alert" className="px-3 py-2 text-body-sm text-bad">
          The stored videos were not searched: {problem}
        </p>
      )}
      {nothing && !problem && (
        <p role="status" className="flex items-center gap-3 px-3 py-3 text-body-md text-muted">
          <Clapperboard aria-hidden="true" className="h-5 w-5 flex-none text-dim" />
          {loading
            ? 'Searching what is stored…'
            : 'Nothing stored matches. Paste a YouTube link to open a channel or a video.'}
        </p>
      )}
    </div>
  );
}
