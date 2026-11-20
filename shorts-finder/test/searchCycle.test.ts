import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runSearchCycle } from '../src/discover/searchCycle';
import {
  CHANNEL_REREAD_AFTER_MS,
  MAX_CHANNEL_READ_ATTEMPTS,
  readQueuedChannels,
} from '../src/discover/channelReads';
import { PENDING_HIT_MAX_AGE_MS } from '../src/discover/hitDetails';
import { planFor } from '../src/quota/ledger';
import type { Subject } from '../src/repos/types';
import { createSubject, type SubjectInput } from '../src/subjects/subject';
import { SHORTS_MAX_SECONDS } from '../src/youtube/shorts';
import { channelId, videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, NOW, at, channelFacts } from './fixtures/facts';
import { hit, openBench, refusalBody, type Bench } from './helpers/fakeYouTube';

const DAY = '2026-11-20';

let bench: Bench;

beforeEach(() => {
  bench = openBench();
});

afterEach(() => {
  bench.db.close();
});

const run = (signal?: AbortSignal) => runSearchCycle(bench, signal);

/**
 * Adds a subject whose newest sweep has just run, so that only its most-viewed
 * search is due: most tests here are about one search at a time.
 */
function add(input: SubjectInput): Subject {
  const subject = bench.store.subjects.add(createSubject(input));
  bench.store.subjects.markSwept(subject.id, { at: NOW, intervalHours: 24 });
  return subject;
}

/** Four subjects in unrelated niches, one in each of four countries. */
function addSubjects(): readonly Subject[] {
  return [
    add({ keyword: 'paper folding', region: 'US', language: 'en' }),
    add({ keyword: 'sourdough starter', region: 'GB', language: 'en' }),
    add({ keyword: 'night sky', region: 'CA' }),
    add({ keyword: 'bicycle repair', region: 'AU', language: 'en' }),
  ];
}

const top = (subject: Subject | undefined) => ({ subjectId: subject?.id, kind: 'top_recent' });

/** One subject whose search finds video 1 of channel A, with both in the world. */
function oneFind(): Subject {
  const subject = add({ keyword: 'paper folding', region: 'US', language: 'en' });
  bench.youtube.setSearch('paper folding', 'US', [hit(1, 'A')]);
  bench.youtube.setVideo(1, 'A', { views: 1200 });
  bench.youtube.setChannel('A');
  return subject;
}

