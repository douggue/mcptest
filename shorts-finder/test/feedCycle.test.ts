import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SHUTDOWN } from '../src/cycleStop';
import { detailChannelFinds } from '../src/discover/channelFinds';
import {
  CONFIRM_MAX_CHANNELS,
  FEEDS_PAUSED_UNTIL,
  FEED_BACKOFF_BASE_MS,
  FEED_BACKOFF_MAX_MS,
  FEED_CONCURRENCY,
  FEED_JITTER_MS,
  FEED_POLL_EVERY_MS,
  FEED_REFUSED_PAUSE_MS,
  FEED_STOP_AFTER_FAILURES,
  confirmCandidates,
  feedBackoffMs,
  runFeedCycle,
  type FeedCycleDeps,
} from '../src/discover/feedCycle';
import { createSubject } from '../src/subjects/subject';
import { parseFeed, type FeedResult, type FeedValidators } from '../src/youtube/feed';
import { channelId, videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';
import { feedEntry, feedXml } from './fixtures/feeds';
import { openBench, type Bench } from './helpers/fakeYouTube';

const NO_VALIDATORS: FeedValidators = { etag: null, lastModified: null };

let bench: Bench;
/** What each channel's Shorts feed answers; a channel not here is "not found". */
let feeds: Map<string, FeedResult | (() => FeedResult)>;
let asked: Array<{ channelId: string; validators: FeedValidators | null }>;
let waits: number[];

beforeEach(() => {
  bench = openBench();
  feeds = new Map();
  asked = [];
  waits = [];
});

afterEach(() => {
  bench.db.close();
});

/** A feed that answered with these entries. */
function ok(letter: string, entries: readonly string[], validators = NO_VALIDATORS): FeedResult {
  const feed = parseFeed(feedXml(letter, entries));
  if (feed === null) throw new Error('the fixture is not a feed');
  return { kind: 'ok', ...feed, validators };
}

const FAILED: FeedResult = { kind: 'failed', message: 'YouTube refused the feed (429)' };

function deps(overrides: Partial<FeedCycleDeps> = {}): FeedCycleDeps {
  return {
    store: bench.store,
    now: bench.now,
    readFeed: async (id, validators) => {
      asked.push({ channelId: id, validators });
      const answer = feeds.get(id) ?? { kind: 'not_found' };
      return typeof answer === 'function' ? answer() : answer;
    },
    detail: (ids, signal) =>
      detailChannelFinds(bench, ids, { kind: 'channel_feed', confirmed: true }, signal),
    sleep: async (ms) => {
      waits.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  };
}

const run = (signal?: AbortSignal) => runFeedCycle(deps(), signal);

/** A channel with its facts read, followed since now. */
function follow(letter: string): string {
  bench.store.channels.upsert(channelFacts(letter), NOW);
  bench.store.follows.setFollowed(channelId(letter), true, NOW);
  return channelId(letter);
}

/** A stored, tracked video of a channel, last seen by the API with these views. */
function tracked(n: number, letter: string, views = 100): string {
  bench.store.videos.upsert(videoFacts(n, letter, { views }), NOW);
  bench.store.tracking.start(videoId(n), 'yes', at(HOUR_MS));
  return videoId(n);
}

const readingsOf = (id: string) => bench.store.readings.list(id, new Date(0), at(30 * DAY_MS));

describe('a round of feeds', () => {
  test('does nothing, and says so with null, when no channel is followed', async () => {
    bench.store.channels.upsert(channelFacts('A'), NOW);

    expect(await run()).toBeNull();
    expect(asked).toEqual([]);
  });

  test('stores a new Short the feed lists as a confirmed Short, tracked, found by the channel’s feed', async () => {
    follow('A');
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A')]));
    bench.youtube.setVideo(1, 'A', { views: 640, publishedAt: at(-3 * HOUR_MS) });

    const report = await run();

    expect(report).toMatchObject({
      channels: 1,
      answered: 1,
      failed: 0,
      refused: false,
      finds: { newVideos: 1 },
      stopped: null,
    });
    expect(bench.store.tracking.get(videoId(1))).toMatchObject({
      isShort: 'confirmed',
      tier: 'hourly',
    });
    expect(bench.store.hits.listForVideo(videoId(1))).toEqual([
      {
        subjectId: null,
        videoId: videoId(1),
        kind: 'channel_feed',
        rank: null,
        ageHours: 3,
        firstSeenAt: NOW,
      },
    ]);
    expect(readingsOf(videoId(1)).map((reading) => reading.views)).toEqual([640]);
    expect(bench.store.channels.get(channelId('A'))).toMatchObject({
      lastTrackedUploadAt: NOW,
      uploadsReadAt: NOW,
    });
  });

  test('pays only for the details, from the channel share, one request for the new ids of every feed', async () => {
    ['A', 'B', 'C'].forEach((letter, index) => {
      follow(letter);
      feeds.set(channelId(letter), ok(letter, [feedEntry(index + 1, letter)]));
      bench.youtube.setVideo(index + 1, letter);
    });

    await run();

    expect(bench.youtube.callsTo('videos')).toHaveLength(1);
    expect(bench.quota.usage('2026-11-20').byKind).toEqual({
      search: 0,
      reading: 0,
      channel: 1,
      reserve: 0,
    });
  });

  test('files a feed find under the subject whose search first led to the channel', async () => {
    const subject = bench.store.subjects.add(createSubject({ keyword: 'night sky', region: 'CA' }));
    follow('A');
    const known = tracked(7, 'A');
    bench.store.hits.add({
      subjectId: subject.id,
      videoId: known,
      kind: 'newest',
      rank: 4,
      ageHours: 1,
      firstSeenAt: at(-DAY_MS),
    });
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A')]));
    bench.youtube.setVideo(1, 'A');

    await run();

    expect(bench.store.hits.listForVideo(videoId(1))[0]).toMatchObject({
      subjectId: subject.id,
      kind: 'channel_feed',
    });
  });

  test('keeps the feed’s view count as a reading marked "feed" for a video already tracked', async () => {
    follow('A');
    const id = tracked(1, 'A', 100);
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A', { views: 180 })]));

    const report = await run();

    expect(report).toMatchObject({ readings: 1, finds: { newVideos: 0 } });
    expect(readingsOf(id)).toEqual([{ videoId: id, capturedAt: NOW, views: 180, source: 'feed' }]);
    expect(bench.youtube.calls).toEqual([]);
  });

  test('does not keep a feed count below the last one the API gave: the feed is the older of the two', async () => {
    follow('A');
    const id = tracked(1, 'A', 500);
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A', { views: 480 }), feedEntry(2, 'A')]));
    tracked(2, 'A', 10);
    feeds.set(
      channelId('A'),
      ok('A', [feedEntry(1, 'A', { views: 480 }), feedEntry(2, 'A', { views: null })]),
    );

    const report = await run();

    expect(report?.readings).toBe(0);
    expect(readingsOf(id)).toEqual([]);
  });

  test('confirms as a Short a video a search had found, and leaves one no longer tracked alone', async () => {
    follow('A');
    const found = tracked(1, 'A');
    const unknown = tracked(2, 'A');
    bench.store.tracking.classify(unknown, 'unknown');
    const ended = tracked(3, 'A');
    bench.store.tracking.finish(ended, 'aged_out', NOW);
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A'), feedEntry(2, 'A'), feedEntry(3, 'A')]));

    const first = await run();
    bench.clock = at(FEED_POLL_EVERY_MS);
    const second = await run();

    expect(first?.confirmed).toBe(2);
    expect(second?.confirmed).toBe(0);
    expect(bench.store.tracking.get(found)?.isShort).toBe('confirmed');
    expect(bench.store.tracking.get(unknown)?.isShort).toBe('confirmed');
    expect(bench.store.tracking.get(ended)?.isShort).toBe('yes');
    expect(readingsOf(ended)).toEqual([]);
  });

  test('ignores an entry that names another channel, and does not read one too old to track', async () => {
    follow('A');
    feeds.set(
      channelId('A'),
      ok('A', [
        feedEntry(1, 'A', { channelLetter: 'B' }),
        feedEntry(2, 'A', { published: at(-15 * DAY_MS).toISOString() }),
      ]),
    );

    const report = await run();

    expect(report).toMatchObject({ answered: 1, finds: { newVideos: 0 } });
    expect(bench.youtube.calls).toEqual([]);
  });

  test('does not pay again for a listed video that turned out too long or was not returned', async () => {
    follow('A');
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A'), feedEntry(2, 'A')]));
    bench.youtube.setVideo(1, 'A', { duration: 'PT12M' });

    const first = await run();
    bench.clock = at(FEED_POLL_EVERY_MS);
    await run();

    expect(first?.finds).toMatchObject({ newVideos: 0, tooLong: 1, notReturned: 1 });
    expect(bench.youtube.callsTo('videos')).toHaveLength(1);
  });
});

describe('the pace of feed reads', () => {
  test('reads a channel’s feed at most every 30 minutes', async () => {
    follow('A');
    feeds.set(channelId('A'), ok('A', []));

    await run();
    bench.clock = at(FEED_POLL_EVERY_MS - MINUTE_MS);
    const early = await run();
    bench.clock = at(FEED_POLL_EVERY_MS);
    const onTime = await run();

    expect(early).toBeNull();
    expect(onTime?.channels).toBe(1);
    expect(asked).toHaveLength(2);
    expect(FEED_POLL_EVERY_MS).toBe(30 * MINUTE_MS);
  });

  test('fetches at most three feeds at once, each after a random wait', async () => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    letters.forEach((letter) => follow(letter));
    let open = 0;
    let most = 0;
    const readFeed: FeedCycleDeps['readFeed'] = async () => {
      open += 1;
      most = Math.max(most, open);
      await Promise.resolve();
      open -= 1;
      return { kind: 'ok', entries: [], skipped: 0, validators: NO_VALIDATORS };
    };

    const report = await runFeedCycle(deps({ readFeed }));

    expect(report?.channels).toBe(7);
    expect(most).toBe(FEED_CONCURRENCY);
    expect(FEED_CONCURRENCY).toBe(3);
    expect(waits).toEqual(letters.map(() => FEED_JITTER_MS / 2));
  });

  test('reads the least-recently-read feeds first', async () => {
    ['A', 'B', 'C'].forEach((letter) => follow(letter));
    bench.store.follows.noteFeedRead(channelId('A'), {
      at: at(-HOUR_MS),
      etag: null,
      modified: null,
    });
    bench.store.follows.noteFeedRead(channelId('B'), {
      at: at(-2 * HOUR_MS),
      etag: null,
      modified: null,
    });

    await run();

    expect(asked.map((entry) => entry.channelId)).toEqual([
      channelId('C'),
      channelId('B'),
      channelId('A'),
    ]);
  });

  test('sends back the validators a feed gave, and keeps them through a "not changed"', async () => {
    const id = follow('A');
    const validators = { etag: '"v1"', lastModified: 'Fri, 20 Nov 2026 19:00:00 GMT' };
    feeds.set(id, ok('A', [], validators));

    await run();
    feeds.set(id, { kind: 'not_modified' });
    bench.clock = at(FEED_POLL_EVERY_MS);
    const unchanged = await run();
    bench.clock = at(2 * FEED_POLL_EVERY_MS);
    await run();

    expect(unchanged).toMatchObject({ answered: 1, failed: 0 });
    expect(asked.map((entry) => entry.validators)).toEqual([null, validators, validators]);
  });
});

describe('feeds that do not answer', () => {
  test('leaves a failing feed alone for twice as long after each failure, up to a day', async () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 20].map((failures) => feedBackoffMs(failures) / MINUTE_MS),
    ).toEqual([30, 60, 120, 240, 480, 960, 1440, 1440]);
    expect(FEED_BACKOFF_BASE_MS).toBe(30 * MINUTE_MS);
    expect(FEED_BACKOFF_MAX_MS).toBe(DAY_MS);
  });

  test('backs off the one channel whose feed fails and carries on with the others', async () => {
    const [bad, good] = [follow('A'), follow('B')];
    feeds.set(bad, FAILED);
    feeds.set(good, ok('B', []));

    const first = await run();
    bench.clock = at(FEED_POLL_EVERY_MS);
    await run();
    bench.clock = at(2 * FEED_POLL_EVERY_MS);
    await run();
    bench.clock = at(3 * FEED_POLL_EVERY_MS);
    await run();

    expect(first).toMatchObject({
      channels: 2,
      answered: 1,
      failed: 1,
      refused: false,
      failure: 'YouTube refused the feed (429)',
    });
    const askedOf = (id: string) => asked.filter((entry) => entry.channelId === id).length;
    // The good feed every half hour; the bad one at 0, then after 30 minutes, then after an hour more.
    expect(askedOf(good)).toBe(4);
    expect(askedOf(bad)).toBe(3);
  });

  test('forgets a feed’s failures once it answers', async () => {
    const id = follow('A');
    feeds.set(id, FAILED);
    await run();
    bench.clock = at(FEED_POLL_EVERY_MS);
    feeds.set(id, ok('A', []));
    await run();
    feeds.set(id, FAILED);
    bench.clock = at(2 * FEED_POLL_EVERY_MS);
    await run();
    bench.clock = at(3 * FEED_POLL_EVERY_MS);

    await run();

    expect(asked).toHaveLength(4);
  });

  test('treats "not found" as that channel’s own matter: backed off, not a sign of refusal', async () => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    letters.forEach((letter) => follow(letter));

    const report = await run();

    expect(report).toMatchObject({ channels: 6, notFound: 6, failed: 0, refused: false });
    bench.clock = at(FEED_POLL_EVERY_MS - MINUTE_MS);
    expect(await run()).toBeNull();
  });

  test('ends the round after five failures in a row, and asks for no feed during an hour', async () => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    letters.forEach((letter) => {
      follow(letter);
      feeds.set(channelId(letter), FAILED);
    });

    const report = await run();
    bench.clock = at(FEED_REFUSED_PAUSE_MS - MINUTE_MS);
    const paused = await run();
    bench.clock = at(FEED_REFUSED_PAUSE_MS);
    const resumed = await run();

    // Feeds are fetched three at a time, so the fifth failure is seen after the sixth feed.
    expect(report).toMatchObject({ channels: 6, failed: 6, refused: true });
    expect(FEED_STOP_AFTER_FAILURES).toBe(5);
    expect(paused).toBeNull();
    expect(resumed?.channels).toBeGreaterThan(0);
    expect(bench.store.state.get(FEEDS_PAUSED_UNTIL)).not.toBeNull();
  });

  test('does not count failures that an answer came between', async () => {
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    letters.forEach((letter, index) => {
      follow(letter);
      feeds.set(channelId(letter), index % 3 === 2 ? ok(letter, []) : FAILED);
    });

    const report = await run();

    expect(report).toMatchObject({ channels: 9, failed: 6, answered: 3, refused: false });
  });

  test('does not wait out a pause that ends further off than a pause is long', async () => {
    follow('A');
    bench.store.state.set(FEEDS_PAUSED_UNTIL, at(DAY_MS).toISOString(), NOW);

    expect(await run()).not.toBeNull();
  });
});

