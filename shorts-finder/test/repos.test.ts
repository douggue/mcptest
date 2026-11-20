import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { openStore } from '../src/repos/store';
import type { Store } from '../src/repos/types';
import { createSubject } from '../src/subjects/subject';
import { channelId, videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';

let db: Db;
let store: Store;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = openStore(db);
});

afterEach(() => {
  db.close();
});

/** Stores a video and the channel it needs. */
function addVideo(n: number, letter: string, publishedAt: Date = at(-2 * HOUR_MS)): string {
  store.channels.upsert(channelFacts(letter), NOW);
  store.videos.upsert(videoFacts(n, letter, { publishedAt }), NOW);
  return videoId(n);
}

describe('the channel repository', () => {
  test('stores what the API says about a channel and gives it back', () => {
    store.channels.upsert(channelFacts('A'), NOW);

    expect(store.channels.get(channelId('A'))).toEqual({
      ...channelFacts('A'),
      fetchedAt: NOW,
      readQueuedAt: null,
    });
  });

  test('replaces the facts when the channel is read again', () => {
    store.channels.upsert(channelFacts('A'), at(-DAY_MS));

    store.channels.upsert(channelFacts('A', { subscribers: 2400, subscribersHidden: true }), NOW);

    expect(store.channels.get(channelId('A'))).toMatchObject({
      subscribers: 2400,
      subscribersHidden: true,
      fetchedAt: NOW,
    });
  });

  test('knows nothing of a channel never stored', () => {
    expect(store.channels.get(channelId('Z'))).toBeNull();
  });

  test('makes a row for a channel known only from a search and queues a read of its facts', () => {
    const queued = store.channels.queueRead({
      id: channelId('B'),
      title: 'Channel B',
      now: NOW,
      staleBefore: at(-DAY_MS),
    });

    expect(queued).toBe(true);
    expect(store.channels.listQueued()).toEqual([channelId('B')]);
    expect(store.channels.get(channelId('B'))).toMatchObject({
      title: 'Channel B',
      createdAt: null,
      subscribers: null,
      readQueuedAt: NOW,
    });
  });

  test('does not queue a channel whose facts were read within the day', () => {
    store.channels.upsert(channelFacts('A'), at(-23 * HOUR_MS));

    const queued = store.channels.queueRead({
      id: channelId('A'),
      title: 'Another name',
      now: NOW,
      staleBefore: at(-DAY_MS),
    });

    expect(queued).toBe(false);
    expect(store.channels.listQueued()).toEqual([]);
    expect(store.channels.get(channelId('A'))?.title).toBe('Channel A');
  });

  test('queues a known channel once its facts are a day old, and only once', () => {
    store.channels.upsert(channelFacts('A'), at(-DAY_MS));
    const request = { id: channelId('A'), title: null, staleBefore: at(-DAY_MS) };

    expect(store.channels.queueRead({ ...request, now: NOW })).toBe(true);
    expect(store.channels.queueRead({ ...request, now: at(MINUTE_MS) })).toBe(false);

    expect(store.channels.get(channelId('A'))?.readQueuedAt).toEqual(NOW);
  });

  test('lists the queue longest-waiting first and empties it as channels are read', () => {
    const request = { title: null, staleBefore: at(-DAY_MS) };
    store.channels.queueRead({ ...request, id: channelId('C'), now: at(MINUTE_MS) });
    store.channels.queueRead({ ...request, id: channelId('B'), now: NOW });

    expect(store.channels.listQueued()).toEqual([channelId('B'), channelId('C')]);
    store.channels.upsert(channelFacts('B'), at(HOUR_MS));

    expect(store.channels.listQueued()).toEqual([channelId('C')]);
  });

  test('takes a channel the API does not return out of the queue, keeping its row', () => {
    store.channels.queueRead({
      id: channelId('D'),
      title: null,
      now: NOW,
      staleBefore: at(-DAY_MS),
    });

    store.channels.markUnavailable(channelId('D'), at(HOUR_MS));

    expect(store.channels.listQueued()).toEqual([]);
    expect(store.channels.get(channelId('D'))).toMatchObject({
      title: null,
      createdAt: null,
      fetchedAt: at(HOUR_MS),
      readQueuedAt: null,
    });
  });
});

