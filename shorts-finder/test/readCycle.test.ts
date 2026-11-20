import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { planFor } from '../src/quota/ledger';
import { MISSED_READS_BEFORE_DROP, READ_BATCH_SIZE, runReadCycle } from '../src/track/readCycle';
import { rollUpOldReadings } from '../src/track/rollup';
import { HOURLY_UNTIL_MS, TRACKED_UNTIL_MS, planNextRead } from '../src/track/tiers';
import { shortByLength } from '../src/youtube/shorts';
import { videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';
import { openBench, refusalBody, type Bench, type VideoOptions } from './helpers/fakeYouTube';

const DAY = '2026-11-20';

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

const readingsOf = (id: string) =>
  bench.store.readings.list(id, new Date(0), at(30 * DAY_MS)).map((reading) => reading.views);

describe('planNextRead', () => {
  test.each([
    ['just published', 0, 'hourly', HOUR_MS],
    ['a moment short of 72 hours old', HOURLY_UNTIL_MS - 1, 'hourly', HOUR_MS],
    ['exactly 72 hours old', HOURLY_UNTIL_MS, 'six_hourly', 6 * HOUR_MS],
    ['a moment short of 14 days old', TRACKED_UNTIL_MS - 1, 'six_hourly', 6 * HOUR_MS],
  ])('reads a video %s again on its tier', (_what, age, tier, wait) => {
    expect(planNextRead(at(-age), NOW)).toEqual({ tier, nextReadAt: at(wait) });
  });

  test('stops reading a video once it is 14 days old', () => {
    expect(planNextRead(at(-TRACKED_UNTIL_MS), NOW)).toEqual({ tier: 'done', nextReadAt: null });
    expect(HOURLY_UNTIL_MS).toBe(72 * HOUR_MS);
    expect(TRACKED_UNTIL_MS).toBe(14 * DAY_MS);
  });
});

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
      read: 2,
      readings: 2,
      missing: 0,
      finished: 0,
      removed: 0,
      skipped: 0,
      unreadablePages: 0,
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
    bench.store.tracking.move(id, 'hourly', at(MINUTE_MS));

    const report = await run();

    expect(report).toMatchObject({ due: 0, read: 0, leftUnread: 0 });
    expect(bench.youtube.calls).toEqual([]);
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

  test('takes a last reading of a video 14 days old and stops tracking it, keeping its readings', async () => {
    const id = track(1, 'A', { publishedAt: at(-14 * DAY_MS), views: 777 });

    const report = await run();

    expect(report).toMatchObject({ read: 1, readings: 1, finished: 1 });
    expect(bench.store.tracking.get(id)).toMatchObject({ tier: 'done', nextReadAt: null });
    expect(readingsOf(id)).toEqual([777]);
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

    expect(report).toMatchObject({ read: 0, missing: 1, removed: 0 });
    expect(bench.store.tracking.get(id)).toMatchObject({
      tier: 'hourly',
      missedReads: 1,
      nextReadAt: at(HOUR_MS),
    });
    expect(readingsOf(id)).toEqual([100]);
  });

  test('deletes it, readings and all, after the second miss in a row', async () => {
    const id = track(1, 'A');
    bench.store.readings.add({ videoId: id, capturedAt: at(-HOUR_MS), views: 100 });
    bench.youtube.removeVideo(1);
    await run();
    bench.clock = at(HOUR_MS);

    const report = await run();

    expect(MISSED_READS_BEFORE_DROP).toBe(2);
    expect(report).toMatchObject({ missing: 1, removed: 1 });
    expect(bench.store.videos.get(id)).toBeNull();
    expect(bench.store.tracking.get(id)).toBeNull();
    expect(readingsOf(id)).toEqual([]);
  });

  test('starts counting again when it comes back between two misses', async () => {
    const id = track(1, 'A');
    bench.youtube.removeVideo(1);
    await run();
    bench.clock = at(HOUR_MS);
    bench.youtube.setVideo(1, 'A', { views: 300 });
    await run();
    bench.clock = at(2 * HOUR_MS);
    bench.youtube.removeVideo(1);

    const report = await run();

    expect(report).toMatchObject({ missing: 1, removed: 0 });
    expect(bench.store.tracking.get(id)?.missedReads).toBe(1);
  });

  test('simply stops tracking a missing video that has reached 14 days', async () => {
    const id = track(1, 'A', { publishedAt: at(-15 * DAY_MS) });
    bench.youtube.removeVideo(1);

    const report = await run();

    expect(report).toMatchObject({ missing: 1, finished: 1, removed: 0 });
    expect(bench.store.videos.get(id)).not.toBeNull();
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
    const ids = Array.from({ length: 120 }, (_, n) => track(n, 'A', { views: 5 }));

    const report = await run();

    // Ten units a day leave two for readings: two requests of fifty.
    expect(report).toMatchObject({ due: 120, read: 100, leftUnread: 20, stopped: 'allowance' });
    expect(readingsOf(ids[0]!)).toEqual([5]);
    expect(bench.store.tracking.listDue(NOW)).toHaveLength(20);
    expect(bench.youtube.callsTo('videos')).toHaveLength(2);
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

  test('throws any other failure, after storing the requests before it', async () => {
    const ids = Array.from({ length: 60 }, (_, n) => track(n, 'A', { views: 9 }));
    bench.youtube.refuse((call) => (call.params['id'] ?? '').split(',').length === 10, 500);

    await expect(run()).rejects.toThrow(/refused the request \(500\)/);

    expect(readingsOf(ids[0]!)).toEqual([9]);
    expect(bench.store.tracking.listDue(NOW)).toHaveLength(10);
  });
});

describe('rollUpOldReadings', () => {
  test('thins readings older than 14 days to the last of each day and says how many went', () => {
    bench.store.channels.upsert(channelFacts('A'), NOW);
    bench.store.videos.upsert(videoFacts(1, 'A'), NOW);
    const id = videoId(1);
    [0, 1, 2].forEach((hour) =>
      bench.store.readings.add({
        videoId: id,
        capturedAt: new Date(`2026-11-03T0${hour}:00:00Z`),
        views: hour,
      }),
    );
    bench.store.readings.add({ videoId: id, capturedAt: at(-13 * DAY_MS), views: 50 });
    bench.store.readings.add({ videoId: id, capturedAt: at(-13 * DAY_MS + HOUR_MS), views: 51 });

    const report = rollUpOldReadings(bench.store.readings, NOW);

    expect(report).toEqual({ cutoff: at(-14 * DAY_MS), removed: 2 });
    expect(readingsOf(id)).toEqual([2, 50, 51]);
    expect(rollUpOldReadings(bench.store.readings, NOW).removed).toBe(0);
  });
});
