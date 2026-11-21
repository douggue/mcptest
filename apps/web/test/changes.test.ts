import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/lib/api';
import {
  SINCE_OPTIONS,
  breakoutBefore,
  describeFreshness,
  describeLookalikes,
  describeSince,
  groupLine,
  hasNothingNew,
  moreBreakouts,
  uncomparedNote,
  type ChangesReply,
} from '../src/lib/changes';
import { createExtrasApi } from '../src/lib/extrasApi';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const NOW = new Date('2026-11-21T12:00:00Z');
const HOUR_MS = 3_600_000;
const hoursAgo = (hours: number): string => new Date(NOW.getTime() - hours * HOUR_MS).toISOString();

const reply = (overrides: Partial<ChangesReply> = {}): ChangesReply => ({
  centerChannelId: CHANNEL,
  since: hoursAgo(7 * 24),
  now: NOW.toISOString(),
  asked: 'last-look',
  sinceKind: 'last-look',
  lastLookAt: hoursAgo(7 * 24),
  changes: {
    comparedChannels: 12,
    uncomparedChannels: 0,
    newBreakouts: [],
    newBreakoutCount: 0,
    groups: { takenOff: [], rising: [], droppedOut: [] },
    formats: [],
  },
  lookalikes: { comparable: false, reason: 'same-map' },
  freshness: {
    channels: 12,
    oldestReadAt: hoursAgo(30),
    newestReadAt: hoursAgo(3),
    lastRefreshAt: hoursAgo(3),
  },
  ...overrides,
});

const breakout = {
  videoId: 'aaaaaaaaaa1',
  title: 'A title',
  channelId: CHANNEL,
  channelTitle: 'Alike',
  views: 9000,
  score: 7.5,
  ageDays: 3,
  publishedRaw: '3d ago',
  was: 'below' as const,
  viewsThen: 1100,
  scoreThen: 1.1,
};

describe('describeSince', () => {
  test('names the moment the comparison starts from', () => {
    expect(describeSince(reply(), NOW)).toBe('Since you last marked this as seen, 7 days ago.');
    expect(describeSince(reply({ asked: 'yesterday', sinceKind: 'yesterday' }), NOW)).toBe(
      'Since this time yesterday.',
    );
    expect(describeSince(reply({ asked: 'week', sinceKind: 'week' }), NOW)).toBe(
      'Over the last 7 days.',
    );
  });

  test('says so when "last look" was asked and the channel was never marked as seen', () => {
    expect(describeSince(reply({ sinceKind: 'week', lastLookAt: null }), NOW)).toBe(
      'You have not marked this channel as seen yet, so this covers the last 7 days.',
    );
  });

  test('offers the three moments', () => {
    expect(SINCE_OPTIONS.map((option) => option.id)).toEqual(['last-look', 'yesterday', 'week']);
  });
});

describe('hasNothingNew', () => {
  test('is true when nothing of any kind changed', () => {
    expect(hasNothingNew(reply())).toBe(true);
  });

  test('is false as soon as one thing changed', () => {
    const changes = reply().changes;
    expect(
      hasNothingNew(
        reply({ changes: { ...changes, newBreakouts: [breakout], newBreakoutCount: 1 } }),
      ),
    ).toBe(false);
    expect(
      hasNothingNew(
        reply({
          lookalikes: {
            comparable: true,
            earlierMapMadeAt: hoursAgo(200),
            added: [{ channelId: CHANNEL, title: 'New' }],
            gone: [],
          },
        }),
      ),
    ).toBe(false);
    expect(
      hasNothingNew(
        reply({
          changes: {
            ...changes,
            groups: {
              takenOff: [],
              rising: [],
              droppedOut: [{ channelId: CHANNEL, title: 'Was', was: 'rising', now: 'neither' }],
            },
          },
        }),
      ),
    ).toBe(false);
  });
});