describe('the video repository', () => {
  test('stores what the API says about a video and gives it back', () => {
    store.channels.upsert(channelFacts('A'), NOW);

    store.videos.upsert(videoFacts(1, 'A'), NOW);

    expect(store.videos.get(videoId(1))).toEqual({ ...videoFacts(1, 'A'), fetchedAt: NOW });
  });

  test('keeps a hidden view count and an unknown length as unknown', () => {
    store.channels.upsert(channelFacts('A'), NOW);

    store.videos.upsert(videoFacts(1, 'A', { views: null, durationSeconds: null }), NOW);

    expect(store.videos.get(videoId(1))).toMatchObject({ views: null, durationSeconds: null });
  });

  test('replaces the facts when the video is read again', () => {
    addVideo(1, 'A');

    store.videos.upsert(videoFacts(1, 'A', { views: 5000, title: 'Renamed' }), at(HOUR_MS));

    expect(store.videos.get(videoId(1))).toMatchObject({
      views: 5000,
      title: 'Renamed',
      fetchedAt: at(HOUR_MS),
    });
  });

  test('refuses a video whose channel has no row', () => {
    expect(() => store.videos.upsert(videoFacts(1, 'A'), NOW)).toThrow(/FOREIGN KEY/);
  });

  test('says which of some ids are stored', () => {
    addVideo(1, 'A');
    addVideo(3, 'B');

    expect(store.videos.knownIds([videoId(3), videoId(2), videoId(1)])).toEqual([
      videoId(1),
      videoId(3),
    ]);
    expect(store.videos.knownIds([])).toEqual([]);
    expect(store.videos.get(videoId(2))).toBeNull();
  });

  test('deletes a video with its readings, tracking and hits', () => {
    const id = addVideo(1, 'A');
    const subject = store.subjects.add(createSubject({ keyword: 'paper folding', region: 'US' }));
    store.readings.add({ videoId: id, capturedAt: NOW, views: 10 });
    store.tracking.start(id, 'yes', at(HOUR_MS));
    store.hits.add(subject.id, id, NOW);

    expect(store.videos.delete(id)).toBe(true);
    expect(store.videos.delete(id)).toBe(false);

    expect(store.videos.get(id)).toBeNull();
    expect(store.readings.list(id, at(-DAY_MS), at(DAY_MS))).toEqual([]);
    expect(store.tracking.get(id)).toBeNull();
    expect(store.hits.videoIdsFor(subject.id)).toEqual([]);
  });
});

