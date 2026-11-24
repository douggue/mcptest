import { useEffect, useMemo, useState } from 'react';
import { createBankApi, parseSavedBank } from '../../lib/bank';
import { requestCounter } from '../../lib/requests';
import {
  VIDEO_HITS,
  linkTarget,
  matchChannels,
  searchable,
  videoHit,
  type LinkTarget,
  type SearchChannel,
  type VideoHit,
} from '../../lib/search';

/** Typing waits this long before the stored videos are asked for. */
const WAIT_MS = 250;

export interface SearchResults {
  /** What the text names when it is a YouTube link; null for plain words. */
  readonly link: LinkTarget | null;
  readonly channels: readonly SearchChannel[];
  readonly videos: readonly VideoHit[];
  /** The stored videos are being read. */
  readonly loading: boolean;
  /** Why the stored videos could not be read; null when they were. */
  readonly problem: string | null;
}

/**
 * What the top bar's search finds for the text typed: the link it names, the
 * stored channels that match (from the map on screen and the owner's own),
 * and the stored videos whose title holds the words, read from the bank.
 */
export function useSearch(text: string, known: readonly SearchChannel[]): SearchResults {
  const api = useMemo(() => createBankApi(), []);
  const counter = useMemo(requestCounter, []);
  const [videos, setVideos] = useState<readonly VideoHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const words = text.trim();
  const ask = searchable(words);

  useEffect(() => {
    const isNewest = counter.begin();
    setProblem(null);
    if (!ask) {
      setVideos([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const wait = window.setTimeout(() => {
      api.look({ ...parseSavedBank(null), contains: words }, 0, VIDEO_HITS).then(
        (look) => {
          if (!isNewest()) return;
          setVideos(look.page.videos.map(videoHit));
          setLoading(false);
        },
        (error: unknown) => {
          if (!isNewest()) return;
          setVideos([]);
          setLoading(false);
          setProblem(error instanceof Error ? error.message : 'The stored videos were not read');
        },
      );
    }, WAIT_MS);
    return () => window.clearTimeout(wait);
  }, [api, counter, ask, words]);

  const link = useMemo(() => linkTarget(words), [words]);
  const channels = useMemo(() => (ask ? matchChannels(words, known) : []), [ask, words, known]);
  return { link, channels, videos, loading, problem };
}
