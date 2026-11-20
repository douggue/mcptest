import { buildVideoReport } from '../report';
import type { StoredVideo } from '../repos/types';
import { DEFAULT_MIN_BREAKOUT_SCORE } from './breakouts';
import { loadMapSnapshot, type SnapshotDeps } from './snapshot';

/** A video at or above this multiple of its channel's usual views worked. */
export const WINNER_MIN_SCORE = DEFAULT_MIN_BREAKOUT_SCORE;
/** A video at or below this multiple did what the channel usually does, or less. */
export const ORDINARY_MAX_SCORE = 1.2;
/** A younger video has not had the time to show that it is ordinary. */
export const ORDINARY_MIN_AGE_DAYS = 3;
export const DEFAULT_WINNERS_PER_CHANNEL = 6;
export const DEFAULT_ORDINARY_PER_CHANNEL = 6;
export const DEFAULT_OWN_VIDEOS = 6;

/** One video on the board. The thumbnail is found from `videoId`; no image is stored. */
export interface BoardVideo {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  /** Multiple of the channel's usual views at this age; null when it cannot be judged. */
  readonly score: number | null;
  /** The relative date as YouTube gave it, such as "2w ago". */
  readonly publishedRaw: string;
  readonly ageDays: number;
  readonly durationSeconds: number | null;
}

export interface ScoredBoardVideo extends BoardVideo {
  readonly score: number;
}

/** One channel like the centre: what worked for it beside what did not. */
export interface BoardChannel {
  readonly id: string;
  readonly title: string;
  readonly subscribers: number | null;
  /** Videos far above the channel's usual views, strongest first. */
  readonly winners: readonly ScoredBoardVideo[];
  /** Videos at or below the channel's usual views, newest first. */
  readonly ordinary: readonly ScoredBoardVideo[];
  /** Of all the channel's scored videos, how many are winners; the lists above show a few. */
  readonly winnerCount: number;
  readonly scoredCount: number;
}

export interface BoardCenter {
  readonly id: string;
  readonly title: string;
  readonly subscribers: number | null;
  /** The centre's own videos, newest first. */
  readonly videos: readonly BoardVideo[];
}

/**
 * The thumbnails that worked on the channels like the centre, beside the ones
 * that did not and the centre's own. Plain values, ready to serialise.
 */
export interface ThumbnailBoard {
  readonly mapId: number;
  readonly center: BoardCenter;
  readonly channels: readonly BoardChannel[];
  /** The scores the lists were cut at, so a reader can say what "worked" means. */
  readonly winnerMinScore: number;
  readonly ordinaryMaxScore: number;
}

/** A channel and its stored videos, as the board needs them. */
export interface BoardSource {
  readonly id: string;
  readonly title: string;
  readonly subscribers: number | null;
  readonly videos: readonly StoredVideo[];
}

export interface BoardInput {
  readonly mapId: number;
  readonly center: BoardSource;
  /** The channels like the centre, in the order they should be shown. */
  readonly peers: readonly BoardSource[];
}

export interface BoardOptions {
  readonly winnersPerChannel?: number;
  readonly ordinaryPerChannel?: number;
  readonly ownVideos?: number;
}

/** A channel's videos as board entries, strongest first and unscored last. */
function boardVideos(videos: readonly StoredVideo[], now: Date): readonly BoardVideo[] {
  const durations = new Map(videos.map((video) => [video.id, video.durationSeconds]));
  return buildVideoReport(videos, now).map((row) => ({
    videoId: row.id,
    title: row.title,
    views: row.views,
    score: row.score,
    publishedRaw: row.publishedRaw,
    ageDays: row.ageDays,
    durationSeconds: durations.get(row.id) ?? null,
  }));
}

const isScoredVideo = (video: BoardVideo): video is ScoredBoardVideo => video.score !== null;

const newestFirst = <T extends BoardVideo>(videos: readonly T[]): readonly T[] =>
  [...videos].sort((a, b) => a.ageDays - b.ageDays);

function boardChannel(source: BoardSource, now: Date, options: BoardOptions): BoardChannel {
  const scored = boardVideos(source.videos, now).filter(isScoredVideo);
  const winners = scored.filter((video) => video.score >= WINNER_MIN_SCORE);
  const ordinary = scored.filter(
    (video) => video.score <= ORDINARY_MAX_SCORE && video.ageDays >= ORDINARY_MIN_AGE_DAYS,
  );
  return {
    id: source.id,
    title: source.title,
    subscribers: source.subscribers,
    winners: winners.slice(0, options.winnersPerChannel ?? DEFAULT_WINNERS_PER_CHANNEL),
    ordinary: newestFirst(ordinary).slice(
      0,
      options.ordinaryPerChannel ?? DEFAULT_ORDINARY_PER_CHANNEL,
    ),
    winnerCount: winners.length,
    scoredCount: scored.length,
  };
}

/** Builds the board from channels and videos already in hand. */
export function buildThumbnailBoard(
  input: BoardInput,
  now: Date,
  options: BoardOptions = {},
): ThumbnailBoard {
  const { center } = input;
  return {
    mapId: input.mapId,
    center: {
      id: center.id,
      title: center.title,
      subscribers: center.subscribers,
      videos: newestFirst(boardVideos(center.videos, now)).slice(
        0,
        options.ownVideos ?? DEFAULT_OWN_VIDEOS,
      ),
    },
    channels: input.peers.map((peer) => boardChannel(peer, now, options)),
    winnerMinScore: WINNER_MIN_SCORE,
    ordinaryMaxScore: ORDINARY_MAX_SCORE,
  };
}

/**
 * The board for the latest map around a channel, or null when none has been made.
 *
 * Which channels count as like the centre comes from the map as the owner sees
 * it (frozen when it was made, less the channels they removed). The videos and
 * their scores are read from the store as it is now, so nothing here is frozen.
 */
export function loadThumbnailBoard(
  deps: SnapshotDeps,
  centerChannelId: string,
  now: Date,
  options: BoardOptions = {},
): ThumbnailBoard | null {
  const snapshot = loadMapSnapshot(deps, centerChannelId, now);
  if (!snapshot) return null;
  const withVideos = (channel: {
    readonly id: string;
    readonly title: string;
    readonly subscribers: number | null;
  }): BoardSource => ({
    id: channel.id,
    title: channel.title,
    subscribers: channel.subscribers,
    videos: deps.videos.listByChannel(channel.id),
  });
  return buildThumbnailBoard(
    {
      mapId: snapshot.mapId,
      center: withVideos(snapshot.center),
      peers: snapshot.channels
        .filter((channel) => channel.peer && !channel.removed)
        .map(withVideos),
    },
    now,
    options,
  );
}