describe('a search cycle', () => {
  test('asks for the most-viewed short videos of the last 48 hours in the subject’s country and language', async () => {
    oneFind();

    await run();

    expect(bench.youtube.callsTo('search')[0]?.params).toMatchObject({
      q: 'paper folding',
      regionCode: 'US',
      relevanceLanguage: 'en',
      videoDuration: 'short',
      order: 'viewCount',
      publishedAfter: at(-2 * DAY_MS).toISOString(),
    });
  });

  test('leaves the language open for a subject with none', async () => {
    add({ keyword: 'night sky', region: 'CA' });

    await run();

    expect(bench.youtube.callsTo('search')[0]?.params).not.toHaveProperty('relevanceLanguage');
  });

  test('stores a new video with its first reading, tracks it hourly and notes which search found it', async () => {
    const subject = oneFind();

    const report = await run();

    expect(report.searched).toEqual([
      {
        subjectId: subject.id,
        kind: 'top_recent',
        result: 'searched',
        hits: 1,
        skipped: 0,
        fullPage: false,
      },
    ]);
    expect(report.details).toEqual({
      newVideos: 1,
      tooLong: 0,
      notReturned: 0,
      skipped: 0,
      leftPending: 0,
      stopped: null,
      failure: null,
    });
    expect(bench.store.videos.get(videoId(1))).toMatchObject({ views: 1200, fetchedAt: NOW });
    expect(bench.store.readings.list(videoId(1), at(-HOUR_MS), NOW)).toEqual([
      { videoId: videoId(1), capturedAt: NOW, views: 1200, likes: 9120, comments: 311 },
    ]);
    expect(bench.store.tracking.get(videoId(1))).toMatchObject({
      tier: 'hourly',
      nextReadAt: at(HOUR_MS),
      isShort: 'yes',
    });
    expect(bench.store.hits.videoIdsFor(subject.id)).toEqual([videoId(1)]);
    expect(bench.store.subjects.list()[0]?.lastSearchedAt).toEqual(NOW);
  });

  test('notes how a video was found: the kind of search, its place in the results and its age then', async () => {
    const subject = add({ keyword: 'night sky', region: 'CA' });
    bench.youtube.setSearch('night sky', 'CA', [hit(3, 'C'), { id: {} }, hit(1, 'A')]);
    bench.youtube.setVideo(1, 'A', { publishedAt: at(-90 * 60_000) });
    bench.youtube.setVideo(3, 'C', { publishedAt: at(-30 * HOUR_MS) });

    await run();

    expect(bench.store.hits.listForVideo(videoId(1))).toEqual([
      {
        subjectId: subject.id,
        videoId: videoId(1),
        kind: 'top_recent',
        rank: 3,
        ageHours: 1.5,
        firstSeenAt: NOW,
      },
    ]);
    expect(bench.store.hits.listForVideo(videoId(3))[0]).toMatchObject({ rank: 1, ageHours: 30 });
  });

  test('starts a new video on the tier its age calls for, with its likes and comments beside its views', async () => {
    const subject = add({ keyword: 'night sky', region: 'CA' });
    bench.youtube.setSearch('night sky', 'CA', [hit(1, 'A'), hit(2, 'B')]);
    bench.youtube.setVideo(1, 'A', { publishedAt: at(-5 * HOUR_MS), views: 700 });
    bench.youtube.setVideo(2, 'B', { publishedAt: at(-80 * HOUR_MS) });

    await run();

    expect(bench.store.tracking.get(videoId(1))).toMatchObject({
      tier: 'hourly',
      nextReadAt: at(HOUR_MS),
    });
    expect(bench.store.tracking.get(videoId(2))).toMatchObject({
      tier: 'six_hourly',
      nextReadAt: at(6 * HOUR_MS),
    });
    expect(bench.store.readings.list(videoId(1), at(-HOUR_MS), NOW)).toEqual([
      { videoId: videoId(1), capturedAt: NOW, views: 700, likes: 9120, comments: 311 },
    ]);
    expect(bench.store.hits.videoIdsFor(subject.id)).toHaveLength(2);
  });

  test('reads the facts of a new video’s channel in the same cycle', async () => {
    oneFind();

    const report = await run();

    expect(report.channels).toMatchObject({ read: 1, leftQueued: 0, stopped: null });
    expect(bench.store.channels.get(channelId('A'))).toMatchObject({
      title: 'Channel A',
      subscribers: 890,
      readQueuedAt: null,
    });
  });

  test('pays for a search and its details from the search share, and the channel from its own', async () => {
    oneFind();

    await run();

    expect(bench.quota.usage(DAY).byKind).toEqual({
      search: 101,
      reading: 0,
      channel: 1,
      reserve: 0,
    });
  });

  test('keeps a video at the Shorts limit, drops a longer one, and keeps one of unknown length as unknown', async () => {
    const subject = add({ keyword: 'night sky', region: 'CA' });
    bench.youtube.setSearch('night sky', 'CA', [hit(1, 'A'), hit(2, 'B'), hit(3, 'C')]);
    bench.youtube.setVideo(1, 'A', { duration: 'PT3M' });
    bench.youtube.setVideo(2, 'B', { duration: 'PT3M1S' });
    bench.youtube.setVideo(3, 'C', { duration: null });

    const report = await run();

    expect(SHORTS_MAX_SECONDS).toBe(180);
    expect(report.searched[0]).toMatchObject({ hits: 3 });
    expect(report.details).toMatchObject({ newVideos: 2, tooLong: 1 });
    expect(bench.store.tracking.get(videoId(1))?.isShort).toBe('yes');
    expect(bench.store.videos.get(videoId(2))).toBeNull();
    expect(bench.store.tracking.get(videoId(3))?.isShort).toBe('unknown');
    expect(bench.store.hits.videoIdsFor(subject.id)).toEqual([videoId(1), videoId(3)]);
  });

  test('stores a video whose view count is hidden, without a reading', async () => {
    oneFind();
    bench.youtube.setVideo(1, 'A', { views: null });

    await run();

    expect(bench.store.videos.get(videoId(1))?.views).toBeNull();
    expect(bench.store.readings.list(videoId(1), at(-HOUR_MS), NOW)).toEqual([]);
    expect(bench.store.tracking.get(videoId(1))?.tier).toBe('hourly');
  });

  test('does not read or track again a video another search already found, but notes the hit', async () => {
    const [paper, bread] = addSubjects();
    bench.youtube.setSearch('paper folding', 'US', [hit(1, 'A')]);
    bench.youtube.setSearch('sourdough starter', 'GB', [hit(1, 'A'), hit(1, 'A')]);
    bench.youtube.setVideo(1, 'A');

    const report = await run();

    expect(bench.youtube.callsTo('videos')).toHaveLength(1);
    expect(report.details.newVideos).toBe(1);
    expect(bench.store.hits.videoIdsFor(paper!.id)).toEqual([videoId(1)]);
    expect(bench.store.hits.videoIdsFor(bread!.id)).toEqual([videoId(1)]);
  });

  test('searches nothing that is not due, and says so by doing nothing', async () => {
    const subject = oneFind();
    bench.store.subjects.markSearched(subject.id, 'top_recent', at(-HOUR_MS));

    const report = await run();

    expect(report).toMatchObject({ searched: [], failed: [], leftUndone: [], stopped: null });
    expect(bench.youtube.calls).toEqual([]);
  });
});

