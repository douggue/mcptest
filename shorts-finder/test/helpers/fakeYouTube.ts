/**
 * A stand-in for YouTube behind the official API reader: a made-up world of
 * search results, videos and channels, answered in the shape the API
 * documents. Tests change the world between cycles (a video gains views, a
 * video is deleted) and can make chosen requests fail.
 */
import { openDatabase, type Db } from '../../src/db/sqlite';
import {
  DEFAULT_PLAN,
  createQuotaLedger,
  type QuotaLedger,
  type QuotaPlan,
} from '../../src/quota/ledger';
import { SqliteQuotaRepo } from '../../src/repos/sqliteQuotaRepo';
import { openStore } from '../../src/repos/store';
import type { Store } from '../../src/repos/types';
import { createYouTubeApi, type YouTubeApi } from '../../src/youtube/api';
import {
  PLAYLIST_NOT_FOUND,
  channelId,
  channelItem,
  channelsReply,
  playlistReply,
  searchItem,
  videoId,
  videoItem,
  videosReply,
} from '../fixtures/apiReplies';
import { HOUR_MS, NOW, at } from '../fixtures/facts';

/** Shaped like a key and plainly not one. */
const KEY = 'test-key-not-a-real-one';

export interface Call {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
}

interface Refusal {
  readonly when: (call: Call) => boolean;
  readonly status: number;
  readonly body: unknown;
}

export interface VideoOptions {
  readonly publishedAt?: Date;
  /** An ISO-8601 length such as "PT42S"; null for a video with no length yet. */
  readonly duration?: string | null;
  /** Null for a hidden view count. */
  readonly views?: number | null;
}

export const refusalBody = (reason: string): unknown => ({
  error: { code: 403, message: reason, errors: [{ reason }] },
});

export class FakeYouTube {
  readonly calls: Call[] = [];
  private readonly searches = new Map<string, readonly unknown[]>();
  private readonly videos = new Map<string, unknown>();
  private readonly channels = new Map<string, unknown>();
  private readonly playlists = new Map<string, readonly number[]>();
  private readonly feeds = new Map<string, string | number>();
  private refusals: readonly Refusal[] = [];

  /** What a search for `keyword` in `region` returns: raw search results. */
  setSearch(keyword: string, region: string, items: readonly unknown[]): void {
    this.searches.set(`${keyword}|${region}`, items);
  }

  /** Puts a video in the world, or replaces it; returns its id. */
  setVideo(n: number, letter: string, options: VideoOptions = {}): string {
    const base = videoItem(n, letter);
    this.videos.set(videoId(n), {
      ...base,
      snippet: {
        ...base.snippet,
        publishedAt: (options.publishedAt ?? at(-2 * HOUR_MS)).toISOString(),
      },
      contentDetails: options.duration === null ? {} : { duration: options.duration ?? 'PT42S' },
      statistics: options.views === null ? {} : { viewCount: String(options.views ?? 1000) },
    });
    return videoId(n);
  }

  /** Puts a raw entry where a video would be: for replies that cannot be read. */
  setRawVideo(n: number, entry: unknown): void {
    this.videos.set(videoId(n), entry);
  }

  removeVideo(n: number): void {
    this.videos.delete(videoId(n));
  }

  setChannel(letter: string, overrides: Record<string, unknown> = {}): void {
    const item = channelItem(letter, overrides);
    this.channels.set(item.id, item);
  }

  /** What a list holds, newest first, as video numbers. A list never set is not found. */
  setPlaylist(playlistId: string, numbers: readonly number[]): void {
    this.playlists.set(playlistId, numbers);
  }

  /**
   * What the public Shorts feed of channel `letter` answers: a document, or a
   * status to refuse with. A feed never set is not found.
   */
  setFeed(letter: string, answer: string | number): void {
    this.feeds.set(channelId(letter), answer);
  }

  /** Makes every matching request fail from now on, until `heal` is called. */
  refuse(when: (call: Call) => boolean, status: number, body: unknown = {}): void {
    this.refusals = [...this.refusals, { when, status, body }];
  }

  heal(): void {
    this.refusals = [];
  }

  callsTo(path: string): readonly Call[] {
    return this.calls.filter((call) => call.path === path);
  }

  readonly fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    if (url.hostname === 'www.youtube.com') return this.feed(url);
    const call: Call = {
      path: url.pathname.split('/').at(-1) ?? '',
      params: Object.fromEntries(url.searchParams),
    };
    this.calls.push(call);
    const refusal = this.refusals.find((entry) => entry.when(call));
    if (refusal !== undefined) {
      return new Response(JSON.stringify(refusal.body), { status: refusal.status });
    }
    if (call.path === 'playlistItems' && !this.playlists.has(call.params['playlistId'] ?? '')) {
      return new Response(JSON.stringify(PLAYLIST_NOT_FOUND), { status: 404 });
    }
    return new Response(JSON.stringify(this.answer(call)));
  }) as typeof fetch;

  /** The public feed of a channel's Shorts-only list; not part of the API, so not in `calls`. */
  readonly feedCalls: string[] = [];

  private feed(url: URL): Response {
    const list = url.searchParams.get('playlist_id') ?? '';
    const id = `UC${list.slice('UUSH'.length)}`;
    this.feedCalls.push(id);
    const answer = this.feeds.get(id) ?? 404;
    return typeof answer === 'number'
      ? new Response('', { status: answer })
      : new Response(answer, { headers: { 'content-type': 'text/xml; charset=UTF-8' } });
  }

  private answer(call: Call): unknown {
    const ids = (call.params['id'] ?? '').split(',');
    const present = <T>(from: Map<string, T>): T[] =>
      ids.flatMap((id) => (from.has(id) ? [from.get(id) as T] : []));
    if (call.path === 'search') {
      const key = `${call.params['q']}|${call.params['regionCode']}`;
      return { items: this.searches.get(key) ?? [] };
    }
    if (call.path === 'videos') return videosReply(present(this.videos));
    if (call.path === 'playlistItems') {
      return playlistReply(this.playlists.get(call.params['playlistId'] ?? '') ?? []);
    }
    return channelsReply(present(this.channels));
  }
}

/** A search result for video `n` of channel `letter`. */
export const hit = (n: number, letter: string): unknown =>
  searchItem(n, letter, `A made-up title ${n}`);

export interface Bench {
  readonly db: Db;
  readonly store: Store;
  readonly ledger: QuotaLedger;
  readonly quota: SqliteQuotaRepo;
  readonly youtube: FakeYouTube;
  readonly api: YouTubeApi;
  /** The moment the cycles take for "now"; tests move it. */
  clock: Date;
  readonly now: () => Date;
}

/** An empty store in memory, a ledger over it, and the reader pointed at a fake YouTube. */
export function openBench(plan: QuotaPlan = DEFAULT_PLAN): Bench {
  const db = openDatabase(':memory:');
  const quota = new SqliteQuotaRepo(db);
  const youtube = new FakeYouTube();
  const bench: Bench = {
    db,
    store: openStore(db),
    quota,
    youtube,
    clock: NOW,
    now: () => bench.clock,
    ledger: createQuotaLedger({ repo: quota, plan, now: () => bench.clock }),
    api: createYouTubeApi({
      apiKey: KEY,
      spend: (kind, units) => bench.ledger.spend(kind, units),
      fetch: youtube.fetch,
    }),
  };
  return bench;
}
