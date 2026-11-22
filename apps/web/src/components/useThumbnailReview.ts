import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { choiceFor, type EngineChoice, type EngineReport } from '../lib/analyses';
import { createExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';
import {
  firstPick,
  reviewVideoOf,
  type PickableVideos,
  type ThumbReviewView,
} from '../lib/thumbReview';
import { follow, type Work } from './useComments';
import { useOnScreen, useReattach } from './useReattach';

const REVIEW_KINDS: readonly string[] = ['thumbnail-review'];

export interface ThumbnailReview {
  readonly videos: PickableVideos | null;
  readonly picked: string | null;
  readonly choose: (videoId: string) => void;
  /** The picked video's kept review; null when it has none. */
  readonly view: ThumbReviewView | null;
  readonly problem: string | null;
  readonly work: Work;
  /** Why this review goes to another AI than the one chosen; null when it does not. */
  readonly note: string | null;
  readonly ask: () => void;
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** The thumbnail review of one picked video on the map on screen. */
export function useThumbnailReview(
  channelId: string | null,
  choice: EngineChoice,
  engines: EngineReport | null,
): ThumbnailReview {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [videos, setVideos] = useState<PickableVideos | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<ThumbReviewView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [work, setWork] = useState<Work>({ status: 'idle' });
  const [turn, setTurn] = useState(0);
  const plan = choiceFor('thumbnails', choice, engines);
  // The video of a review found running when the view opened, so the list loading after it keeps it.
  const attachedVideo = useRef<string | null>(null);

  // A "Review this thumbnail" link elsewhere names the video in the address.
  useEffect(() => {
    const follow = (): void => {
      const wanted = reviewVideoOf(window.location.hash);
      if (wanted !== null) setPicked(wanted);
    };
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  useEffect(() => {
    setPicked(null);
    if (channelId === null) return;
    api
      .thumbnailVideos(channelId)
      .then((found) => {
        setVideos(found);
        setPicked(reviewVideoOf(window.location.hash) ?? attachedVideo.current ?? firstPick(found));
      })
      .catch((error: unknown) => setProblem(messageOf(error, 'The videos could not be loaded')));
  }, [api, channelId]);

  useEffect(() => {
    if (channelId === null || picked === null) {
      setView(null);
      return;
    }
    const isNewest = requests.begin();
    api
      .thumbnailReview(channelId, picked)
      .then((found) => {
        if (!isNewest()) return;
        setView(found);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (isNewest()) setProblem(messageOf(error, 'The review could not be loaded'));
      });
  }, [api, requests, channelId, picked, turn]);

  const onScreen = useOnScreen();
  /** Follows a review, started here or before the owner went elsewhere, to its end. */
  const track = useCallback(
    (start: () => Promise<string>) => {
      const stillHere = () => onScreen.current;
      setWork({ status: 'running', text: 'Starting' });
      start()
        .then((id) => follow(api, id, (text) => setWork({ status: 'running', text }), stillHere))
        .then((job) => {
          if (!stillHere()) return;
          setWork(
            job.status === 'done' && job.result?.kind === 'thumbnail-review'
              ? { status: 'done', text: 'Reviewed.' }
              : { status: 'failed', text: job.error ?? 'It did not finish' },
          );
        })
        .catch((error: unknown) =>
          setWork({ status: 'failed', text: messageOf(error, 'It could not start') }),
        )
        .finally(() => setTurn((value) => value + 1));
    },
    [api, onScreen],
  );

  const ask = useCallback(() => {
    if (channelId === null || picked === null) return;
    track(() => api.askThumbnailReview(channelId, picked, plan.choice));
  }, [api, channelId, picked, plan.choice, track]);

  useReattach(REVIEW_KINDS, channelId, (job) => {
    attachedVideo.current = job.videoId;
    if (job.videoId !== null) setPicked(job.videoId);
    track(() => Promise.resolve(job.id));
  });

  return { videos, picked, choose: setPicked, view, problem, work, note: plan.note, ask };
}