describe('the newest sweep of a subject', () => {
  /** A subject whose most-viewed search has just run, so that only its newest sweep is due. */
  function sweepOnly(input: SubjectInput): Subject {
    const subject = bench.store.subjects.add(createSubject(input));
    bench.store.subjects.markSearched(subject.id, 'top_recent', NOW);
    return subject;
  }

  const fullPage = (letter: string): unknown[] =>
    Array.from({ length: 50 }, (_, n) => hit(100 + n, letter));
  const stored = (): Subject => bench.store.subjects.list()[0]!;

  test('asks for the newest first, a named most back the first time, then from where the last sweep ended', async () => {
    sweepOnly({ keyword: 'night sky', region: 'CA' });

    await run();
    bench.clock = at(DAY_MS);
    bench.store.subjects.markSearched(stored().id, 'top_recent', bench.clock);
    await run();

    const [first, second] = bench.youtube.callsTo('search');
    expect(first?.params).toMatchObject({
      order: 'date',
      publishedAfter: at(-2 * DAY_MS).toISOString(),
    });
    expect(second?.params).toMatchObject({ order: 'date', publishedAfter: NOW.toISOString() });
  });

  test('notes the hit as found by a newest sweep, apart from a most-viewed search finding the same video', async () => {
    const subject = bench.store.subjects.add(createSubject({ keyword: 'night sky', region: 'CA' }));
    bench.youtube.setSearch('night sky', 'CA', [hit(2, 'B'), hit(1, 'A')]);
    bench.youtube.setVideo(1, 'A');
    bench.youtube.setVideo(2, 'B');

    const report = await run();

    expect(report.searched.map((outcome) => outcome.kind)).toEqual(['top_recent', 'newest']);
    expect(bench.youtube.callsTo('videos')).toHaveLength(1);
    expect(
      bench.store.hits.listForVideo(videoId(1)).map((found) => [found.kind, found.rank]),
    ).toEqual([
      ['newest', 2],
      ['top_recent', 2],
    ]);
    expect(bench.store.hits.videoIdsFor(subject.id)).toEqual([videoId(1), videoId(2)]);
  });

  test('halves that subject’s interval when its sweep comes back full, and no other subject’s', async () => {
    sweepOnly({ keyword: 'night sky', region: 'CA' });
    sweepOnly({ keyword: 'paper folding', region: 'US' });
    bench.youtube.setSearch('night sky', 'CA', fullPage('A'));

    const report = await run();

    const [sky, paper] = bench.store.subjects.list();
    expect(report.searched[0]).toMatchObject({ kind: 'newest', hits: 50, fullPage: true });
    expect(sky).toMatchObject({ newestIntervalHours: 12, newestSweptTo: NOW, newestLastAt: NOW });
    expect(paper).toMatchObject({ newestIntervalHours: 24 });
  });

  test('sweeps a busy subject again after its shortened interval, and eases off when a sweep is under half full', async () => {
    sweepOnly({ keyword: 'night sky', region: 'CA' });
    bench.youtube.setSearch('night sky', 'CA', fullPage('A'));
    await run();
    bench.clock = at(11 * HOUR_MS);
    const early = await run();
    bench.clock = at(12 * HOUR_MS);
    const onTime = await run();
    bench.youtube.setSearch('night sky', 'CA', [hit(1, 'A')]);
    bench.clock = at(18 * HOUR_MS);

    const quiet = await run();

    expect(early.searched).toEqual([]);
    expect(onTime.searched).toHaveLength(1);
    expect(quiet.searched).toHaveLength(1);
    // Halved twice to six hours by two full sweeps, then doubled back by a thin one.
    expect(stored().newestIntervalHours).toBe(12);
  });

  test('does not move where the last sweep reached when a sweep fails', async () => {
    const subject = sweepOnly({ keyword: 'night sky', region: 'CA' });
    bench.store.subjects.markSwept(subject.id, { at: at(-30 * HOUR_MS), intervalHours: 24 });
    bench.youtube.refuse((call) => call.path === 'search', 500);

    const report = await run();

    expect(report.failed).toMatchObject([{ subjectId: subject.id, kind: 'newest' }]);
    expect(stored()).toMatchObject({ newestLastAt: NOW, newestSweptTo: at(-30 * HOUR_MS) });
  });
});

