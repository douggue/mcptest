import { useEffect, useMemo, useState } from 'react';
import { ANALYSIS_OPTIONS, latestKept, type KeptAnswer } from '../lib/analyses';
import { createAnswersApi, type AnswersApi } from '../lib/answersApi';
import { namedIds, type NamedVideo } from '../lib/videoRefs';

/** The one reader of kept answers the page needs; it holds no state of its own. */
export const answersApi: AnswersApi = createAnswersApi();

/**
 * The answer kept most recently for the channel on screen, read again when
 * `version` changes (after a new answer is given). Null while reading, when
 * none is kept, or when the server cannot say: the buttons still work.
 */
export function useKeptAnswer(centerId: string, version: number): KeptAnswer | null {
  const [kept, setKept] = useState<KeptAnswer | null>(null);
  useEffect(() => {
    let current = true;
    setKept(null);
    Promise.all(
      ANALYSIS_OPTIONS.map(async ({ id }) => ({
        analysis: id,
        answer: await answersApi.keptAnswer(id, centerId).catch(() => null),
      })),
    )
      .then((entries) => {
        if (current) setKept(latestKept(entries));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [centerId, version]);
  return kept;
}

/**
 * The stored videos a text names, looked up for a channel's map and, with
 * `of`, the stored videos of one more channel (one that was broken down).
 * None while reading or when the lookup fails: the words are shown either way.
 */
export function useNamedVideos(channel: string, text: string, of?: string): readonly NamedVideo[] {
  const ids = useMemo(() => namedIds(text), [text]);
  const key = ids.join(',');
  const [videos, setVideos] = useState<readonly NamedVideo[]>([]);
  useEffect(() => {
    let current = true;
    const wanted = key === '' ? [] : key.split(',');
    answersApi
      .namedVideos(channel, wanted, of)
      .then((found) => {
        if (current) setVideos(found);
      })
      .catch(() => {
        if (current) setVideos([]);
      });
    return () => {
      current = false;
    };
  }, [channel, key, of]);
  return videos;
}
