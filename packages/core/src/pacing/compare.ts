import type { ChannelHistory } from '../changes/changes';
import {
  DEFAULT_BREAKOUT_WINDOW_DAYS,
  DEFAULT_MIN_BREAKOUT_SCORE,
  MAX_BREAKOUTS_PER_CHANNEL,
} from '../map/breakouts';
import { buildVideoReport } from '../report';
import type { StoredVideo } from '../repos/types';
import { SHORTS_MAX_SECONDS } from '../script/voice';
import type { VideoTranscript } from '../sources/types';
import { transcriptPace } from '../video/transcriptText';
import { spreadOf, type Spread } from './spread';

/**
 * A channel's own video lengths and speaking pace beside those of the
 * look-alikes' breakouts on its map: medians and middle halves, each with
 * the number of videos it rests on. A comparison only; nothing here advises.
 */

/**
 * The look-alikes' breakouts as the page's breakout list takes them: videos
 * of the last 30 days at 2× their channel's usual views or more, at most 4
 * from one channel (its strongest), so no one channel sets the figures.
 */
export function winnerVideos(
  lookalikes: readonly ChannelHistory[],
  now: Date,
): readonly StoredVideo[] {
  return lookalikes.flatMap(({ videos }) => {
    const byId = new Map(videos.map((video) => [video.id, video]));
    return buildVideoReport(videos, now)
      .filter(
        (row) =>
          row.score !== null &&
          row.score >= DEFAULT_MIN_BREAKOUT_SCORE &&
          row.ageDays <= DEFAULT_BREAKOUT_WINDOW_DAYS,
      )
      .slice(0, MAX_BREAKOUTS_PER_CHANNEL)
      .flatMap((row) => byId.get(row.id) ?? []);
  });
}

export interface PacingInput {
  readonly own: readonly StoredVideo[];
  readonly winners: readonly StoredVideo[];
  /** A video's stored captions; null when none are stored. */
  readonly transcriptOf: (videoId: string) => VideoTranscript | null;
}

export interface PacingComparison {
  /** Lengths in seconds, Shorts left out. */
  readonly lengths: { readonly own: Spread; readonly winners: Spread };
  /** Videos left out of the lengths for being Shorts (a minute or less). */
  readonly shortsLeftOut: { readonly own: number; readonly winners: number };
  /** Words a minute of the videos whose captions are stored and give a pace. */
  readonly wordsPerMinute: { readonly own: Spread; readonly winners: Spread };
}

const isShort = (video: StoredVideo): boolean =>
  video.durationSeconds !== null && video.durationSeconds <= SHORTS_MAX_SECONDS;

const lengthsOf = (videos: readonly StoredVideo[]): readonly number[] =>
  videos.flatMap((video) =>
    video.durationSeconds === null || isShort(video) ? [] : [video.durationSeconds],
  );

function paceOf(videos: readonly StoredVideo[], input: PacingInput): readonly number[] {
  return videos.flatMap((video) => {
    const transcript = isShort(video) ? null : input.transcriptOf(video.id);
    const pace = transcript ? transcriptPace(transcript.segments).wordsPerMinute : null;
    return pace === null ? [] : [pace];
  });
}

export function comparePacing(input: PacingInput): PacingComparison {
  const { own, winners } = input;
  return {
    lengths: { own: spreadOf(lengthsOf(own)), winners: spreadOf(lengthsOf(winners)) },
    shortsLeftOut: { own: own.filter(isShort).length, winners: winners.filter(isShort).length },
    wordsPerMinute: {
      own: spreadOf(paceOf(own, input)),
      winners: spreadOf(paceOf(winners, input)),
    },
  };
}