describe('a search cycle and the allowance', () => {
  test('searches only as many subjects as the search share can pay for, longest-waiting first', async () => {
    bench.db.close();
    bench = openBench(planFor(500));
    const [paper, bread, sky, bike] = addSubjects();
    bench.store.subjects.markSearched(paper!.id, 'top_recent', at(-30 * HOUR_MS));

    const report = await run();

    // 300 units of searching pay for two subjects at 101 each.
    expect(report.searched.map((outcome) => outcome.subjectId)).toEqual([bread!.id, sky!.id]);
    expect(report.leftUndone).toEqual([top(bike), top(paper)]);
    expect(report.stopped).toBe('allowance');
    expect(bench.youtube.callsTo('search')).toHaveLength(2);
  });

  test('stops cleanly, without throwing, when the share runs out under it', async () => {
    const subjects = addSubjects();
    // Another program spends the share after this cycle has made its plan.
    const spendTheRest = (): void => {
      bench.ledger.spend('search', bench.ledger.remaining(NOW).byKind.search);
    };
    bench.youtube.setSearch('paper folding', 'US', [hit(1, 'A')]);
    bench.youtube.setVideo(1, 'A');
    const firstSearchDone = { seen: false };
    const api = {
      ...bench.api,
      searchRecentVideos: async (...args: Parameters<typeof bench.api.searchRecentVideos>) => {
        if (firstSearchDone.seen) spendTheRest();
        firstSearchDone.seen = true;
        return bench.api.searchRecentVideos(...args);
      },
    };

    const report = await runSearchCycle({ ...bench, api });

    expect(report.searched).toHaveLength(1);
    expect(report.leftUndone).toEqual(subjects.slice(1).map(top));
    expect(report.stopped).toBe('allowance');
    expect(bench.store.subjects.list()[1]?.lastSearchedAt).toBeNull();
  });

  test('calls the day spent when Google itself says so, and stops', async () => {
    const subjects = addSubjects();
    bench.youtube.refuse((call) => call.path === 'search', 403, refusalBody('quotaExceeded'));

    const report = await run();

    expect(report.stopped).toBe('allowance');
    expect(report.leftUndone).toEqual(subjects.map(top));
    expect(bench.youtube.callsTo('search')).toHaveLength(1);
    expect(bench.ledger.remaining(NOW).total).toBe(0);
    expect(report.channels.stopped).toBeNull();
  });

  test('stops for a pause when Google says requests come too fast, leaving the day unspent', async () => {
    addSubjects();
    bench.youtube.refuse((call) => call.path === 'search', 403, refusalBody('rateLimitExceeded'));

    const report = await run();

    expect(report.stopped).toBe('rate_limit');
    expect(report.searched).toEqual([]);
    expect(report.leftUndone).toHaveLength(4);
    expect(bench.youtube.callsTo('search')).toHaveLength(1);
    expect(bench.ledger.remaining(NOW).total).toBeGreaterThan(0);
    expect(bench.youtube.callsTo('channels')).toEqual([]);
  });

  test('leaves channels queued when the channel share is spent, with their videos stored', async () => {
    oneFind();
    bench.ledger.spend('channel', bench.ledger.remaining(NOW).byKind.channel);

    const report = await run();

    expect(report.searched).toHaveLength(1);
    expect(report.channels).toMatchObject({ read: 0, leftQueued: 1, stopped: 'allowance' });
    expect(bench.store.videos.get(videoId(1))).not.toBeNull();
    expect(bench.store.channels.get(channelId('A'))).toMatchObject({
      title: 'Channel A',
      createdAt: null,
    });
  });
});

