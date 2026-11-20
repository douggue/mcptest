import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { NO_REASON, reasonFromText, reasonToText } from '../src/findings/reason';
import { openStore } from '../src/repos/store';
import type { Store } from '../src/repos/types';
import { channelFacts, videoFacts } from './fixtures/facts';
import { HOUR_MS, MINUTE_MS, NOW, at } from './fixtures/facts';
import { newFinding, reasonFor } from './fixtures/findings';

let db: Db;
let store: Store;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = openStore(db);
});

afterEach(() => {
  db.close();
});

describe('the finding repository', () => {
  test('stores a finding and gives it back with its reason, not yet told of', () => {
    const added = store.findings.add(newFinding(1, 'A'));

    expect(added).toBe(true);
    expect(store.findings.listWaiting(10)).toEqual([
      { ...newFinding(1, 'A'), id: 1, alertedAt: null, digestedAt: null },
    ]);
  });

  test('keeps the first finding of a video and kind and ignores a second', () => {
    store.findings.add(newFinding(1, 'A'));

    const again = store.findings.add(newFinding(1, 'A', { viewsPerHour: 9 }));

    expect(again).toBe(false);
    expect(store.findings.listWaiting(10).map((finding) => finding.viewsPerHour)).toEqual([1000]);
  });

  test('stores the same video once as each kind', () => {
    store.findings.add(newFinding(1, 'A'));

    expect(store.findings.add(newFinding(1, 'A', { kind: 'transfer' }))).toBe(true);
    expect(store.findings.countWaiting()).toBe(2);
  });

  test('refuses a finding whose ids are not YouTube ids, naming the field', () => {
    const bad = newFinding(1, 'A', { videoId: '../../etc', channelId: 'not-a-channel' });

    expect(() => store.findings.add(bad)).toThrow(/videoId: must be a YouTube video id/);
    expect(() => store.findings.add(bad)).toThrow(/channelId/);
  });

  test('lists what is waiting oldest first, as many as asked for', () => {
    store.findings.add(newFinding(3, 'C'));
    store.findings.add(newFinding(1, 'A'));
    store.findings.add(newFinding(2, 'B'));

    const waiting = store.findings.listWaiting(2);

    expect(waiting.map((finding) => finding.channelTitle)).toEqual(['Channel A', 'Channel B']);
    expect(store.findings.listWaiting(-1)).toEqual([]);
  });

  test('takes an alerted finding off the waiting list, once', () => {
    store.findings.add(newFinding(1, 'A'));

    expect(store.findings.markAlerted(1, NOW)).toBe(true);
    expect(store.findings.markAlerted(1, at(HOUR_MS))).toBe(false);

    expect(store.findings.listWaiting(10)).toEqual([]);
    expect(store.findings.listFoundBetween(at(-24 * HOUR_MS), NOW)[0]?.alertedAt).toEqual(NOW);
  });

  test('takes findings a summary told of off the waiting list without counting them as alerts', () => {
    store.findings.add(newFinding(1, 'A'));
    store.findings.add(newFinding(2, 'B'));

    store.findings.markDigested([1, 2], NOW);

    expect(store.findings.countWaiting()).toBe(0);
    expect(store.findings.countAlertedBetween(at(-HOUR_MS), at(HOUR_MS))).toBe(0);
    expect(store.findings.listFoundBetween(at(-24 * HOUR_MS), NOW)[1]?.digestedAt).toEqual(NOW);
  });

  test('counts alerts from a moment up to, not including, another', () => {
    [1, 2, 3].forEach((n) => store.findings.add(newFinding(n, 'A')));
    store.findings.markAlerted(1, at(-MINUTE_MS));
    store.findings.markAlerted(2, NOW);
    store.findings.markAlerted(3, at(HOUR_MS));

    expect(store.findings.countAlertedBetween(NOW, at(HOUR_MS))).toBe(1);
    expect(store.findings.countAlertedBetween(at(-HOUR_MS), at(2 * HOUR_MS))).toBe(3);
  });

  test('lists the findings made in a stretch of time, oldest first', () => {
    store.findings.add(newFinding(2, 'B', { foundAt: at(-HOUR_MS) }));
    store.findings.add(newFinding(1, 'A', { foundAt: at(-2 * HOUR_MS) }));
    store.findings.add(newFinding(3, 'C', { foundAt: NOW }));

    const found = store.findings.listFoundBetween(at(-2 * HOUR_MS), NOW);

    expect(found.map((finding) => finding.channelTitle)).toEqual(['Channel A', 'Channel B']);
  });

  test('outlives the video it was made from', () => {
    store.channels.upsert(channelFacts('A'), NOW);
    store.videos.upsert(videoFacts(1, 'A'), NOW);
    store.findings.add(newFinding(1, 'A'));

    store.videos.delete(newFinding(1, 'A').videoId);

    expect(store.findings.countWaiting()).toBe(1);
  });
});

describe('a finding reason', () => {
  test('comes back from text as it went in', () => {
    expect(reasonFromText(reasonToText(reasonFor(2)))).toEqual(reasonFor(2));
  });

  test('reads as saying nothing when the text is not JSON or not a reason', () => {
    expect(reasonFromText('{not json')).toEqual(NO_REASON);
    expect(reasonFromText('{"totalViews":-4}')).toEqual(NO_REASON);
  });

  test('fills in whatever the text leaves out', () => {
    expect(reasonFromText('{"why":["Fast"]}')).toEqual({ ...NO_REASON, why: ['Fast'] });
  });

  test('refuses to store a figure or a country that is out of shape', () => {
    expect(() => reasonToText(reasonFor(1, { subjectRegion: 'Canada' }))).toThrow(
      /Invalid finding reason. subjectRegion/,
    );
  });
});

describe('the service state repository', () => {
  test('answers null for a name never set', () => {
    expect(store.state.get('never')).toBeNull();
  });

  test('keeps the last value set under a name', () => {
    store.state.set('day', '2026-11-19', NOW);
    store.state.set('day', '2026-11-20', at(HOUR_MS));

    expect(store.state.get('day')).toBe('2026-11-20');
  });
});

describe('the tracking counts', () => {
  test('count the videos still tracked and those whose read is due', () => {
    store.channels.upsert(channelFacts('A'), NOW);
    [1, 2, 3].forEach((n) => store.videos.upsert(videoFacts(n, 'A'), NOW));
    store.tracking.start(videoFacts(1, 'A').id, 'yes', at(-MINUTE_MS));
    store.tracking.start(videoFacts(2, 'A').id, 'yes', at(HOUR_MS));
    store.tracking.start(videoFacts(3, 'A').id, 'yes', at(-HOUR_MS));
    store.tracking.finish(videoFacts(3, 'A').id);

    expect(store.tracking.counts(NOW)).toEqual({ tracked: 2, due: 1 });
  });

  test('are zero for an empty store', () => {
    expect(store.tracking.counts(NOW)).toEqual({ tracked: 0, due: 0 });
  });
});
