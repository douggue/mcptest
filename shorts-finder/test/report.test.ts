import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { buildEvidence, formatEvidence, type SubjectVideo } from '../src/report/evidence';
import { openStore } from '../src/repos/store';
import type { Store } from '../src/repos/types';
import { createSubject } from '../src/subjects/subject';
import { NO_GROWTH } from '../src/track/growth';
import { videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';

/** A found video ten hours old unless told otherwise. */
function row(
  keyword: string,
  region: string,
  n: number,
  views24h: number | null,
  subscribers: number | null,
  ageHours = 10,
): SubjectVideo {
  return {
    keyword,
    region,
    videoId: videoId(n),
    publishedAt: at(-ageHours * HOUR_MS),
    views24h,
    subscribers,
  };
}

/** Three unrelated subjects, two of them searched in more than one country. */
const ROWS: readonly SubjectVideo[] = [
  row('paper folding', 'US', 1, 1000, 100, 30),
  row('paper folding', 'US', 2, 2000, 1000, 30),
  row('paper folding', 'US', 3, 3000, null, 80),
  row('paper folding', 'US', 4, 4000, 0, 200),
  row('paper folding', 'US', 5, 5000, 500, 400),
  row('paper folding', 'US', 6, null, 500, 3),
  row('paper folding', 'GB', 1, 1000, 100, 30),
  row('paper folding', 'GB', 2, 2000, 1000, 30),
  row('paper folding', 'GB', 7, 700, 70, 30),
  row('paper folding', 'CA', 8, null, null, 2),
  row('night sky', 'AU', 9, 90, 9, 12),
  row('sourdough starter', 'GB', 10, 50, 100, 30),
  row('sourdough starter', 'AU', 11, 60, 100, 30),
];

describe('buildEvidence', () => {
  const evidence = buildEvidence(ROWS, NOW);

  test('counts each subject’s videos and how they spread over the age bands today', () => {
    const paperUs = evidence.subjects[0];

    expect(evidence.subjects.map((subject) => `${subject.keyword}/${subject.region}`)).toEqual([
      'paper folding/US',
      'paper folding/GB',
      'paper folding/CA',
      'night sky/AU',
      'sourdough starter/GB',
      'sourdough starter/AU',
    ]);
    expect(paperUs).toMatchObject({ videos: 6 });
    expect(paperUs?.bands).toEqual([
      { band: '0-6 h', count: 1 },
      { band: '6-24 h', count: 0 },
      { band: '24-72 h', count: 2 },
      { band: '3-7 d', count: 1 },
      { band: '7-14 d', count: 1 },
      { band: 'older', count: 1 },
    ]);
  });

  test('gives the spread of views at 24 hours over the videos that have that figure', () => {
    expect(evidence.subjects[0]?.views24h).toEqual({
      count: 5,
      min: 1000,
      q1: 2000,
      median: 3000,
      q3: 4000,
      max: 5000,
    });
    expect(evidence.subjects[2]?.views24h).toBeNull();
  });

  test('gives the spread of views at 24 hours per subscriber, leaving out hidden and empty counts', () => {
    // 1000/100, 2000/1000 and 5000/500: the hidden count and the count of none are left out.
    expect(evidence.subjects[0]?.views24hPerSubscriber).toEqual({
      count: 3,
      min: 2,
      q1: 6,
      median: 10,
      q3: 10,
      max: 10,
    });
    expect(evidence.subjects[2]?.views24hPerSubscriber).toBeNull();
  });

  test('measures how much a keyword’s finds overlap between each pair of countries', () => {
    expect(evidence.overlaps).toEqual([
      { keyword: 'paper folding', regions: ['CA', 'GB'], found: [1, 3], shared: 0, share: 0 },
      { keyword: 'paper folding', regions: ['CA', 'US'], found: [1, 6], shared: 0, share: 0 },
      {
        keyword: 'paper folding',
        regions: ['GB', 'US'],
        found: [3, 6],
        shared: 2,
        share: 2 / 3,
      },
      { keyword: 'sourdough starter', regions: ['AU', 'GB'], found: [1, 1], shared: 0, share: 0 },
    ]);
  });

  test('has nothing to lay out for an empty store', () => {
    expect(buildEvidence([], NOW)).toEqual({ subjects: [], overlaps: [] });
  });
});

describe('formatEvidence', () => {
  test('prints sizes, spreads and overlaps as plain lines', () => {
    const lines = formatEvidence(buildEvidence(ROWS, NOW));

    expect(lines.slice(0, 5)).toEqual([
      'What the searches have found, by subject and country',
      '"paper folding" in US: 6 videos found',
      '  by age now: 0-6 h: 1, 24-72 h: 2, 3-7 d: 1, 7-14 d: 1, older: 1',
      '  views at 24 h: min 1K, quartiles 2K / 3K / 4K, max 5K (5 videos)',
      '  views at 24 h per subscriber: min 2.00, quartiles 6.00 / 10.00 / 10.00, max 10.00 (3 videos)',
    ]);
    expect(lines).toContain('  views at 24 h: no figures yet');
    expect(lines).toContain('How much each keyword overlaps between countries');
    expect(lines).toContain('"paper folding" GB and US: 2 shared of 3 and 6 (67% of the smaller)');
  });

  test('says so when no keyword is searched in two countries, and when nothing has been found', () => {
    const single = formatEvidence(buildEvidence([row('night sky', 'AU', 9, 90, 9)], NOW));

    expect(single.at(-1)).toBe('No keyword is searched in more than one country.');
    expect(formatEvidence(buildEvidence([], NOW))).toEqual([
      'Nothing has been found yet. Run the service for a while, then ask again.',
    ]);
  });
});

describe('the report’s query', () => {
  let db: Db;
  let store: Store;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = openStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('lists each stored video once for each subject that found it, with its figure at 24 hours', () => {
    const us = store.subjects.add(createSubject({ keyword: 'bicycle repair', region: 'US' }));
    const gb = store.subjects.add(createSubject({ keyword: 'bicycle repair', region: 'GB' }));
    store.channels.upsert(channelFacts('A', { subscribers: 250 }), NOW);
    store.videos.upsert(videoFacts(1, 'A', { publishedAt: at(-2 * DAY_MS) }), NOW);
    store.videos.upsert(videoFacts(2, 'A', { publishedAt: at(-DAY_MS) }), NOW);
    store.growth.save(videoId(1), { ...NO_GROWTH, views24h: 4200 });
    const found = (subjectId: number, id: string, kind: 'newest' | 'top_recent') =>
      store.hits.add({ subjectId, videoId: id, kind, rank: 1, ageHours: 1, firstSeenAt: NOW });
    found(us.id, videoId(1), 'newest');
    found(us.id, videoId(1), 'top_recent');
    found(us.id, videoId(2), 'newest');
    found(gb.id, videoId(1), 'top_recent');
    store.hits.add({
      subjectId: null,
      videoId: videoId(2),
      kind: 'channel_feed',
      rank: null,
      ageHours: 1,
      firstSeenAt: NOW,
    });

    const rows = store.report.subjectVideos();

    expect(rows).toEqual([
      {
        keyword: 'bicycle repair',
        region: 'GB',
        videoId: videoId(1),
        publishedAt: at(-2 * DAY_MS),
        views24h: 4200,
        subscribers: 250,
      },
      {
        keyword: 'bicycle repair',
        region: 'US',
        videoId: videoId(1),
        publishedAt: at(-2 * DAY_MS),
        views24h: 4200,
        subscribers: 250,
      },
      {
        keyword: 'bicycle repair',
        region: 'US',
        videoId: videoId(2),
        publishedAt: at(-DAY_MS),
        views24h: null,
        subscribers: 250,
      },
    ]);
  });
});
