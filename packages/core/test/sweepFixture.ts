/** A small world for sweep tests: a store in memory and a counted stand-in for YouTube. */
import { openDatabase, transactionRunner } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteSweepRepo } from '../src/repos/sqliteSweepRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { FoundVideo } from '../src/sources/searchResults';
import type { ChannelSnapshot, SidebarItem, YouTubeSource } from '../src/sources/types';
import type { SweepDeps } from '../src/sweep/sweep';

export const NOW = new Date('2026-11-20T12:00:00Z');
export const cid = (letter: string) => `UC${letter.repeat(22)}`;
export const vid = (letter: string, n: number) => `${letter.repeat(10)}${n}`;

export function snapshot(letter: string): ChannelSnapshot {
  return {
    channel: {
      id: cid(letter),
      title: `Channel ${letter}`,
      handle: null,
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: 3,
    },
    videos: [0, 1, 2].map((n) => ({
      id: vid(letter, n),
      channelId: cid(letter),
      title: `Video ${n}`,
      views: 1000 * (n + 1),
      durationSeconds: 600,
      published: {
        date: new Date(NOW.getTime() - n * 86_400_000),
        precision: 'day',
        raw: `${n}d ago`,
      },
    })),
  };
}

export const hits = (letters: string): readonly FoundVideo[] =>
  [...letters].map((letter, n) => ({ videoId: vid(letter, n % 10), channelId: cid(letter) }));

export const beside = (letters: string): readonly SidebarItem[] =>
  [...letters].map((letter) => ({
    videoId: vid(letter, 0),
    title: `Beside ${letter}`,
    channelId: cid(letter),
    channelName: `Channel ${letter}`,
    channelHandle: null,
    views: 1000,
    published: null,
  }));

export interface WorldOptions {
  /** What each keyword's search finds, as channel letters. */
  readonly results: Readonly<Record<string, string>>;
  /** Channels that count as niches once they are in the store. */
  readonly qualifying?: string;
  /** What stands beside each video, by video id, as channel letters. */
  readonly sidebars?: Readonly<Record<string, string>>;
  /** A channel read that fails with this error. */
  readonly failing?: Readonly<Record<string, Error>>;
  readonly searchFailing?: Readonly<Record<string, Error>>;
}

export function world(options: WorldOptions) {
  const db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  const sweeps = new SqliteSweepRepo(db);
  const calls = { searches: [] as string[], channels: [] as string[], sidebars: [] as string[] };
  let clock = NOW;
  const source: YouTubeSource = {
    resolveChannelId: () => Promise.reject(new Error('unused')),
    fetchVideoPage: () => Promise.reject(new Error('unused')),
    getSidebar: (videoId) => {
      calls.sidebars.push(videoId);
      return Promise.resolve(beside(options.sidebars?.[videoId] ?? ''));
    },
    fetchChannel: (channelId) => {
      calls.channels.push(channelId);
      const letter = channelId.charAt(2);
      const failure = options.failing?.[letter];
      return failure ? Promise.reject(failure) : Promise.resolve(snapshot(letter));
    },
  };
  const deps: SweepDeps = {
    source,
    channels,
    videos: new SqliteVideoRepo(db),
    transact: transactionRunner(db),
    now: () => clock,
    sweeps,
    via: 'pages',
    search: (query) => {
      calls.searches.push(query);
      const failure = options.searchFailing?.[query];
      return failure
        ? Promise.reject(failure)
        : Promise.resolve(hits(options.results[query] ?? ''));
    },
    niches: () =>
      [...(options.qualifying ?? '')]
        .filter((letter) => channels.findById(cid(letter)) !== null)
        .map((letter) => ({ id: cid(letter), videoIds: [vid(letter, 0), vid(letter, 1)] })),
  };
  return {
    db,
    deps,
    sweeps,
    channels,
    calls,
    /** Page requests the stand-in was asked for, at what each read can take at most. */
    pagesAsked: () => calls.searches.length + calls.channels.length * 5 + calls.sidebars.length * 2,
    setNow: (at: Date) => {
      clock = at;
    },
  };
}