describe('a round of feeds that is stopped', () => {
  test('records nothing of feeds cut short by the stop, and asks for no more', async () => {
    const letters = ['A', 'B', 'C', 'D', 'E'];
    letters.forEach((letter) => follow(letter));
    const halt = new AbortController();
    const readFeed: FeedCycleDeps['readFeed'] = async () => {
      halt.abort(SHUTDOWN);
      return { kind: 'failed', message: 'The feed could not be read: aborted' };
    };

    const report = await runFeedCycle(deps({ readFeed }), halt.signal);

    expect(report).toMatchObject({ channels: 0, failed: 0, stopped: 'shutdown' });
    expect(bench.store.follows.listFeedDue(NOW, NOW, 10)).toHaveLength(5);
  });

  test('does not start when it was stopped already', async () => {
    follow('A');
    const halt = new AbortController();
    halt.abort(SHUTDOWN);

    const report = await run(halt.signal);

    expect(report).toMatchObject({ channels: 0, stopped: 'shutdown' });
    expect(asked).toEqual([]);
  });

  test('says how the reading of details ended, and loses nothing: the ids are listed again next time', async () => {
    follow('A');
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A')]));
    bench.youtube.setVideo(1, 'A');
    bench.ledger.spend('channel', bench.ledger.remaining(NOW).byKind.channel);

    const short = await run();
    bench.clock = at(DAY_MS);
    const later = await run();

    expect(short).toMatchObject({ answered: 1, stopped: 'allowance', finds: { newVideos: 0 } });
    expect(later?.finds.newVideos).toBe(1);
  });
});

