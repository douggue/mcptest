import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SHUTDOWN } from '../src/cycleStop';
import { planFor } from '../src/quota/ledger';
import {
  MISSED_READS_BEFORE_GONE,
  MISS_MIN_GAP_MS,
  READ_BATCH_SIZE,
  SUSPECT_EMPTY_BATCH_ABOVE,
  batchBudget,
  runReadCycle,
} from '../src/track/readCycle';
import { runDailyCleanup } from '../src/track/cleanup';
import { DUE_LOOK_AHEAD_MS } from '../src/track/tiers';
import { createYouTubeApi } from '../src/youtube/api';
import { shortByLength } from '../src/youtube/shorts';
import { videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';
import { openBench, refusalBody, type Bench, type VideoOptions } from './helpers/fakeYouTube';

const DAY = '2026-11-20';
/** 23:00 in Los Angeles on that day. */
const LAST_HOUR = new Date('2026-11-21T07:00:00Z');

let bench: Bench;

beforeEach(() => {
  bench = openBench();
});

afterEach(() => {
  bench.db.close();
});

const run = (signal?: AbortSignal) => runReadCycle(bench, signal);

/** A video in the store and in the world, tracked and due now. */
function track(n: number, letter: string, options: VideoOptions = {}): string {
  const publishedAt = options.publishedAt ?? at(-2 * HOUR_MS);
  bench.store.channels.upsert(channelFacts(letter), at(-HOUR_MS));
  bench.store.videos.upsert(videoFacts(n, letter, { publishedAt, views: 100 }), at(-HOUR_MS));
  bench.store.tracking.start(videoId(n), 'yes', NOW);
  bench.youtube.setVideo(n, letter, { ...options, publishedAt });
  return videoId(n);
}

/** The reader over a network that answers every request with the same body. */
const emptyApi = (body: unknown) =>
  createYouTubeApi({
    apiKey: 'test-key-not-a-real-one',
    spend: (kind, units) => bench.ledger.spend(kind, units),
    fetch: (async () => new Response(JSON.stringify(body))) as typeof fetch,
  });

const readingsOf = (id: string) =>
  bench.store.readings.list(id, new Date(0), at(30 * DAY_MS)).map((reading) => reading.views);

describe('shortByLength', () => {
  test.each([
    [1, 'yes'],
    [180, 'yes'],
    [181, 'no'],
    [null, 'unknown'],
  ] as const)('answers for a length of %s seconds with %s', (seconds, answer) => {
    expect(shortByLength(seconds)).toBe(answer);
  });
});

describe('a read cycle', () => {
  test('writes a reading for each due video and sets its next read an hour on', async () => {
    const first = track(1, 'A', { views: 2500 });
    const second = track(2, 'B', { views: 40 });

    const report = await run();

    expect(report).toEqual({
      due: 2,
      deferred: 0,
      read: 2,
      readings: 2,
      missing: 0,
      finished: 0,
      gone: 0,
      skipped: 0,
      unreadablePages: 0,
      suspectReplies: 0,
      leftUnread: 0,
      stopped: null,
    });
    expect(readingsOf(first)).toEqual([2500]);
    expect(readingsOf(second)).toEqual([40]);
    expect(bench.store.videos.get(first)).toMatchObject({ views: 2500, fetchedAt: NOW });
    expect(bench.store.tracking.get(first)).toMatchObject({
      tier: 'hourly',
      nextReadAt: at(HOUR_MS),
    });
  });

  test('builds a history, one reading a cycle', async () => {
    const id = track(1, 'A', { views: 100 });
    await run();
    bench.clock = at(HOUR_MS);
    bench.youtube.setVideo(1, 'A', { views: 900 });

    await run();

    expect(readingsOf(id)).toEqual([100, 900]);
    expect(bench.store.tracking.get(id)?.nextReadAt).toEqual(at(2 * HOUR_MS));
  });

  test('reads nothing that is not due yet, and makes no request for nothing', async () => {
    const id = track(1, 'A');
    bench.store.tracking.move(id, 'hourly', at(DUE_LOOK_AHEAD_MS + MINUTE_MS));

    const report = await run();

    expect(report).toMatchObject({ due: 0, read: 0, leftUnread: 0 });
    expect(bench.youtube.calls).toEqual([]);
  });

  test('reads a video that falls due within the next five minutes, not an hour late', async () => {
    const id = track(1, 'A', { views: 70 });
    bench.store.tracking.move(id, 'hourly', at(DUE_LOOK_AHEAD_MS));

    const report = await run();

    expect(report).toMatchObject({ due: 1, read: 1 });
    expect(readingsOf(id)).toEqual([70]);
    expect(DUE_LOOK_AHEAD_MS).toBe(5 * MINUTE_MS);
  });

  test('stamps each reading with the time of its own reply and counts next reads from the round start', async () => {
    const ids = Array.from({ length: 60 }, (_, n) => track(n, 'A', { views: 5 }));
    // The clock moves a minute with every look at it, as a slow round would.
    let looks = 0;
    const now = (): Date => at(looks++ * MINUTE_MS);

    await runReadCycle({ ...bench, now });

    const taken = (id: string) =>
      bench.store.readings.list(id, new Date(0), at(DAY_MS)).map((reading) => reading.capturedAt);
    expect(taken(ids[0]!)).toEqual([at(MINUTE_MS)]);
    expect(taken(ids[59]!)).toEqual([at(2 * MINUTE_MS)]);
    // Whichever tier each lands on, its next read is counted from the round's start, not its reply.
    expect(bench.store.tracking.get(ids[0]!)?.nextReadAt).toEqual(at(HOUR_MS));
    expect(bench.store.tracking.get(ids[59]!)?.nextReadAt).toEqual(at(6 * HOUR_MS));
  });

  test('asks for fifty videos a request, one unit of the reading share each', async () => {
    Array.from({ length: 120 }, (_, n) => track(n, 'A'));

    const report = await run();

    const sizes = bench.youtube
      .callsTo('videos')
      .map((call) => call.params['id']?.split(',').length);
    expect(sizes).toEqual([50, 50, 20]);
    expect(READ_BATCH_SIZE).toBe(50);
    expect(report).toMatchObject({ due: 120, read: 120, readings: 120 });
    expect(bench.quota.usage(DAY).byKind.reading).toBe(3);
  });

  test('moves a video past 72 hours to a read every six hours', async () => {
    const id = track(1, 'A', { publishedAt: at(-80 * HOUR_MS) });

    await run();

    expect(bench.store.tracking.get(id)).toMatchObject({
      tier: 'six_hourly',
      nextReadAt: at(6 * HOUR_MS),
    });
  });

  test('takes a last reading of a video 14 days old and stops tracking it', async () => {
    const id = track(1, 'A', { publishedAt: at(-14 * DAY_MS), views: 777 });

    const report = await run();

    expect(report).toMatchObject({ read: 1, readings: 1, finished: 1 });
    expect(bench.store.tracking.get(id)).toMatchObject({
      tier: 'done',
      nextReadAt: null,
      finishReason: 'aged_out',
    });
    expect(bench.store.videos.get(id)?.views).toBe(777);
    expect((await run()).due).toBe(0);
  });

  test('writes no reading for a hidden view count, and still reads the video again', async () => {
    const id = track(1, 'A', { views: null });

    const report = await run();

    expect(report).toMatchObject({ read: 1, readings: 0 });
    expect(readingsOf(id)).toEqual([]);
    expect(bench.store.tracking.get(id)?.nextReadAt).toEqual(at(HOUR_MS));
  });

  test('learns the length of a video that had none: a Short carries on, a long one stops', async () => {
    const short = track(1, 'A', { duration: 'PT55S' });
    const long = track(2, 'B', { duration: 'PT2H' });
    const still = track(3, 'C', { duration: null });
    [short, long, still].forEach((id) => bench.store.tracking.classify(id, 'unknown'));

    const report = await run();

    expect(report.finished).toBe(1);
    expect(bench.store.tracking.get(short)).toMatchObject({ isShort: 'yes', tier: 'hourly' });
    expect(bench.store.tracking.get(long)).toMatchObject({ isShort: 'no', tier: 'done' });
    expect(bench.store.tracking.get(still)).toMatchObject({ isShort: 'unknown', tier: 'hourly' });
  });
});

describe('a read cycle and a video the API no longer returns', () => {
  test('keeps tracking it after one miss', async () => {
    const id = track(1, 'A');
    bench.store.readings.add({ videoId: id, capturedAt: at(-HOUR_MS), views: 100 });
    bench.youtube.removeVideo(1);

    const report = await run();

    expect(report).toMatchObject({ read: 0, missing: 1, gone: 0 });
    expect(bench.store.tracking.get(id)).toMatchObject({
      tier: 'hourly',
      missedReads: 1,
      nextReadAt: at(HOUR_MS),
    });
    expect(readingsOf(id)).toEqual([100]);
  });

  test('does not count a second miss an hour after the first: one outage is one occasion', async () => {
    const id = track(1, 'A');
    bench.youtube.removeVideo(1);
    await run();
    bench.clock = at(HOUR_MS);

    const report = await run();

    expect(report).toMatchObject({ missing: 1, gone: 0, finished: 0 });
    expect(bench.store.tracking.get(id)).toMatchObject({ tier: 'hourly', missedReads: 1 });
  });

  test('ends tracking as gone after a second miss six hours on, and deletes nothing', async () => {
    const id = track(1, 'A');
    bench.store.readings.add({ videoId: id, capturedAt: at(-HOUR_MS), views: 100 });
    bench.youtube.removeVideo(1);
    await run();
    bench.clock = at(MISS_MIN_GAP_MS);

    const report = await run();

    expect(MISSED_READS_BEFORE_GONE).toBe(2);
    expect(MISS_MIN_GAP_MS).toBe(6 * HOUR_MS);
    expect(report).toMatchObject({ missing: 1, gone: 1, finished: 1 });
    expect(bench.store.videos.get(id)).not.toBeNull();
    expect(bench.store.tracking.get(id)).toMatchObject({
      tier: 'done',
      nextReadAt: null,
      finishReason: 'gone',
      finishedAt: at(MISS_MIN_GAP_MS),
    });
    expect(readingsOf(id)).toEqual([100]);
  });

  test('starts counting again when it comes back between two misses', async () => {
    const id = track(1, 'A');
    bench.youtube.removeVideo(1);
    await run();
    bench.clock = at(HOUR_MS);
    bench.youtube.setVideo(1, 'A', { views: 300 });
    await run();
    bench.clock = at(8 * HOUR_MS);
    bench.youtube.removeVideo(1);

    const report = await run();

    expect(report).toMatchObject({ missing: 1, gone: 0 });
    expect(bench.store.tracking.get(id)?.missedReads).toBe(1);
  });

  test('simply stops tracking a missing video that has reached 14 days', async () => {
    const id = track(1, 'A', { publishedAt: at(-15 * DAY_MS) });
    bench.youtube.removeVideo(1);

    const report = await run();

    expect(report).toMatchObject({ missing: 1, finished: 1, gone: 0 });
    expect(bench.store.videos.get(id)).not.toBeNull();
    expect(bench.store.tracking.get(id)?.finishReason).toBe('aged_out');
  });

  test.each([
    ['an empty object', {}],
    ['an empty list of items', { items: [] }],
  ])('counts no miss when a request for many videos is answered with %s', async (_what, body) => {
    const ids = Array.from({ length: SUSPECT_EMPTY_BATCH_ABOVE + 1 }, (_, n) => track(n, 'A'));

    const first = await runReadCycle({ ...bench, api: emptyApi(body) });
    bench.clock = at(MISS_MIN_GAP_MS);
    const second = await runReadCycle({ ...bench, api: emptyApi(body) });

    expect(first).toMatchObject({ read: 0, missing: 0, gone: 0, suspectReplies: 1, leftUnread: 0 });
    expect(second).toMatchObject({ missing: 0, gone: 0, suspectReplies: 1 });
    for (const id of ids) {
      expect(bench.store.videos.get(id)).not.toBeNull();
      expect(bench.store.tracking.get(id)).toMatchObject({ tier: 'hourly', missedReads: 0 });
    }
  });

  test('believes a few videos all missing: a small request answered with none counts misses', async () => {
    const ids = Array.from({ length: SUSPECT_EMPTY_BATCH_ABOVE }, (_, n) => track(n, 'A'));
    ids.forEach((_, n) => bench.youtube.removeVideo(n));

    const report = await run();

    expect(report).toMatchObject({ missing: SUSPECT_EMPTY_BATCH_ABOVE, suspectReplies: 0 });
    expect(SUSPECT_EMPTY_BATCH_ABOVE).toBe(5);
  });

  test('does not count a miss when the reply held an entry that could not be read', async () => {
    const odd = track(1, 'A');
    const old = track(2, 'B', { publishedAt: at(-15 * DAY_MS) });
    const fine = track(3, 'C', { views: 60 });
    bench.youtube.setRawVideo(1, { id: videoId(1), snippet: { title: 42 } });
    bench.youtube.setRawVideo(2, { id: videoId(2) });

    const report = await run();

    expect(report).toMatchObject({ read: 1, missing: 0, skipped: 2, unreadablePages: 0 });
    expect(bench.store.tracking.get(odd)).toMatchObject({
      missedReads: 0,
      nextReadAt: at(HOUR_MS),
    });
    expect(bench.store.tracking.get(old)?.tier).toBe('done');
    expect(readingsOf(fine)).toEqual([60]);
  });

  test('says when a whole reply could not be read', async () => {
    track(1, 'A');
    bench.youtube.setRawVideo(1, { id: 'not an id' });

    const report = await run();

    expect(report).toMatchObject({ read: 0, missing: 0, skipped: 1, unreadablePages: 1 });
  });
});

describe('a read cycle that cannot finish', () => {
  test('stops cleanly when the reading share is spent, keeping the batches already read', async () => {
    bench.db.close();
    bench = openBench(planFor(10));
    // An hour before Pacific midnight, so the whole of what is left may be spent now.
    bench.clock = LAST_HOUR;
    const ids = Array.from({ length: 120 }, (_, n) => track(n, 'A', { views: 5 }));
    // Another program spends what is left after this round has made its plan.
    let asked = 0;
    const api = {
      fetchVideos: async (videoIds: readonly string[]) => {
        asked += 1;
        const left = bench.ledger.remaining(bench.clock).byKind.reading;
        if (asked === 2) bench.ledger.spend('reading', left);
        return bench.api.fetchVideos(videoIds);
      },
    };

    const report = await runReadCycle({ ...bench, api });

    // The round planned three requests and the share paid for one.
    expect(report).toMatchObject({ due: 120, read: 50, leftUnread: 70, stopped: 'allowance' });
    expect(readingsOf(ids[0]!)).toEqual([5]);
    expect(bench.store.tracking.listDue(bench.clock)).toHaveLength(70);
  });

  test('calls the day spent when Google itself says so, and stops', async () => {
    track(1, 'A');
    bench.youtube.refuse(() => true, 403, refusalBody('quotaExceeded'));

    const report = await run();

    expect(report).toMatchObject({ read: 0, leftUnread: 1, stopped: 'allowance' });
    expect(bench.ledger.remaining(NOW).byKind.reading).toBe(0);
    expect(bench.store.tracking.listDue(NOW)).toHaveLength(1);
  });

  test('stops for a pause when Google says requests come too fast', async () => {
    track(1, 'A');
    bench.youtube.refuse(() => true, 403, refusalBody('rateLimitExceeded'));

    const report = await run();

    expect(report).toMatchObject({ leftUnread: 1, stopped: 'rate_limit' });
    expect(bench.ledger.remaining(NOW).byKind.reading).toBeGreaterThan(0);
  });

  test('stops between requests when the lease was lost', async () => {
    Array.from({ length: 60 }, (_, n) => track(n, 'A'));
    const lost = new AbortController();
    const api = {
      fetchVideos: async (ids: readonly string[]) => {
        lost.abort();
        return bench.api.fetchVideos(ids);
      },
    };

    const report = await runReadCycle({ ...bench, api }, lost.signal);

    expect(report).toMatchObject({ read: 50, leftUnread: 10, stopped: 'lease_lost' });
  });

  test('stops between requests, saying so, when the service is stopping', async () => {
    Array.from({ length: 60 }, (_, n) => track(n, 'A'));
    const halt = new AbortController();
    const api = {
      fetchVideos: async (ids: readonly string[]) => {
        halt.abort(SHUTDOWN);
        return bench.api.fetchVideos(ids);
      },
    };

    const report = await runReadCycle({ ...bench, api }, halt.signal);

    expect(report).toMatchObject({ read: 50, leftUnread: 10, stopped: 'shutdown' });
  });

  test('throws any other failure, after storing the requests before it', async () => {
    const ids = Array.from({ length: 60 }, (_, n) => track(n, 'A', { views: 9 }));
    bench.youtube.refuse((call) => (call.params['id'] ?? '').split(',').length === 10, 500);

    await expect(run()).rejects.toThrow(/refused the request \(500\)/);

    expect(readingsOf(ids[0]!)).toEqual([9]);
    expect(bench.store.tracking.listDue(NOW)).toHaveLength(10);
  });
});

describe('batchBudget', () => {
  test.each([
    ['at noon with the whole share left', 2000, NOW, 166],
    ['at Pacific midnight, a whole day ahead', 2000, new Date('2026-11-20T08:00:00Z'), 83],
    ['in the last hour, when all that is left may go', 37, LAST_HOUR, 37],
    ['half an hour before midnight', 37, new Date('2026-11-21T07:30:00Z'), 37],
    ['with too little left for a request an hour', 5, NOW, 1],
    ['with nothing left', 0, NOW, 1],
  ])('allows %s', (_what, unitsLeft, now, batches) => {
    expect(batchBudget(unitsLeft, now)).toBe(batches);
  });
});

describe('a read cycle and the place of a video in its group', () => {
  const tierOf = (id: string) => bench.store.tracking.get(id)?.tier;

  test('keeps the upper half of a group hourly and moves the slower half to six-hourly', async () => {
    const ids = [100, 200, 300, 400].map((views, index) =>
      track(index + 1, 'ABCD'.charAt(index), { views }),
    );

    await run();

    expect(ids.map(tierOf)).toEqual(['six_hourly', 'six_hourly', 'hourly', 'hourly']);
    expect(bench.store.tracking.get(ids[0]!)).toMatchObject({
      lowStreak: 1,
      rate: 50,
      nextReadAt: at(6 * HOUR_MS),
    });
    expect(bench.store.tracking.get(ids[3]!)).toMatchObject({ lowStreak: 0, rate: 200 });
  });

  test('places each video by this round’s rates, so a group that slows together stays level', async () => {
    const ids = [1, 2, 3, 4].map((n) => track(n, 'ABCD'.charAt(n - 1), { views: 1000 }));
    await run();
    bench.clock = at(HOUR_MS);
    // Every one gains the same little in the hour: all slower than before, none slower than the rest.
    [1, 2, 3, 4].forEach((n) => bench.youtube.setVideo(n, 'ABCD'.charAt(n - 1), { views: 1010 }));

    await run();

    expect(ids.map(tierOf)).toEqual(['hourly', 'hourly', 'hourly', 'hourly']);
    expect(ids.map((id) => bench.store.tracking.get(id)?.lowStreak)).toEqual([0, 0, 0, 0]);
  });

  test('ends the tracking of a video found in the slower half three readings running, not speeding up', async () => {
    const slow = track(1, 'A', { views: 100 });
    const others = [track(2, 'B', { views: 5000 }), track(3, 'C', { views: 9000 })];
    const rounds = [0, 6, 12];
    for (const hours of rounds) {
      bench.clock = at(hours * HOUR_MS);
      bench.youtube.setVideo(1, 'A', { views: 100 + hours * 10 });
      bench.youtube.setVideo(2, 'B', { views: 5000 + hours * 900 });
      bench.youtube.setVideo(3, 'C', { views: 9000 + hours * 2000 });
      await run();
    }

    expect(bench.store.tracking.get(slow)).toMatchObject({
      tier: 'done',
      finishReason: 'faded',
      finishedAt: at(12 * HOUR_MS),
    });
    expect(others.map(tierOf)).toEqual(['hourly', 'hourly']);
    // Its growth is summed up and its raw readings are gone.
    expect(readingsOf(slow)).toEqual([]);
    expect(bench.store.growth.get(slow)).toMatchObject({
      views6h: 140,
      completedAt: at(12 * HOUR_MS),
    });
  });

  test('keeps a video in the slower half that is speeding up', async () => {
    const waking = track(1, 'A', { views: 100 });
    track(2, 'B', { views: 5000 });
    track(3, 'C', { views: 9000 });
    const views = [100, 110, 400];
    for (const [round, hours] of [0, 6, 12].entries()) {
      bench.clock = at(hours * HOUR_MS);
      bench.youtube.setVideo(1, 'A', { views: views[round] ?? 0 });
      bench.youtube.setVideo(2, 'B', { views: 5000 + hours * 900 });
      bench.youtube.setVideo(3, 'C', { views: 9000 + hours * 2000 });
      await run();
    }

    expect(bench.store.tracking.get(waking)).toMatchObject({ tier: 'six_hourly', lowStreak: 3 });
  });

  test('reads a video from a channel large for its group only at about 24 and 72 hours', async () => {
    const sizes = [100, 200, 300, 5_000_000];
    const ids = sizes.map((subscribers, index) => {
      const letter = 'ABCD'.charAt(index);
      const id = track(index + 1, letter, { views: 1000 });
      bench.store.channels.upsert(channelFacts(letter, { subscribers }), NOW);
      return id;
    });

    await run();
    bench.clock = at(22 * HOUR_MS);
    bench.youtube.setVideo(4, 'D', { views: 8000 });
    const second = await run();
    bench.clock = at(70 * HOUR_MS);
    const third = await run();

    // Published two hours before the first round: 24 hours old at 22 hours, 72 at 70.
    expect(
      bench.youtube.callsTo('videos').filter((call) => call.params['id']?.includes(ids[3]!)),
    ).toHaveLength(3);
    expect(second.read).toBeGreaterThan(0);
    expect(third.finished).toBeGreaterThan(0);
    expect(bench.store.tracking.get(ids[3]!)).toMatchObject({
      tier: 'done',
      finishReason: 'baseline_done',
    });
    expect(bench.store.growth.get(ids[3]!)?.views24h).toBe(8000);
  });

  test('sets the first baseline reading for when the video is 24 hours old', async () => {
    const sizes = [100, 200, 300, 5_000_000];
    const ids = sizes.map((subscribers, index) => {
      const letter = 'ABCD'.charAt(index);
      const id = track(index + 1, letter, { views: 1000 });
      bench.store.channels.upsert(channelFacts(letter, { subscribers }), NOW);
      return id;
    });

    await run();

    expect(bench.store.tracking.get(ids[3]!)).toMatchObject({
      tier: 'baseline',
      nextReadAt: at(22 * HOUR_MS),
    });
    expect(ids.slice(0, 3).map(tierOf)).not.toContain('baseline');
  });
});

describe('a read cycle and its budget', () => {
  test('reads the most promising first as far as the hour’s budget goes, and puts off the rest', async () => {
    bench.db.close();
    bench = openBench(planFor(100));
    const ids = Array.from({ length: 120 }, (_, n) => track(n, 'A', { views: 100 }));
    // What each was gaining when last read: the higher its number, the faster.
    ids.forEach((id, n) => bench.store.tracking.setRate(id, n, at(-HOUR_MS)));

    const report = await run();

    // A hundred units a day leave twenty for readings; at noon that is one request an hour.
    expect(report).toMatchObject({
      due: 120,
      deferred: 70,
      read: 50,
      leftUnread: 0,
      stopped: null,
    });
    const asked = bench.youtube.callsTo('videos')[0]?.params['id']?.split(',') ?? [];
    expect(asked.toSorted()).toEqual(ids.slice(70).toSorted());
    expect(asked[0]).toBe(ids[119]);
  });

  test('does not drop what it put off: it is still due, and is read once the faster ones are not', async () => {
    bench.db.close();
    bench = openBench(planFor(100));
    const ids = Array.from({ length: 60 }, (_, n) => track(n, 'A', { views: 100 }));
    ids.forEach((id, n) => bench.store.tracking.setRate(id, n, at(-HOUR_MS)));

    const first = await run();
    bench.clock = at(10 * 60_000);
    const second = await run();

    expect(first).toMatchObject({ due: 60, deferred: 10, read: 50 });
    expect(second).toMatchObject({ due: 10, deferred: 0, read: 10 });
    expect(readingsOf(ids[0]!)).toHaveLength(1);
  });

  test('spends what the searches left unspent on readings late in the Pacific day', async () => {
    bench.db.close();
    bench = openBench(planFor(100));
    bench.clock = LAST_HOUR;
    bench.ledger.spend('reading', 20);
    Array.from({ length: 120 }, (_, n) => track(n, 'A', { views: 100 }));

    const report = await run();

    expect(report).toMatchObject({ due: 120, deferred: 0, read: 120, stopped: null });
    expect(bench.quota.usage('2026-11-20').byKind).toMatchObject({ reading: 23, search: 0 });
  });
});

describe('what a reading keeps', () => {
  test('stores the likes and the comments beside the views, on the video and on the reading', async () => {
    const id = track(1, 'A', { views: 2500 });

    await run();

    expect(bench.store.videos.get(id)).toMatchObject({ views: 2500, likes: 9120, comments: 311 });
    expect(bench.store.readings.list(id, new Date(0), at(DAY_MS))).toEqual([
      { videoId: id, capturedAt: NOW, views: 2500, likes: 9120, comments: 311 },
    ]);
  });

  test('fills a growth figure once readings stand on both sides of its mark, and only then', async () => {
    const id = track(1, 'A', { publishedAt: at(-30 * MINUTE_MS), views: 200 });
    await run();
    const before = bench.store.growth.get(id);
    bench.clock = at(HOUR_MS);
    bench.youtube.setVideo(1, 'A', { publishedAt: at(-30 * MINUTE_MS), views: 600 });

    await run();

    expect(before).toEqual({
      views1h: null,
      views6h: null,
      views24h: null,
      views72h: null,
      views7d: null,
      completedAt: null,
    });
    // Half an hour old at the first reading, an hour and a half at the second.
    expect(bench.store.growth.get(id)).toMatchObject({ views1h: 400, views6h: null });
  });

  test('gives the videos a failed round had read their next read all the same', async () => {
    const ids = Array.from({ length: 60 }, (_, n) => track(n, 'A', { views: 9 }));
    bench.youtube.refuse((call) => (call.params['id'] ?? '').split(',').length === 10, 500);

    await expect(run()).rejects.toThrow(/refused the request \(500\)/);

    const moved = ids.filter(
      (id) => bench.store.tracking.get(id)?.nextReadAt?.getTime() !== NOW.getTime(),
    );
    expect(moved).toHaveLength(50);
  });
});

describe('the daily clean-up', () => {
  test('ends the tracking of a video past 14 days that was always put off, summing up its growth', () => {
    const old = track(1, 'A', { publishedAt: at(-15 * DAY_MS) });
    const young = track(2, 'B');
    bench.store.readings.add({
      videoId: old,
      capturedAt: at(-15 * DAY_MS + HOUR_MS / 2),
      views: 10,
    });
    bench.store.readings.add({
      videoId: old,
      capturedAt: at(-15 * DAY_MS + 2 * HOUR_MS),
      views: 310,
    });

    const report = runDailyCleanup(bench.store, NOW);
    const again = runDailyCleanup(bench.store, NOW);

    expect(report).toMatchObject({ agedOut: 1 });
    expect(again).toMatchObject({ agedOut: 0 });
    expect(bench.store.tracking.get(old)).toMatchObject({
      tier: 'done',
      finishReason: 'aged_out',
      finishedAt: NOW,
    });
    expect(bench.store.growth.get(old)).toMatchObject({ views1h: 110, completedAt: NOW });
    expect(readingsOf(old)).toEqual([]);
    expect(bench.store.tracking.get(young)?.tier).toBe('hourly');
  });
});
