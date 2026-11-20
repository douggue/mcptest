import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readQueuedChannels } from '../src/discover/channelReads';
import { runSearchCycle } from '../src/discover/searchCycle';
import { SqliteLeaseRepo } from '../src/repos/sqliteLeaseRepo';
import { startScheduler, type CycleRecord } from '../src/schedule/scheduler';
import { pickDueSubjects } from '../src/subjects/due';
import { expandAcrossRegions } from '../src/subjects/subject';
import { runReadCycle } from '../src/track/readCycle';
import { rollUpOldReadings } from '../src/track/rollup';
import { velocity } from '../src/track/velocity';
import { channelId, videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, NOW, at } from './fixtures/facts';
import { hit, openBench, type Bench } from './helpers/fakeYouTube';

let bench: Bench;

beforeEach(() => {
  bench = openBench();
});

afterEach(() => {
  bench.db.close();
});

/** The scheduler over the real cycles, with a timer the test fires by hand. */
function startOver(records: CycleRecord[]) {
  let fire: () => void = () => undefined;
  const scheduler = startScheduler({
    lease: { leases: new SqliteLeaseRepo(bench.db), now: bench.now },
    now: bench.now,
    readCycle: (signal) => runReadCycle(bench, signal),
    channelReads: (signal) => readQueuedChannels(bench, signal),
    searchCycle: (signal) => runSearchCycle(bench, signal),
    searchIsDue: (now) => {
      const left = bench.ledger.remaining(now).byKind.search;
      return pickDueSubjects(bench.store.subjects.list(), now, left).length > 0;
    },
    dailyRollup: (now) => rollUpOldReadings(bench.store.readings, now),
    record: (entry) => records.push(entry),
    every: (run) => {
      fire = run;
      return 'timer';
    },
    stop: () => undefined,
  });
  const hoursLater = async (hours: number): Promise<void> => {
    bench.clock = new Date(bench.clock.getTime() + hours * HOUR_MS);
    fire();
    await scheduler.whenIdle();
  };
  return { scheduler, hoursLater };
}

describe('the scheduler over the real cycles', () => {
  test('finds a video in two countries, reads it each hour and has a rate for it', async () => {
    expandAcrossRegions('bicycle repair', ['AU', 'GB'], { language: 'en' }).forEach((subject) =>
      bench.store.subjects.add(subject),
    );
    bench.youtube.setSearch('bicycle repair', 'AU', [hit(1, 'A')]);
    bench.youtube.setSearch('bicycle repair', 'GB', [hit(1, 'A'), hit(2, 'B')]);
    bench.youtube.setVideo(1, 'A', { views: 1000 });
    bench.youtube.setVideo(2, 'B', { views: 50, duration: 'PT10M' });
    bench.youtube.setChannel('A');
    const records: CycleRecord[] = [];

    const { scheduler, hoursLater } = startOver(records);
    await scheduler.whenIdle();
    for (const views of [1600, 2800, 5200]) {
      bench.youtube.setVideo(1, 'A', { views });
      await hoursLater(1);
    }
    await scheduler.stop();

    expect(records.every((entry) => entry.result === 'done')).toBe(true);
    expect(bench.youtube.callsTo('search')).toHaveLength(4);
    expect(bench.store.videos.get(videoId(2))).toBeNull();
    expect(bench.store.channels.get(channelId('A'))?.subscribers).toBe(890);
    const readings = bench.store.readings.list(videoId(1), at(-DAY_MS), at(DAY_MS));
    expect(readings.map((reading) => reading.views)).toEqual([1000, 1600, 2800, 5200]);
    expect(velocity(readings, bench.clock)).toMatchObject({
      viewsPerHour: 1400,
      measuredFrom: NOW,
      measuredTo: at(3 * HOUR_MS),
    });
    // Four searches (two countries, each most-viewed and newest), two reads of
    // details (the first found the Short, the third the long video), three
    // rounds of readings, one channel read.
    expect(bench.quota.usage('2026-11-20').byKind).toEqual({
      search: 402,
      reading: 3,
      channel: 1,
      reserve: 0,
    });
  });
});