describe('reading the details of what followed channels list', () => {
  const source = { kind: 'channel_feed', confirmed: true } as const;

  test('reports a failed request in words, keeping the requests before it', async () => {
    bench.store.channels.upsert(channelFacts('A'), NOW);
    const ids = Array.from({ length: 60 }, (_, n) => {
      bench.youtube.setVideo(n, 'A');
      return videoId(n);
    });
    bench.youtube.refuse((call) => (call.params['id'] ?? '').split(',').length === 10, 500);

    const report = await detailChannelFinds(bench, ids, source);

    expect(report).toMatchObject({ newVideos: 50, stopped: null });
    expect(report.failure).toMatch(/refused the request \(500\)/);
  });

  test('stops between requests when told to', async () => {
    const halt = new AbortController();
    halt.abort(SHUTDOWN);

    const report = await detailChannelFinds(bench, [videoId(1)], source, halt.signal);

    expect(report).toMatchObject({ newVideos: 0, stopped: 'shutdown' });
    expect(bench.youtube.calls).toEqual([]);
  });

  test('writes nothing off when a reply holds an unreadable entry, or is empty for many ids', async () => {
    bench.youtube.setRawVideo(1, { id: videoId(1), snippet: { title: 42 } });
    const many = [2, 3, 4, 5, 6, 7].map(videoId);

    const odd = await detailChannelFinds(bench, [videoId(1), videoId(8)], source);
    const empty = await detailChannelFinds(bench, many, source);

    expect(odd).toMatchObject({ skipped: 1, notReturned: 0 });
    expect(empty).toMatchObject({ notReturned: 0 });
    expect(bench.store.passedOver.knownIds([videoId(8), ...many])).toEqual([]);
  });
});

