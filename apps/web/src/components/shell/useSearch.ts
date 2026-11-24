import { useEffect, useMemo, useState } from 'react';
import { createBankApi, parseSavedBank } from '../../lib/bank';
import { requestCounter } from '../../lib/requests';
import {
  VIDEO_HITS,
  createSearchApi,
  linkTarget,
  mergeChannels,
  searchable,
  videoHit,
  type LinkTarget,
  type SearchChannel,
  type VideoHit,
} from '../../lib/search';

/** Typing waits this long before the store is searched. */
const WAIT_MS = 250;

/** What the store holds for a pasted link. */
export type Linked =
  /** The store is being asked. */
  | { readonly status: 'looking' }
  /** A stored channel, or a stored video with its title. */
  | { readonly status: 'channel'; readonly channel: SearchChannel }
  | { readonly status: 'video'; readonly video: VideoHit }
  /** The store has no row for it. */
  | { readonly status: 'missing' };

export interface SearchResults {
  /** What the text names when it is a YouTube link; null for plain words. */
  readonly link: LinkTarget | null;
  /** What the store holds for that link; null for plain words. */
  readonly linked: Linked | null;
  readonly channels: readonly SearchChannel[];
  readonly videos: readonly VideoHit[];
  /** The stored videos are being searched. */
  readonly loading: boolean;
  /** Why the store could not be searched; null when it was. */
  readonly problem: string | null;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The store was not searched';

/** What the store holds for a pasted link: asked once the link has been typed whole. */
function useLinked(link: LinkTarget | null, text: string): Linked | null {
  const api = useMemo(() => createSearchApi(), []);
  const bank = useMemo(() => createBankApi(), []);
  const [linked, setLinked] = useState<Linked | null>(null);
  const kind = link?.kind ?? null;
  const videoId = link?.kind === 'video' ? link.videoId : null;
  useEffect(() => {
    if (kind === null) {
      setLinked(null);
      return undefined;
    }
    let current = true;
    setLinked({ status: 'looking' });
    const missing = (): void => {
      if (current) setLinked({ status: 'missing' });
    };
    const wait = window.setTimeout(() => {
      if (videoId !== null) {
        bank.video(videoId).then((found) => {
          if (!current) return;
          setLinked(
            found ? { status: 'video', video: videoHit(found.video) } : { status: 'missing' },
          );
        }, missing);
        return;
      }
      api.findChannel(text).then((channel) => {
        if (current) setLinked(channel ? { status: 'channel', channel } : { status: 'missing' });
      }, missing);
    }, WAIT_MS);
    return () => {
      current = false;
      window.clearTimeout(wait);
    };
  }, [api, bank, kind, videoId, text]);
  return linked;
}

/**
 * What the top bar's search finds for the text typed: the link it names and
 * what the store holds for it, or every stored channel and video the words
 * match. The channels already on screen show at once; the store's follow.
 */
export function useSearch(text: string, onScreen: readonly SearchChannel[]): SearchResults {
  const api = useMemo(() => createSearchApi(), []);
  const bank = useMemo(() => createBankApi(), []);
  const counter = useMemo(requestCounter, []);
  const [videos, setVideos] = useState<readonly VideoHit[]>([]);
  const [stored, setStored] = useState<readonly SearchChannel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const words = text.trim();
  const ask = searchable(words);

  useEffect(() => {
    const isNewest = counter.begin();
    setProblem(null);
    setStored(null);
    if (!ask) {
      setVideos([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const wait = window.setTimeout(() => {
      api.channels(words).then(
        (found) => isNewest() && setStored(found),
        (error: unknown) => isNewest() && setProblem(messageOf(error)),
      );
      bank.look({ ...parseSavedBank(null), contains: words }, 0, VIDEO_HITS).then(
        (look) => {
          if (!isNewest()) return;
          setVideos(look.page.videos.map(videoHit));
          setLoading(false);
        },
        (error: unknown) => {
          if (!isNewest()) return;
          setVideos([]);
          setLoading(false);
          setProblem(messageOf(error));
        },
      );
    }, WAIT_MS);
    return () => window.clearTimeout(wait);
  }, [api, bank, counter, ask, words]);

  const link = useMemo(() => linkTarget(words), [words]);
  const linked = useLinked(link, words);
  const channels = useMemo(
    () => (ask ? mergeChannels(words, onScreen, stored) : []),
    [ask, words, onScreen, stored],
  );
  return { link, linked, channels, videos, loading, problem };
}