describe('the lines of a change', () => {
  test('say what a new breakout was before', () => {
    expect(breakoutBefore(breakout)).toBe('Was 1.1× with 1.1K views then.');
    expect(breakoutBefore({ ...breakout, scoreThen: null })).toBe(
      'Had 1.1K views then, too few videos to score.',
    );
    expect(
      breakoutBefore({ ...breakout, was: 'not-stored', viewsThen: null, scoreThen: null }),
    ).toBe('Not stored then: published or first read since.');
  });

  test('say how many more breakouts there are than are shown', () => {
    const changes = { ...reply().changes, newBreakouts: [breakout], newBreakoutCount: 4 };
    expect(moreBreakouts(changes)).toBe('And 3 more, lower down the breakout list below.');
    expect(moreBreakouts({ ...changes, newBreakoutCount: 1 })).toBeNull();
  });

  test('say what group a channel moved from and to', () => {
    expect(
      groupLine({ channelId: CHANNEL, title: 'Alike', was: 'neither', now: 'taken-off' }),
    ).toBe('Alike: was neither, has now taken off');
    expect(
      groupLine({ channelId: CHANNEL, title: 'Alike', was: 'taken-off', now: 'neither' }),
    ).toBe('Alike: had taken off, is now neither');
    expect(groupLine({ channelId: CHANNEL, title: 'Alike', was: 'rising', now: 'taken-off' })).toBe(
      'Alike: was rising, has now taken off',
    );
    expect(groupLine({ channelId: CHANNEL, title: 'Alike', was: 'neither', now: 'rising' })).toBe(
      'Alike: was neither, is now rising',
    );
  });

  test('say why the look-alikes could not be compared', () => {
    expect(describeLookalikes(reply().lookalikes)).toBe(
      'The map has not been made again since then, so the look-alikes are the same.',
    );
    expect(describeLookalikes({ comparable: false, reason: 'no-earlier-map' })).toBe(
      'This channel had no map yet at that time, so there is no earlier list of look-alikes to compare with.',
    );
    expect(describeLookalikes({ comparable: false, reason: 'older-form' })).toBe(
      'The earlier map was stored under older matching rules, so its look-alikes cannot be compared.',
    );
    expect(
      describeLookalikes({
        comparable: true,
        earlierMapMadeAt: hoursAgo(100),
        added: [],
        gone: [],
      }),
    ).toBe('The map was made again and its look-alikes are the same.');
    expect(
      describeLookalikes({
        comparable: true,
        earlierMapMadeAt: hoursAgo(100),
        added: [{ channelId: CHANNEL, title: 'New' }],
        gone: [],
      }),
    ).toBeNull();
  });

  test('say how many look-alikes had no earlier reading', () => {
    expect(uncomparedNote(reply().changes)).toBeNull();
    expect(uncomparedNote({ ...reply().changes, uncomparedChannels: 2 })).toBe(
      '2 look-alikes had not been read before that time, so nothing of theirs can be called new yet.',
    );
    expect(uncomparedNote({ ...reply().changes, comparedChannels: 0, uncomparedChannels: 5 })).toBe(
      'None of the 5 look-alikes had been read before that time, so there is nothing to compare with yet. Refresh, and look again tomorrow.',
    );
  });
});

describe('describeFreshness', () => {
  test('says when the look-alikes were last read, and that some are older', () => {
    expect(describeFreshness(reply().freshness, NOW)).toEqual({
      text: 'The 12 look-alikes were last read between 30 hours and 3 hours ago; the last refresh finished 3 hours ago.',
      stale: true,
    });
  });

  test('is not stale when every look-alike was read in the last day', () => {
    const fresh = describeFreshness(
      { channels: 3, oldestReadAt: hoursAgo(5), newestReadAt: hoursAgo(5), lastRefreshAt: null },
      NOW,
    );
    expect(fresh).toEqual({
      text: 'The 3 look-alikes were last read 5 hours ago; no refresh has run yet.',
      stale: false,
    });
  });

  test('says so when the map has no look-alikes', () => {
    expect(
      describeFreshness(
        { channels: 0, oldestReadAt: null, newestReadAt: null, lastRefreshAt: null },
        NOW,
      ),
    ).toEqual({
      text: 'This map has no look-alikes yet, so there is nothing to compare.',
      stale: false,
    });
  });
});

describe('the changes API', () => {
  const recording = (data: unknown, status = 200) => {
    const sent: string[] = [];
    const api = createExtrasApi(async (url, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`.trim());
      return new Response(
        JSON.stringify({ success: status < 400, data, error: status < 400 ? null : 'No map' }),
        { status },
      );
    });
    return { api, sent };
  };

  test('reads what changed for a channel and a moment', async () => {
    const { api, sent } = recording(reply());

    await expect(api.changes(CHANNEL, 'yesterday')).resolves.toEqual(reply());
    expect(sent).toEqual([`GET /api/changes?channel=${CHANNEL}&since=yesterday`]);
  });

  test('gives nothing for a channel with no map, and the reason for any other refusal', async () => {
    await expect(recording(null, 404).api.changes(CHANNEL, 'week')).resolves.toBeNull();
    await expect(recording(null, 400).api.changes(CHANNEL, 'week')).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  test('marks a channel as seen', async () => {
    const { api, sent } = recording({ lastLookAt: NOW.toISOString() });

    await expect(api.markSeen(CHANNEL)).resolves.toBe(NOW.toISOString());
    expect(sent).toEqual([`POST /api/changes/seen {"channel":"${CHANNEL}"}`]);
  });
});
