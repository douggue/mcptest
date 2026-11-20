import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SHUTDOWN } from '../src/cycleStop';
import { readQueuedChannels } from '../src/discover/channelReads';
import {
  DEFAULT_FOLLOW,
  DEFAULT_FOLLOW_MAX_ACCOUNT_AGE_DAYS,
  DEFAULT_FOLLOW_MAX_SUBSCRIBERS,
  UNFOLLOW_AFTER_DAYS,
  shouldFollow,
} from '../src/discover/follow';
import {
  UPLOADS_COST_UNITS,
  UPLOADS_READ_EVERY_MS,
  runUploadsCycle,
} from '../src/discover/followedUploads';
import { planFor } from '../src/quota/ledger';
import { channelId, uploadsId, videoId } from './fixtures/apiReplies';
import { DAY_MS, HOUR_MS, NOW, at, channelFacts, videoFacts } from './fixtures/facts';
import { openBench, refusalBody, type Bench } from './helpers/fakeYouTube';

let bench: Bench;

beforeEach(() => {
  bench = openBench();
});

afterEach(() => {
  bench.db.close();
});

const OLD_ACCOUNT = at(-900 * DAY_MS);

describe('shouldFollow', () => {
  test.each([
    ['a small channel with an old account', 890, OLD_ACCOUNT, true],
    ['a channel exactly at the ceiling', 100_000, OLD_ACCOUNT, true],
    ['a channel just over the ceiling with an old account', 100_001, OLD_ACCOUNT, false],
    ['a large channel whose account is new', 2_000_000, at(-30 * DAY_MS), true],
    ['a channel with a hidden count and an old account', null, OLD_ACCOUNT, false],
    ['a channel with a hidden count and a new account', null, at(-179 * DAY_MS), true],
    ['a large channel whose account is exactly the age limit', 500_000, at(-180 * DAY_MS), false],
  ])('answers for %s', (_what, subscribers, createdAt, followed) => {
    expect(shouldFollow({ subscribers, createdAt }, DEFAULT_FOLLOW, NOW)).toBe(followed);
  });

  test('uses the limits it is given, whose defaults are starting values', () => {
    const strict = { maxSubscribers: 500, maxAccountAgeDays: 0 };

    expect(shouldFollow({ subscribers: 890, createdAt: OLD_ACCOUNT }, strict, NOW)).toBe(false);
    expect(shouldFollow({ subscribers: 400, createdAt: OLD_ACCOUNT }, strict, NOW)).toBe(true);
    expect(DEFAULT_FOLLOW_MAX_SUBSCRIBERS).toBe(100_000);
    expect(DEFAULT_FOLLOW_MAX_ACCOUNT_AGE_DAYS).toBe(180);
  });
});

describe('reading a channel’s facts', () => {
  const queue = (letter: string): void => {
    bench.store.channels.queueRead({
      id: channelId(letter),
      title: null,
      now: bench.clock,
      staleBefore: bench.clock,
    });
  };

  test('follows a small channel from the moment its facts are read, and not a large old one', async () => {
    queue('A');
    queue('B');
    bench.youtube.setChannel('A');
    bench.youtube.setChannel('B', {
      snippet: { title: 'Channel B', publishedAt: '2019-03-01T10:00:00Z' },
      statistics: { subscriberCount: '4500000', hiddenSubscriberCount: false },
    });

    const report = await readQueuedChannels(bench);

    expect(report).toMatchObject({ read: 2, followed: 1 });
    expect(bench.store.channels.get(channelId('A'))).toMatchObject({
      followed: true,
      lastTrackedUploadAt: NOW,
    });
    expect(bench.store.channels.get(channelId('B'))?.followed).toBe(false);
    expect(bench.store.follows.countFollowed()).toBe(1);
  });

  test('stops following a channel that has grown past the ceiling when its facts are read again', async () => {
    queue('A');
    bench.youtube.setChannel('A', {
      snippet: { title: 'Channel A', publishedAt: '2019-03-01T10:00:00Z' },
    });
    await readQueuedChannels(bench);
    bench.clock = at(2 * DAY_MS);
    queue('A');
    bench.youtube.setChannel('A', {
      snippet: { title: 'Channel A', publishedAt: '2019-03-01T10:00:00Z' },
      statistics: { subscriberCount: '250000', hiddenSubscriberCount: false },
    });

    await readQueuedChannels(bench);

    expect(bench.store.channels.get(channelId('A'))?.followed).toBe(false);
  });

  test('follows by the limits it is given', async () => {
    queue('A');
    bench.youtube.setChannel('A');

    const report = await readQueuedChannels({
      ...bench,
      follow: { maxSubscribers: 100, maxAccountAgeDays: 0 },
    });

    expect(report.followed).toBe(0);
  });
});