describe('the reading repository', () => {
  test('lists a video’s readings inside a window, oldest first, ends included', () => {
    const id = addVideo(1, 'A');
    const other = addVideo(2, 'B');
    [-3, -1, -2, 0].forEach((hours) =>
      store.readings.add({ videoId: id, capturedAt: at(hours * HOUR_MS), views: 100 + hours }),
    );
    store.readings.add({ videoId: other, capturedAt: at(-HOUR_MS), views: 7 });

    const readings = store.readings.list(id, at(-2 * HOUR_MS), NOW);

    expect(readings).toEqual([
      { videoId: id, capturedAt: at(-2 * HOUR_MS), views: 98 },
      { videoId: id, capturedAt: at(-HOUR_MS), views: 99 },
      { videoId: id, capturedAt: NOW, views: 100 },
    ]);
  });

  test('keeps moments to the whole second, and one reading a second', () => {
    const id = addVideo(1, 'A');

    store.readings.add({ videoId: id, capturedAt: at(250), views: 10 });
    store.readings.add({ videoId: id, capturedAt: at(900), views: 12 });

    expect(store.readings.list(id, at(-HOUR_MS), at(HOUR_MS))).toEqual([
      { videoId: id, capturedAt: NOW, views: 12 },
    ]);
  });

  test('thins old readings to the last of each day, per video, leaving recent ones alone', () => {
    const id = addVideo(1, 'A');
    const other = addVideo(2, 'B');
    // 2026-11-01 and 2026-11-02 (UTC), three readings each, then one recent day.
    const old = ['01T05', '01T11', '01T23', '02T00', '02T06', '02T18'];
    old.forEach((stamp, index) =>
      store.readings.add({
        videoId: id,
        capturedAt: new Date(`2026-11-${stamp}:00:00Z`),
        views: index,
      }),
    );
    store.readings.add({ videoId: other, capturedAt: new Date('2026-11-01T05:00:00Z'), views: 50 });
    store.readings.add({ videoId: id, capturedAt: at(-2 * HOUR_MS), views: 90 });
    store.readings.add({ videoId: id, capturedAt: at(-HOUR_MS), views: 91 });

    const removed = store.readings.rollUpOlderThan(at(-14 * DAY_MS));

    expect(removed).toBe(4);
    expect(store.readings.list(id, new Date(0), NOW).map((reading) => reading.views)).toEqual([
      2, 5, 90, 91,
    ]);
    expect(store.readings.list(other, new Date(0), NOW)).toHaveLength(1);
    expect(store.readings.rollUpOlderThan(at(-14 * DAY_MS))).toBe(0);
  });

  test('thins a day that the cutoff falls inside without losing its last reading', () => {
    const id = addVideo(1, 'A');
    ['03', '09', '15', '21'].forEach((hour, index) =>
      store.readings.add({
        videoId: id,
        capturedAt: new Date(`2026-11-05T${hour}:00:00Z`),
        views: index,
      }),
    );

    const removed = store.readings.rollUpOlderThan(new Date('2026-11-05T12:00:00Z'));

    expect(removed).toBe(2);
    expect(store.readings.list(id, new Date(0), NOW).map((reading) => reading.views)).toEqual([
      2, 3,
    ]);
  });

  test('finds the old readings through an index, not by reading every row', () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN DELETE FROM video_snapshots WHERE captured_at < 5 AND EXISTS (
           SELECT 1 FROM video_snapshots later WHERE later.video_id = video_snapshots.video_id
             AND later.captured_at > video_snapshots.captured_at AND later.captured_at < 9)`,
      )
      .all() as Array<{ detail: string }>;

    const steps = plan.map((step) => step.detail).join(' | ');
    expect(steps).toMatch(/video_snapshots_captured/);
    expect(steps).not.toMatch(/SCAN video_snapshots(?! USING)/);
  });

  test('removes every reading of one video and says how many', () => {
    const id = addVideo(1, 'A');
    const other = addVideo(2, 'B');
    store.readings.add({ videoId: id, capturedAt: at(-HOUR_MS), views: 1 });
    store.readings.add({ videoId: id, capturedAt: NOW, views: 2 });
    store.readings.add({ videoId: other, capturedAt: NOW, views: 3 });

    expect(store.readings.deleteForVideo(id)).toBe(2);

    expect(store.readings.list(id, new Date(0), NOW)).toEqual([]);
    expect(store.readings.list(other, new Date(0), NOW)).toHaveLength(1);
  });
});

describe('the subject repository', () => {
  const paper = createSubject({ keyword: 'paper folding', region: 'US', language: 'en' });
  const bread = createSubject({ keyword: 'sourdough starter', region: 'GB', everyHours: 48 });
  const sky = createSubject({ keyword: 'night sky', region: 'CA', language: 'en' });

  test('stores a subject enabled and never searched, and gives it a number', () => {
    const stored = store.subjects.add(bread);

    expect(stored).toEqual({
      id: 1,
      keyword: 'sourdough starter',
      region: 'GB',
      language: null,
      everyHours: 48,
      enabled: true,
      lastSearchedAt: null,
    });
    expect(store.subjects.list()).toEqual([stored]);
  });

  test('refuses the same keyword, country and language twice, in plain words', () => {
    store.subjects.add(paper);

    expect(() => store.subjects.add(paper)).toThrow(
      'The subject "paper folding" in US is already on the list',
    );
    expect(store.subjects.add({ ...paper, region: 'AU' }).id).toBe(2);
  });

  test('turns a subject off and on, and says when there is no such subject', () => {
    const { id } = store.subjects.add(paper);

    expect(store.subjects.setEnabled(id, false)).toBe(true);
    expect(store.subjects.list()[0]?.enabled).toBe(false);
    expect(store.subjects.listDue(NOW)).toEqual([]);
    expect(store.subjects.setEnabled(id, true)).toBe(true);
    expect(store.subjects.setEnabled(99, false)).toBe(false);
  });

  test('lists as due the never-searched, then the longest unsearched, and not the recent', () => {
    const first = store.subjects.add(paper);
    const second = store.subjects.add(bread);
    const third = store.subjects.add(sky);
    const fourth = store.subjects.add({ ...sky, region: 'AU' });
    store.subjects.markSearched(first.id, at(-30 * HOUR_MS));
    store.subjects.markSearched(second.id, at(-47 * HOUR_MS));
    store.subjects.markSearched(third.id, at(-24 * HOUR_MS));

    const due = store.subjects.listDue(NOW);

    expect(due.map((subject) => subject.id)).toEqual([fourth.id, first.id, third.id]);
    expect(due[1]?.lastSearchedAt).toEqual(at(-30 * HOUR_MS));
  });
});

describe('the subject hit repository', () => {
  test('notes once which search found which video, first-seen first', () => {
    const subject = store.subjects.add(createSubject({ keyword: 'bicycle repair', region: 'AU' }));
    const first = addVideo(1, 'A');
    const second = addVideo(2, 'B');

    expect(store.hits.add(subject.id, second, at(HOUR_MS))).toBe(true);
    expect(store.hits.add(subject.id, first, NOW)).toBe(true);
    expect(store.hits.add(subject.id, first, at(2 * HOUR_MS))).toBe(false);

    expect(store.hits.videoIdsFor(subject.id)).toEqual([first, second]);
  });
});

describe('the tracking repository', () => {
  test('starts a video at the hourly tier, once', () => {
    const id = addVideo(1, 'A', at(-5 * HOUR_MS));

    expect(store.tracking.start(id, 'yes', at(HOUR_MS))).toBe(true);
    expect(store.tracking.start(id, 'unknown', at(2 * HOUR_MS))).toBe(false);

    expect(store.tracking.get(id)).toEqual({
      videoId: id,
      tier: 'hourly',
      nextReadAt: at(HOUR_MS),
      isShort: 'yes',
      missedReads: 0,
      publishedAt: at(-5 * HOUR_MS),
    });
    expect(store.tracking.get(videoId(9))).toBeNull();
  });

  test('lists what is due by now, longest-due first, and nothing that is done', () => {
    const late = addVideo(1, 'A');
    const due = addVideo(2, 'B');
    const later = addVideo(3, 'C');
    const done = addVideo(4, 'D');
    store.tracking.start(due, 'yes', NOW);
    store.tracking.start(late, 'yes', at(-HOUR_MS));
    store.tracking.start(later, 'yes', at(MINUTE_MS));
    store.tracking.start(done, 'yes', at(-HOUR_MS));
    store.tracking.finish(done);

    expect(store.tracking.listDue(NOW).map((tracked) => tracked.videoId)).toEqual([late, due]);
    expect(store.tracking.get(done)).toMatchObject({ tier: 'done', nextReadAt: null });
  });

  test('moves a video to another tier and sets its next read', () => {
    const id = addVideo(1, 'A');
    store.tracking.start(id, 'yes', NOW);

    store.tracking.move(id, 'six_hourly', at(6 * HOUR_MS));

    expect(store.tracking.get(id)).toMatchObject({
      tier: 'six_hourly',
      nextReadAt: at(6 * HOUR_MS),
    });
  });

  test('counts missed reads in a row, and starts again from none when the video is read', () => {
    const id = addVideo(1, 'A');
    store.tracking.start(id, 'yes', NOW);

    expect(store.tracking.markMissed(id, 'hourly', at(HOUR_MS))).toBe(1);
    expect(store.tracking.markMissed(id, 'hourly', at(2 * HOUR_MS))).toBe(2);
    expect(store.tracking.get(id)).toMatchObject({ missedReads: 2, nextReadAt: at(2 * HOUR_MS) });
    store.tracking.move(id, 'hourly', at(3 * HOUR_MS));

    expect(store.tracking.get(id)?.missedReads).toBe(0);
    expect(store.tracking.markMissed(videoId(9), 'hourly', NOW)).toBe(0);
  });

  test('records what was learnt about whether a video is a Short', () => {
    const id = addVideo(1, 'A');
    store.tracking.start(id, 'unknown', NOW);

    store.tracking.classify(id, 'no');

    expect(store.tracking.get(id)?.isShort).toBe('no');
  });
});
