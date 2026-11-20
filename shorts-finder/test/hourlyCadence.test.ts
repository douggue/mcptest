import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readQueuedChannels } from '../src/discover/channelReads';
import { SqliteLeaseRepo } from '../src/repos/sqliteLeaseRepo';
import { SCHEDULER_TICK_MS, startScheduler, type Scheduler } from '../src/schedule/scheduler';
import { runReadCycle } from '../src/track/readCycle';
import { DUE_LOOK_AHEAD_MS } from '../src/track/tiers';
import { videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';
import { openBench, type Bench } from './helpers/fakeYouTube';

/** What the clock moves by every time anything looks at it, as a real one does. */
const DRIFT_MS = 3;
const HOURS = 6;
const LOOKS_PER_HOUR = HOUR_MS / SCHEDULER_TICK_MS;

let bench: Bench;
let scheduler: Scheduler | null;

beforeEach(() => {
  bench = openBench();
  scheduler = null;
});

afterEach(async () => {
  await scheduler?.stop();
  bench.db.close();
});

describe('the hourly tier under a clock that never stands still', () => {
  test('reads an hourly video in every hourly round, with the real read cycle under the scheduler', async () => {
    // Three videos in unrelated subjects, all young enough to stay hourly throughout.
    const ids = [1, 2, 3].map((n) => {
      const letter = 'ABC'.charAt(n - 1);
      bench.store.channels.upsert(channelFacts(letter), NOW);
      bench.store.videos.upsert(videoFacts(n, letter, { publishedAt: at(-HOUR_MS) }), NOW);
      bench.store.tracking.start(videoId(n), 'yes', NOW);
      bench.youtube.setVideo(n, letter, { publishedAt: at(-HOUR_MS), views: 100 * n });
      return videoId(n);
    });
    let clock = NOW.getTime();
    const now = (): Date => new Date((clock += DRIFT_MS));
    const deps = { ...bench, now };
    let look: () => void = () => undefined;
    scheduler = startScheduler({
      lease: { leases: new SqliteLeaseRepo(bench.db), now },
      now,
      readCycle: (signal) => runReadCycle(deps, signal),
      channelReads: (signal) => readQueuedChannels(deps, signal),
      searchCycle: async () => ({ stopped: null }),
      searchIsDue: () => false,
      dailyRollup: () => null,
      record: () => undefined,
      every: (run) => {
        look = run;
        return 'timer';
      },
      stop: () => undefined,
    });
    await scheduler.whenIdle();

    for (let n = 0; n < HOURS * LOOKS_PER_HOUR; n += 1) {
      clock += SCHEDULER_TICK_MS;
      look();
      await scheduler.whenIdle();
    }

    for (const id of ids) {
      const readings = bench.store.readings.list(id, new Date(0), at(DAY_MS));
      // One at the start and one in each hour after it: none skipped.
      expect(readings).toHaveLength(HOURS + 1);
      const gaps = readings.slice(1).map((reading, index) => {
        const before = readings[index];
        return reading.capturedAt.getTime() - (before?.capturedAt.getTime() ?? 0);
      });
      expect(Math.max(...gaps)).toBeLessThan(HOUR_MS + DUE_LOOK_AHEAD_MS);
      expect(Math.min(...gaps)).toBeGreaterThan(HOUR_MS - DUE_LOOK_AHEAD_MS);
    }
    expect(bench.youtube.callsTo('videos')).toHaveLength(HOURS + 1);
  });
});