describe('a search cycle when things go wrong', () => {
  test('carries on past one failing subject, which waits its usual hours', async () => {
    const [paper, bread] = addSubjects();
    bench.youtube.setSearch('sourdough starter', 'GB', [hit(2, 'B')]);
    bench.youtube.setVideo(2, 'B');
    bench.youtube.refuse((call) => call.params['q'] === 'paper folding', 500, {
      error: { message: 'backend error' },
    });

    const report = await run();

    expect(report.failed).toEqual([
      {
        subjectId: paper!.id,
        kind: 'top_recent',
        reason: 'The YouTube API refused the request (500): backend error',
      },
    ]);
    expect(report.searched.map((outcome) => outcome.subjectId)).toContain(bread!.id);
    expect(report.searched).toHaveLength(3);
    expect(report.stopped).toBeNull();
    expect(bench.store.subjects.list()[0]?.lastSearchedAt).toEqual(NOW);
    expect(bench.store.videos.get(videoId(2))).not.toBeNull();
  });

  test('keeps a paid search when the details of its videos cannot be read, and reads them next round', async () => {
    const subject = oneFind();
    bench.youtube.refuse((call) => call.path === 'videos', 503);

    const failed = await run();
    bench.youtube.heal();
    bench.clock = at(HOUR_MS);
    const later = await run();

    expect(failed.searched.map((outcome) => outcome.subjectId)).toEqual([subject.id]);
    expect(failed.failed).toEqual([]);
    expect(failed.details).toMatchObject({ newVideos: 0, leftPending: 1, stopped: null });
    expect(failed.details.failure).toMatch(/refused the request \(503\)/);
    expect(bench.store.subjects.list()[0]?.lastSearchedAt).toEqual(NOW);
    // The second round pays for no search: only the details still owed.
    expect(bench.youtube.callsTo('search')).toHaveLength(1);
    expect(later.details).toMatchObject({ newVideos: 1, leftPending: 0, failure: null });
    expect(bench.store.videos.get(videoId(1))).not.toBeNull();
    expect(bench.store.hits.videoIdsFor(subject.id)).toEqual([videoId(1)]);
  });

  test('keeps a paid search when the details stop for a pause, and searches no further', async () => {
    const [paper] = addSubjects();
    bench.youtube.setSearch('paper folding', 'US', [hit(1, 'A')]);
    bench.youtube.setVideo(1, 'A');
    bench.youtube.refuse((call) => call.path === 'videos', 403, refusalBody('rateLimitExceeded'));

    const report = await run();

    expect(report.searched.map((outcome) => outcome.subjectId)).toEqual([paper!.id]);
    expect(report).toMatchObject({ stopped: 'rate_limit', details: { leftPending: 1 } });
    expect(bench.youtube.callsTo('search')).toHaveLength(1);
    expect(bench.store.subjects.list()[0]?.lastSearchedAt).toEqual(NOW);
    expect(bench.store.pending.list()).toEqual([
      {
        subjectId: paper!.id,
        videoId: videoId(1),
        kind: 'top_recent',
        rank: 1,
        channelId: channelId('A'),
        channelTitle: 'Channel A',
        foundAt: NOW,
      },
    ]);
  });

  test('drops a result still waiting for its details after a day', async () => {
    const subject = oneFind();
    bench.youtube.refuse((call) => call.path === 'videos', 503);
    await run();
    bench.youtube.heal();
    bench.clock = at(PENDING_HIT_MAX_AGE_MS + 1);
    bench.store.subjects.markSearched(subject.id, 'top_recent', bench.clock);
    bench.store.subjects.markSearched(subject.id, 'newest', bench.clock);

    const report = await run();

    expect(report.details).toMatchObject({ newVideos: 0, leftPending: 0 });
    expect(bench.youtube.callsTo('videos')).toHaveLength(1);
    expect(PENDING_HIT_MAX_AGE_MS).toBe(DAY_MS);
  });

  test('does not pay again for a video found too long, or one the details did not return', async () => {
    const subject = add({ keyword: 'night sky', region: 'CA' });
    bench.youtube.setSearch('night sky', 'CA', [hit(1, 'A'), hit(2, 'B'), hit(3, 'C')]);
    bench.youtube.setVideo(1, 'A');
    bench.youtube.setVideo(2, 'B', { duration: 'PT10M' });

    const first = await run();
    bench.clock = at(DAY_MS);
    const second = await run();

    expect(first.details).toMatchObject({ newVideos: 1, tooLong: 1, notReturned: 1 });
    expect(bench.store.passedOver.knownIds([videoId(1), videoId(2), videoId(3)])).toEqual([
      videoId(2),
      videoId(3),
    ]);
    expect(second.searched[0]).toMatchObject({ subjectId: subject.id, hits: 3 });
    expect(second.details).toMatchObject({ newVideos: 0, tooLong: 0, notReturned: 0 });
    expect(bench.youtube.callsTo('videos')).toHaveLength(1);
    // A day on both kinds of search are due again: two searches, and no details to pay for.
    expect(bench.quota.usage('2026-11-21').byKind.search).toBe(200);
  });

  test('does not write off many results when the details come back empty', async () => {
    add({ keyword: 'night sky', region: 'CA' });
    const numbers = [1, 2, 3, 4, 5, 6];
    bench.youtube.setSearch(
      'night sky',
      'CA',
      numbers.map((n) => hit(n, 'A')),
    );

    const report = await run();

    expect(report.details).toMatchObject({ notReturned: 0, leftPending: 6 });
    expect(bench.store.passedOver.knownIds(numbers.map(videoId))).toEqual([]);
  });

  test('says when a search answered with nothing readable, apart from a search that found nothing', async () => {
    const [paper, bread] = addSubjects();
    bench.youtube.setSearch('paper folding', 'US', [{ id: {} }, { snippet: 7 }]);

    const report = await run();

    expect(report.searched.find((outcome) => outcome.subjectId === paper!.id)).toMatchObject({
      result: 'unreadable',
      hits: 0,
      skipped: 2,
    });
    expect(report.searched.find((outcome) => outcome.subjectId === bread!.id)).toMatchObject({
      result: 'searched',
      hits: 0,
      skipped: 0,
    });
  });

  test('counts details that could not be read', async () => {
    oneFind();
    bench.youtube.setRawVideo(1, { id: videoId(1), snippet: { title: 42 } });

    const report = await run();

    expect(report.searched[0]).toMatchObject({ result: 'searched', skipped: 0 });
    // An unreadable entry may be the video asked for, so the result goes on waiting.
    expect(report.details).toMatchObject({ newVideos: 0, skipped: 1, leftPending: 1 });
  });

  test('stops before the next subject when the lease was lost', async () => {
    const subjects = addSubjects();
    const lost = new AbortController();
    const api = {
      ...bench.api,
      searchRecentVideos: async (...args: Parameters<typeof bench.api.searchRecentVideos>) => {
        lost.abort();
        return bench.api.searchRecentVideos(...args);
      },
    };

    const report = await runSearchCycle({ ...bench, api }, lost.signal);

    expect(report.searched).toHaveLength(1);
    expect(report.leftUndone).toEqual(subjects.slice(1).map(top));
    expect(report.stopped).toBe('lease_lost');
    expect(report.channels.stopped).toBe('lease_lost');
    expect(bench.youtube.callsTo('channels')).toEqual([]);
  });
});