/** A followed channel whose feed has failed, so that its uploads list is the route left. */
function followWithoutFeed(letter: string, readAt: Date | null = null): string {
  const id = channelId(letter);
  bench.store.channels.upsert(channelFacts(letter), NOW);
  bench.store.follows.setFollowed(id, true, NOW);
  bench.store.follows.noteFeedFailure(id, NOW, at(HOUR_MS));
  if (readAt !== null) bench.store.follows.noteUploadsRead(id, readAt);
  return id;
}

describe('a round of uploads lists', () => {
  const run = (signal?: AbortSignal) => runUploadsCycle(bench, signal);

  test('reads the newest page of the list of a followed channel whose feed is failing, and tracks its new Shorts', async () => {
    const id = followWithoutFeed('A');
    bench.youtube.setPlaylist(uploadsId('A'), [1, 2, 3, 4]);
    bench.youtube.setVideo(1, 'A', { publishedAt: at(-5 * HOUR_MS) });
    bench.youtube.setVideo(2, 'A', { duration: 'PT9M' });
    bench.youtube.setVideo(3, 'A', { publishedAt: at(-40 * DAY_MS) });

    const report = await run();

    expect(report).toEqual({
      unfollowed: 0,
      channels: 1,
      notFound: 0,
      leftUnread: 0,
      finds: {
        newVideos: 1,
        tooLong: 1,
        tooOld: 1,
        notReturned: 1,
        skipped: 0,
        stopped: null,
        failure: null,
      },
      stopped: null,
      failure: null,
    });
    expect(bench.youtube.callsTo('playlistItems')[0]?.params).toMatchObject({
      playlistId: uploadsId('A'),
      maxResults: '50',
    });
    // By length only: the uploads list holds every kind of video.
    expect(bench.store.tracking.get(videoId(1))?.isShort).toBe('yes');
    expect(bench.store.hits.listForVideo(videoId(1))[0]).toMatchObject({
      subjectId: null,
      kind: 'channel_uploads',
      rank: null,
      ageHours: 5,
    });
    expect(bench.store.channels.get(id)?.uploadsReadAt).toEqual(NOW);
    expect(bench.quota.usage('2026-11-20').byKind).toMatchObject({ channel: 2, reading: 0 });
    expect(UPLOADS_COST_UNITS).toBe(2);
  });

  test('leaves alone a followed channel whose feed answers, and one read within the day', async () => {
    bench.store.channels.upsert(channelFacts('A'), NOW);
    bench.store.follows.setFollowed(channelId('A'), true, NOW);
    followWithoutFeed('B', at(-UPLOADS_READ_EVERY_MS + 1));
    const due = followWithoutFeed('C', at(-UPLOADS_READ_EVERY_MS));
    bench.youtube.setPlaylist(uploadsId('C'), []);

    const report = await run();

    expect(report).toMatchObject({ channels: 1, leftUnread: 0 });
    expect(bench.youtube.callsTo('playlistItems')).toHaveLength(1);
    expect(bench.store.channels.get(due)?.uploadsReadAt).toEqual(NOW);
    expect(UPLOADS_READ_EVERY_MS).toBe(DAY_MS);
  });

  test('does not pay again for videos it has seen: the second day costs the list alone', async () => {
    followWithoutFeed('A');
    bench.youtube.setPlaylist(uploadsId('A'), [1, 2]);
    bench.youtube.setVideo(1, 'A');
    bench.youtube.setVideo(2, 'A', { duration: 'PT9M' });
    await run();
    bench.clock = at(DAY_MS);

    const second = await run();

    expect(second.finds.newVideos).toBe(0);
    expect(bench.youtube.callsTo('videos')).toHaveLength(1);
    expect(bench.quota.usage('2026-11-21').byKind.channel).toBe(1);
  });

  test('reads the least-recently-read channels first, as far as the channel share pays', async () => {
    bench.db.close();
    bench = openBench(planFor(40));
    followWithoutFeed('A', at(-2 * DAY_MS));
    followWithoutFeed('B', at(-5 * DAY_MS));
    followWithoutFeed('C');
    ['A', 'B', 'C'].forEach((letter, index) => {
      bench.youtube.setPlaylist(uploadsId(letter), [index + 1]);
      bench.youtube.setVideo(index + 1, letter);
    });

    const report = await run();

    // Forty units a day leave four for channels: two channels at two units each.
    expect(report).toMatchObject({ channels: 2, leftUnread: 1, stopped: 'allowance' });
    expect(bench.youtube.callsTo('playlistItems').map((call) => call.params['playlistId'])).toEqual(
      [uploadsId('C'), uploadsId('B')],
    );
  });

  test('counts a list the API does not know as read, so it is not asked for again that day', async () => {
    followWithoutFeed('A');

    const report = await run();
    bench.clock = at(HOUR_MS);
    const again = await run();

    expect(report).toMatchObject({ channels: 1, notFound: 1 });
    expect(again.channels).toBe(0);
  });

  test('lets go of a channel with no tracked upload for 14 days, and keeps one with a recent upload', async () => {
    const quiet = followWithoutFeed('A');
    const lively = followWithoutFeed('B');
    bench.clock = at(UNFOLLOW_AFTER_DAYS * DAY_MS + 1);
    bench.store.follows.noteTrackedUpload(lively, at(10 * DAY_MS));
    bench.youtube.setPlaylist(uploadsId('B'), []);

    const report = await run();

    expect(report).toMatchObject({ unfollowed: 1, channels: 1 });
    expect(bench.store.channels.get(quiet)?.followed).toBe(false);
    expect(bench.store.channels.get(lively)?.followed).toBe(true);
    expect(UNFOLLOW_AFTER_DAYS).toBe(14);
  });

  test('does not let go at once of a channel followed today whose last tracked upload is old', async () => {
    const id = channelId('A');
    bench.store.channels.upsert(channelFacts('A'), NOW);
    bench.store.follows.noteTrackedUpload(id, at(-40 * DAY_MS));
    bench.store.follows.setFollowed(id, true, NOW);

    const report = await run();

    expect(report.unfollowed).toBe(0);
    expect(bench.store.channels.get(id)?.followed).toBe(true);
  });

  test.each([
    ['the day is spent', 'quotaExceeded', 'allowance'],
    ['requests come too fast', 'rateLimitExceeded', 'rate_limit'],
  ])('stops cleanly when Google says %s', async (_what, reason, stopped) => {
    followWithoutFeed('A');
    followWithoutFeed('B');
    bench.youtube.refuse(() => true, 403, refusalBody(reason));

    const report = await run();

    expect(report).toMatchObject({ channels: 0, leftUnread: 2, stopped, failure: null });
    expect(bench.youtube.callsTo('playlistItems')).toHaveLength(1);
  });

  test('ends the round, saying why, when a list cannot be read for another reason', async () => {
    followWithoutFeed('A');
    bench.youtube.refuse((call) => call.path === 'playlistItems', 500);

    const report = await run();

    expect(report.stopped).toBeNull();
    expect(report.failure).toMatch(/refused the request \(500\)/);
    expect(report.leftUnread).toBe(1);
  });

  test('stops after a channel whose details stopped, having counted its list as read', async () => {
    const first = followWithoutFeed('A');
    followWithoutFeed('B');
    bench.youtube.setPlaylist(uploadsId('A'), [1]);
    bench.youtube.refuse((call) => call.path === 'videos', 403, refusalBody('rateLimitExceeded'));

    const report = await run();

    expect(report).toMatchObject({ channels: 1, leftUnread: 1, stopped: 'rate_limit' });
    expect(bench.store.channels.get(first)?.uploadsReadAt).toEqual(NOW);
  });

  test('stops before the next channel when the service is stopping', async () => {
    followWithoutFeed('A');
    const halt = new AbortController();
    halt.abort(SHUTDOWN);

    const report = await run(halt.signal);

    expect(report).toMatchObject({ channels: 0, leftUnread: 1, stopped: 'shutdown' });
    expect(bench.youtube.calls).toEqual([]);
  });

  test('notes a tracked upload against its channel, which keeps the channel followed', async () => {
    const id = followWithoutFeed('A');
    bench.clock = at(3 * DAY_MS);
    bench.youtube.setPlaylist(uploadsId('A'), [1]);
    bench.youtube.setVideo(1, 'A', { publishedAt: at(2 * DAY_MS) });

    await run();

    expect(bench.store.channels.get(id)?.lastTrackedUploadAt).toEqual(at(3 * DAY_MS));
    expect(bench.store.videos.get(videoFacts(1, 'A').id)).not.toBeNull();
  });
});