describe('confirmCandidates', () => {
  test('marks as confirmed the stored videos their channels’ Shorts feeds list, and no others', async () => {
    bench.store.channels.upsert(channelFacts('A'), NOW);
    bench.store.channels.upsert(channelFacts('B'), NOW);
    const listed = tracked(1, 'A');
    const unlisted = tracked(2, 'A');
    const other = tracked(3, 'B');
    feeds.set(channelId('A'), ok('A', [feedEntry(1, 'A'), feedEntry(9, 'A')]));

    const report = await confirmCandidates(deps(), [
      channelId('A'),
      channelId('B'),
      channelId('A'),
    ]);

    expect(report).toEqual({ checked: 2, confirmed: 1, unanswered: 1, leftUnchecked: 0 });
    expect(bench.store.tracking.get(listed)?.isShort).toBe('confirmed');
    expect(bench.store.tracking.get(unlisted)?.isShort).toBe('yes');
    expect(bench.store.tracking.get(other)?.isShort).toBe('yes');
    expect(asked.map((entry) => entry.validators)).toEqual([null, null]);
    expect(bench.youtube.calls).toEqual([]);
  });

  test('looks at no more channels than its limit, and stops when told to', async () => {
    const many = Array.from(
      { length: CONFIRM_MAX_CHANNELS + 5 },
      (_, n) => `UC${String(n).padStart(22, 'k')}`,
    );
    const halt = new AbortController();
    halt.abort(SHUTDOWN);

    const bounded = await confirmCandidates(deps(), many);
    const stopped = await confirmCandidates(deps(), many, halt.signal);

    expect(bounded).toMatchObject({ checked: CONFIRM_MAX_CHANNELS, leftUnchecked: 5 });
    expect(CONFIRM_MAX_CHANNELS).toBe(20);
    expect(stopped.checked).toBe(0);
  });
});
