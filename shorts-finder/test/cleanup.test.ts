import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { openStore } from '../src/repos/store';
import type { Store } from '../src/repos/types';
import { createSubject } from '../src/subjects/subject';
import { RETENTION_DAYS, runDailyCleanup } from '../src/track/cleanup';
import { channelId, videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';
import { newFinding } from './fixtures/findings';

let db: Db;
let store: Store;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = openStore(db);
});

afterEach(() => {
  db.close();
});

const LONG_AGO = at(-(RETENTION_DAYS + 1) * DAY_MS);
const LATELY = at(-(RETENTION_DAYS - 1) * DAY_MS);

/** A stored video of a channel, tracked, whose tracking ended at the given moment (or goes on). */
function video(n: number, letter: string, finishedAt: Date | null): string {
  store.channels.upsert(channelFacts(letter), at(-40 * DAY_MS));
  store.videos.upsert(videoFacts(n, letter, { publishedAt: at(-2 * DAY_MS) }), at(-40 * DAY_MS));
  store.tracking.start(videoId(n), 'yes', at(HOUR_MS));
  if (finishedAt !== null) store.tracking.finish(videoId(n), 'faded', finishedAt);
  return videoId(n);
}

describe('the retention clean-up', () => {
  test('deletes a video whose tracking ended more than 30 days ago, with everything kept of it', () => {
    const subject = store.subjects.add(createSubject({ keyword: 'paper folding', region: 'US' }));
    const old = video(1, 'A', LONG_AGO);
    store.readings.add({ videoId: old, capturedAt: LONG_AGO, views: 10 });
    store.growth.complete(
      old,
      { views1h: 5, views6h: 9, views24h: null, views72h: null, views7d: null },
      LONG_AGO,
    );
    store.hits.add({
      subjectId: subject.id,
      videoId: old,
      kind: 'newest',
      rank: 1,
      ageHours: 2,
      firstSeenAt: LONG_AGO,
    });

    const report = runDailyCleanup(store, NOW);

    expect(report).toEqual({
      agedOut: 0,
      videosDeleted: 1,
      channelsDeleted: 1,
      passedOverForgotten: 0,
    });
    expect(store.videos.get(old)).toBeNull();
    expect(store.tracking.get(old)).toBeNull();
    expect(store.growth.get(old)).toBeNull();
    expect(store.readings.list(old, new Date(0), NOW)).toEqual([]);
    expect(store.hits.videoIdsFor(subject.id)).toEqual([]);
    expect(RETENTION_DAYS).toBe(30);
  });

  test('keeps a video whose tracking ended within 30 days, and one still tracked however old', () => {
    const recent = video(1, 'A', LATELY);
    const tracked = video(2, 'B', null);

    const report = runDailyCleanup(store, NOW);

    expect(report).toMatchObject({ videosDeleted: 0, channelsDeleted: 0 });
    expect(store.videos.get(recent)).not.toBeNull();
    expect(store.videos.get(tracked)).not.toBeNull();
  });

  test('never deletes a video a finding is about, nor its channel; the finding outlives both anyway', () => {
    const found = video(1, 'A', LONG_AGO);
    const other = video(2, 'B', LONG_AGO);
    store.findings.add(newFinding(1, 'A'));
    store.findings.add({ ...newFinding(2, 'B'), videoId: videoId(9) });

    const report = runDailyCleanup(store, NOW);

    expect(report).toMatchObject({ videosDeleted: 1, channelsDeleted: 1 });
    expect(store.videos.get(found)).not.toBeNull();
    expect(store.channels.get(channelId('A'))).not.toBeNull();
    expect(store.videos.get(other)).toBeNull();
    expect(store.findings.countWaiting()).toBe(2);
  });

  test('keeps a channel that still has a video, and one that is followed though it has none', () => {
    video(1, 'A', LONG_AGO);
    const kept = video(2, 'A', LATELY);
    video(3, 'B', LONG_AGO);
    store.follows.setFollowed(channelId('B'), true, NOW);

    const report = runDailyCleanup(store, NOW);

    expect(report).toMatchObject({ videosDeleted: 2, channelsDeleted: 0 });
    expect(store.videos.get(kept)).not.toBeNull();
    expect(store.channels.get(channelId('A'))).not.toBeNull();
    expect(store.channels.get(channelId('B'))?.followed).toBe(true);
  });

  test('deletes a video that was stored but never tracked, once it has not been read for 30 days', () => {
    store.channels.upsert(channelFacts('A'), LONG_AGO);
    store.videos.upsert(videoFacts(1, 'A'), LONG_AGO);
    store.videos.upsert(videoFacts(2, 'A'), LATELY);

    const report = runDailyCleanup(store, NOW);

    expect(report.videosDeleted).toBe(1);
    expect(store.videos.get(videoId(2))).not.toBeNull();
  });

  test('forgets the videos passed over more than 30 days ago, so the list does not grow for ever', () => {
    store.passedOver.add(videoId(1), 'too_long', LONG_AGO);
    store.passedOver.add(videoId(2), 'too_old', LATELY);

    const report = runDailyCleanup(store, NOW);

    expect(report.passedOverForgotten).toBe(1);
    expect(store.passedOver.knownIds([videoId(1), videoId(2)])).toEqual([videoId(2)]);
  });

  test('does nothing the second time', () => {
    video(1, 'A', LONG_AGO);
    runDailyCleanup(store, NOW);

    expect(runDailyCleanup(store, NOW)).toEqual({
      agedOut: 0,
      videosDeleted: 0,
      channelsDeleted: 0,
      passedOverForgotten: 0,
    });
  });
});
