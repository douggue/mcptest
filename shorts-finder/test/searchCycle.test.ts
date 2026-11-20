import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SEARCH_WINDOW_DAYS, runSearchCycle } from '../src/discover/searchCycle';
import { CHANNEL_REREAD_AFTER_MS, readQueuedChannels } from '../src/discover/channelReads';
import { planFor } from '../src/quota/ledger';
import type { Subject } from '../src/repos/types';
import { createSubject } from '../src/subjects/subject';
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

/** Four subjects in unrelated niches, one in each of four countries. */
function addSubjects(): readonly Subject[] {
  return [
    createSubject({ keyword: 'paper folding', region: 'US', language: 'en' }),
    createSubject({ keyword: 'sourdough starter', region: 'GB', language: 'en' }),
    createSubject({ keyword: 'night sky', region: 'CA' }),
    createSubject({ keyword: 'bicycle repair', region: 'AU', language: 'en' }),
  ].map((subject) => bench.store.subjects.add(subject));
}

/** One subject whose search finds video 1 of channel A, with both in the world. */
function oneFind(): Subject {
  const subject = bench.store.subjects.add(
    createSubject({ keyword: 'paper folding', region: 'US', language: 'en' }),
  );
  bench.youtube.setSearch('paper folding', 'US', [hit(1, 'A')]);
  bench.youtube.setVideo(1, 'A', { views: 1200 });
  bench.youtube.setChannel('A');
  return subject;
}

describe('a search cycle', () => {
  test('asks for short videos of the last seven days in the subject’s country and language', async () => {
    oneFind();

    await run();

    expect(bench.youtube.callsTo('search')[0]?.params).toMatchObject({
      q: 'paper folding',
      regionCode: 'US',
      relevanceLanguage: 'en',
      videoDuration: 'short',
      publishedAfter: at(-7 * DAY_MS).toISOString(),
    });
    expect(SEARCH_WINDOW_DAYS).toBe(7);
  });

  test('leaves the language open for a subject with none', async () => {
    bench.store.subjects.add(createSubject({ keyword: 'night sky', region: 'CA' }));

    await run();

    expect(bench.youtube.callsTo('search')[0]?.params).not.toHaveProperty('relevanceLanguage');
  });

  test('stores a new video with its first reading, tracks it hourly and notes which search found it', async () => {
    const subject = oneFind();

    const report = await run();

    expect(report.searched).toEqual([
      { subjectId: subject.id, result: 'searched', hits: 1, newVideos: 1, tooLong: 0, skipped: 0 },
    ]);
    expect(bench.store.videos.get(videoId(1))).toMatchObject({ views: 1200, fetchedAt: NOW });
    expect(bench.store.readings.list(videoId(1), at(-HOUR_MS), NOW)).toEqual([
      { videoId: videoId(1), capturedAt: NOW, views: 1200 },
    ]);
    expect(bench.store.tracking.get(videoId(1))).toMatchObject({
      tier: 'hourly',
      nextReadAt: at(HOUR_MS),
      isShort: 'yes',
    });
    expect(bench.store.hits.videoIdsFor(subject.id)).toEqual([videoId(1)]);
    expect(bench.store.subjects.list()[0]?.lastSearchedAt).toEqual(NOW);
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
    const subject = bench.store.subjects.add(createSubject({ keyword: 'night sky', region: 'CA' }));
    bench.youtube.setSearch('night sky', 'CA', [hit(1, 'A'), hit(2, 'B'), hit(3, 'C')]);
    bench.youtube.setVideo(1, 'A', { duration: 'PT3M' });
    bench.youtube.setVideo(2, 'B', { duration: 'PT3M1S' });
    bench.youtube.setVideo(3, 'C', { duration: null });

    const report = await run();

    expect(SHORTS_MAX_SECONDS).toBe(180);
    expect(report.searched[0]).toMatchObject({ hits: 3, newVideos: 2, tooLong: 1 });
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
    expect(report.searched.map((outcome) => outcome.newVideos)).toEqual([1, 0, 0, 0]);
    expect(bench.store.hits.videoIdsFor(paper!.id)).toEqual([videoId(1)]);
    expect(bench.store.hits.videoIdsFor(bread!.id)).toEqual([videoId(1)]);
  });

  test('searches nothing that is not due, and says so by doing nothing', async () => {
    const subject = oneFind();
    bench.store.subjects.markSearched(subject.id, at(-HOUR_MS));

    const report = await run();

    expect(report).toMatchObject({ searched: [], failed: [], leftUndone: [], stopped: null });
    expect(bench.youtube.calls).toEqual([]);
  });
});

describe('a search cycle and the allowance', () => {
  test('searches only as many subjects as the search share can pay for, longest-waiting first', async () => {
    bench.db.close();
    bench = openBench(planFor(500));
    const [paper, bread, sky, bike] = addSubjects();
    bench.store.subjects.markSearched(paper!.id, at(-30 * HOUR_MS));

    const report = await run();

    // 300 units of searching pay for two subjects at 101 each.
    expect(report.searched.map((outcome) => outcome.subjectId)).toEqual([bread!.id, sky!.id]);
    expect(report.leftUndone).toEqual([bike!.id, paper!.id]);
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
    expect(report.leftUndone).toEqual(subjects.slice(1).map((subject) => subject.id));
    expect(report.stopped).toBe('allowance');
    expect(bench.store.subjects.list()[1]?.lastSearchedAt).toBeNull();
  });

  test('calls the day spent when Google itself says so, and stops', async () => {
    const subjects = addSubjects();
    bench.youtube.refuse((call) => call.path === 'search', 403, refusalBody('quotaExceeded'));

    const report = await run();

    expect(report.stopped).toBe('allowance');
    expect(report.leftUndone).toEqual(subjects.map((subject) => subject.id));
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
      { subjectId: paper!.id, reason: 'The YouTube API refused the request (500): backend error' },
    ]);
    expect(report.searched.map((outcome) => outcome.subjectId)).toContain(bread!.id);
    expect(report.searched).toHaveLength(3);
    expect(report.stopped).toBeNull();
    expect(bench.store.subjects.list()[0]?.lastSearchedAt).toEqual(NOW);
    expect(bench.store.videos.get(videoId(2))).not.toBeNull();
  });

  test('counts a subject as failed when the details of its new videos cannot be read', async () => {
    const subject = oneFind();
    bench.youtube.refuse((call) => call.path === 'videos', 503);

    const report = await run();

    expect(report.failed.map((failure) => failure.subjectId)).toEqual([subject.id]);
    expect(bench.store.videos.get(videoId(1))).toBeNull();
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

    expect(report.searched[0]).toMatchObject({ result: 'searched', newVideos: 0, skipped: 1 });
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
    expect(report.leftUndone).toEqual(subjects.slice(1).map((subject) => subject.id));
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
    const subject = bench.store.subjects.add(
      createSubject({ keyword: 'bicycle repair', region: 'AU' }),
    );
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

    expect(report).toMatchObject({ read: 0, unavailable: 0, skipped: 1, leftQueued: 1 });
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
      unavailable: 0,
      skipped: 0,
      leftQueued: 0,
      stopped: null,
      failure: null,
    });
    expect(bench.youtube.calls).toEqual([]);
  });
});