describe('reading queued channels', () => {
  const reads = (signal?: AbortSignal) => readQueuedChannels(bench, signal);

  test('does not read again a channel whose facts were read within 24 hours', async () => {
    oneFind();
    bench.store.channels.upsert(channelFacts('A'), at(-CHANNEL_REREAD_AFTER_MS + 1));

    const report = await run();

    expect(report.channels.read).toBe(0);
    expect(bench.youtube.callsTo('channels')).toEqual([]);
    expect(CHANNEL_REREAD_AFTER_MS).toBe(24 * HOUR_MS);
  });

  test('reads again a known channel whose facts are a day old when a new video of it is found', async () => {
    oneFind();
    bench.store.channels.upsert(channelFacts('A', { subscribers: 10 }), at(-DAY_MS));

    await run();

    expect(bench.youtube.callsTo('channels')).toHaveLength(1);
    expect(bench.store.channels.get(channelId('A'))).toMatchObject({
      subscribers: 890,
      fetchedAt: NOW,
    });
  });

  test('keeps a video whose channel the API does not return, and stops asking for the channel', async () => {
    const subject = add({ keyword: 'bicycle repair', region: 'AU' });
    bench.youtube.setSearch('bicycle repair', 'AU', [hit(4, 'D')]);
    bench.youtube.setVideo(4, 'D');

    const report = await run();

    expect(report.channels).toMatchObject({ read: 0, unavailable: 1, leftQueued: 0 });
    expect(bench.store.hits.videoIdsFor(subject.id)).toEqual([videoId(4)]);
    expect(bench.store.channels.get(channelId('D'))).toMatchObject({
      title: 'Channel D',
      createdAt: null,
      readQueuedAt: null,
    });
  });

  test('asks for fifty channels at a time and keeps the first fifty when the second request fails', async () => {
    const letters = Array.from({ length: 60 }, (_, n) => `UC${String(n).padStart(22, 'c')}`);
    letters.forEach((id, n) =>
      bench.store.channels.queueRead({
        id,
        title: null,
        now: at(n * 1000),
        staleBefore: at(-DAY_MS),
      }),
    );
    bench.youtube.refuse((call) => (call.params['id'] ?? '').split(',').length === 10, 500);

    const report = await reads();

    expect(bench.youtube.callsTo('channels')).toHaveLength(2);
    expect(report).toMatchObject({ unavailable: 50, leftQueued: 10, stopped: null });
    expect(report.failure).toMatch(/refused the request \(500\)/);
    expect(bench.store.channels.listQueued()).toHaveLength(10);
  });

  test('leaves a channel queued when the reply held an entry that could not be read', async () => {
    bench.store.channels.queueRead({
      id: channelId('A'),
      title: null,
      now: NOW,
      staleBefore: at(-DAY_MS),
    });
    bench.youtube.setChannel('A', { snippet: 'not a snippet' });

    const report = await reads();

    expect(report).toMatchObject({ read: 0, unavailable: 0, skipped: 1, gaveUp: 0, leftQueued: 1 });
  });

  test('gives up on a channel that stays unreadable after three reads', async () => {
    bench.store.channels.queueRead({
      id: channelId('A'),
      title: null,
      now: NOW,
      staleBefore: at(-DAY_MS),
    });
    bench.youtube.setChannel('A', { snippet: 'not a snippet' });

    await reads();
    await reads();
    const third = await reads();
    const fourth = await reads();

    expect(MAX_CHANNEL_READ_ATTEMPTS).toBe(3);
    expect(third).toMatchObject({ skipped: 1, gaveUp: 1, unavailable: 0, leftQueued: 0 });
    expect(fourth).toMatchObject({ read: 0, leftQueued: 0 });
    expect(bench.youtube.callsTo('channels')).toHaveLength(3);
    expect(bench.store.channels.get(channelId('A'))?.readQueuedAt).toBeNull();
  });

  test('counts unreadable reads afresh once the channel has been read', async () => {
    const queue = (): boolean =>
      bench.store.channels.queueRead({
        id: channelId('A'),
        title: null,
        now: bench.clock,
        staleBefore: bench.clock,
      });
    queue();
    bench.youtube.setChannel('A', { snippet: 'not a snippet' });
    await reads();
    await reads();
    bench.youtube.setChannel('A');
    await reads();
    queue();
    bench.youtube.setChannel('A', { snippet: 'not a snippet' });

    const report = await reads();

    expect(report).toMatchObject({ gaveUp: 0, leftQueued: 1 });
  });

  test('stamps a channel with the time of the reply that brought its facts', async () => {
    bench.store.channels.queueRead({
      id: channelId('A'),
      title: null,
      now: NOW,
      staleBefore: at(-DAY_MS),
    });
    bench.youtube.setChannel('A');
    let looks = 0;

    await readQueuedChannels({ ...bench, now: () => at(looks++ * 1000) });

    expect(bench.store.channels.get(channelId('A'))?.fetchedAt).toEqual(at(0));
  });

  test('stops for a pause, or because the lease was lost, without a failure', async () => {
    bench.store.channels.queueRead({
      id: channelId('A'),
      title: null,
      now: NOW,
      staleBefore: at(-DAY_MS),
    });
    bench.youtube.refuse(() => true, 429, refusalBody('userRateLimitExceeded'));
    const lost = new AbortController();
    lost.abort();

    expect(await reads()).toMatchObject({ stopped: 'rate_limit', failure: null, leftQueued: 1 });
    expect(await reads(lost.signal)).toMatchObject({ stopped: 'lease_lost', leftQueued: 1 });
  });

  test('makes no request when nothing is queued', async () => {
    expect(await reads()).toEqual({
      read: 0,
      followed: 0,
      unavailable: 0,
      skipped: 0,
      gaveUp: 0,
      leftQueued: 0,
      stopped: null,
      failure: null,
    });
    expect(bench.youtube.calls).toEqual([]);
  });
});
