import { describe, expect, test } from 'vitest';
import {
  alertLine,
  badgeText,
  freshnessNote,
  parseMinScore,
  ruleSummary,
  type AlertsReply,
  type AlertView,
} from '../src/lib/alerts';
import { createExtrasApi } from '../src/lib/extrasApi';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const NOW = new Date('2026-11-21T12:00:00Z');
const hoursAgo = (hours: number): string =>
  new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const breakout: AlertView = {
  id: 1,
  kind: 'breakout',
  subjectId: 'aaaaaaaaaa1',
  channelId: CHANNEL,
  channelTitle: 'Alike',
  videoTitle: 'A title',
  score: 7.46,
  views: 52_000,
  foundAt: hoursAgo(2),
  read: false,
};

const reply: AlertsReply = {
  centerChannelId: CHANNEL,
  rule: null,
  defaultMinScore: 5,
  minMinScore: 2,
  maxMinScore: 100,
  alerts: [breakout],
  unread: 1,
  lastRefreshAt: hoursAgo(3),
};

describe('alertLine', () => {
  test("says what a breakout alert found, with the score labelled as the channel's usual", () => {
    expect(alertLine(breakout)).toBe("Alike: 7.5× its channel's usual views, 52K views so far.");
  });

  test('says a channel newly counts as taken off', () => {
    expect(
      alertLine({ ...breakout, kind: 'taken-off', videoTitle: null, score: null, views: null }),
    ).toBe('Alike now counts as taken off on this map.');
  });
});

describe('ruleSummary', () => {
  test('says what the rule tells of, or that none is set or it is off', () => {
    expect(ruleSummary(null, 5)).toBe(
      'No alert rule yet. The suggested number is 5×: a look-alike video at 5× its channel’s usual views or more.',
    );
    const rule = {
      minScore: 6,
      takenOff: true,
      enabled: true,
      createdAt: hoursAgo(50),
      checkedAt: hoursAgo(3),
    };
    expect(ruleSummary(rule, 5)).toBe(
      'Telling you of a look-alike video at 6× its channel’s usual views or more, and of a look-alike that newly takes off.',
    );
    expect(ruleSummary({ ...rule, takenOff: false }, 5)).toBe(
      'Telling you of a look-alike video at 6× its channel’s usual views or more.',
    );
    expect(ruleSummary({ ...rule, enabled: false }, 5)).toBe('Alerts are off for this channel.');
  });
});

describe('parseMinScore', () => {
  test('reads a number in the range, and says the range otherwise', () => {
    expect(parseMinScore('6.5', 2, 100)).toEqual({ ok: true, value: 6.5 });
    expect(parseMinScore(' 3 ', 2, 100)).toEqual({ ok: true, value: 3 });
    const refused = { ok: false, message: 'Give a number from 2 to 100.' };
    expect(parseMinScore('1', 2, 100)).toEqual(refused);
    expect(parseMinScore('abc', 2, 100)).toEqual(refused);
    expect(parseMinScore('', 2, 100)).toEqual(refused);
  });
});

describe('freshnessNote', () => {
  test('says an alert is only as fresh as the last refresh', () => {
    expect(freshnessNote(reply.lastRefreshAt, NOW)).toBe(
      'Checked after each refresh; the last was 3 hours ago.',
    );
    expect(freshnessNote(null, NOW)).toBe(
      'Alerts are checked after each refresh; none has run yet.',
    );
  });
});

describe('badgeText', () => {
  test('shows the count up to nine, then 9+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(3)).toBe('3');
    expect(badgeText(12)).toBe('9+');
  });
});

describe('the alerts API', () => {
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

  test("reads a channel's alerts, or nothing when it has no map", async () => {
    const { api, sent } = recording(reply);
    await expect(api.alerts(CHANNEL)).resolves.toEqual(reply);
    expect(sent).toEqual([`GET /api/alerts?channel=${CHANNEL}`]);
    await expect(recording(null, 404).api.alerts(CHANNEL)).resolves.toBeNull();
  });

  test('reads the unread counts', async () => {
    const { api, sent } = recording({ counts: { [CHANNEL]: 2 } });
    await expect(api.alertCounts()).resolves.toEqual({ [CHANNEL]: 2 });
    expect(sent).toEqual(['GET /api/alerts/counts']);
  });

  test('saves a rule and marks alerts read', async () => {
    const { api, sent } = recording(reply);
    const settings = { minScore: 6, takenOff: true, enabled: true };
    await expect(api.saveAlertRule(CHANNEL, settings)).resolves.toEqual(reply);
    await expect(api.markAlertsRead(CHANNEL)).resolves.toEqual(reply);
    expect(sent).toEqual([
      `POST /api/alerts/rule {"channel":"${CHANNEL}","minScore":6,"takenOff":true,"enabled":true}`,
      `POST /api/alerts/read {"channel":"${CHANNEL}"}`,
    ]);
  });
});
