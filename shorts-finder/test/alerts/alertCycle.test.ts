import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  ALERTS_PAUSED_UNTIL,
  ALERT_FAILURE_PAUSE_MS,
  runAlertCycle,
  type AlertSettings,
} from '../../src/alerts/alertCycle';
import {
  DIGEST_SENT_FOR_DAY,
  HEARTBEAT_SENT_FOR_DAY,
  runDailyMessages,
  type DailyDeps,
  type ServiceStats,
} from '../../src/alerts/dailyMessages';
import type { MessageOptions, SendResult } from '../../src/alerts/telegram';
import { openDatabase, type Db } from '../../src/db/sqlite';
import { openStore } from '../../src/repos/store';
import type { Store } from '../../src/repos/types';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at } from '../fixtures/facts';
import { newFinding } from '../fixtures/findings';

const SENT: SendResult = { kind: 'sent' };
const STATS: ServiceStats = {
  unitsSpent: 4321,
  dailyUnits: 10_000,
  unitsByKind: { search: 4242, reading: 60, channel: 19, reserve: 0 },
  searchesToday: 42,
  tracked: 1234,
  dueUnread: 34,
  storeBytes: null,
  lastProblem: null,
};

interface Outbox {
  readonly messages: Array<{ html: string; options: MessageOptions | undefined }>;
  /** What Telegram answers to each message in turn; `sent` once these run out. */
  answers: SendResult[];
}

let db: Db;
let store: Store;
let clock: Date;
let outbox: Outbox;

beforeEach(() => {
  db = openDatabase(':memory:');
  store = openStore(db);
  clock = NOW;
  outbox = { messages: [], answers: [] };
});

afterEach(() => {
  db.close();
});

/** NOW is 20:00 UTC on 20 November: past the default hour of 18 in UTC. */
function deps(settings: Partial<AlertSettings> = {}): DailyDeps {
  return {
    findings: store.findings,
    state: store.state,
    now: () => clock,
    send: async (html, options) => {
      outbox.messages.push({ html, options });
      return outbox.answers.shift() ?? SENT;
    },
    settings: {
      maxPerDay: 10,
      digestHour: 18,
      timeZone: 'UTC',
      rate: { low: 0.1, high: 0.5 },
      ...settings,
    },
    stats: () => STATS,
  };
}

const addFindings = (count: number): void => {
  for (let n = 1; n <= count; n += 1) store.findings.add(newFinding(n, 'A'));
};

const titlesSent = (): string[] =>
  outbox.messages.map((message) => message.html.split('\n')[1] ?? '');

describe('runAlertCycle', () => {
  test('does nothing, and says so with null, when no finding waits', async () => {
    const report = await runAlertCycle(deps());

    expect(report).toBeNull();
    expect(outbox.messages).toEqual([]);
  });

  test('sends each waiting finding oldest first, with a preview, and marks it told', async () => {
    store.findings.add(newFinding(2, 'B'));
    store.findings.add(newFinding(1, 'A'));

    const report = await runAlertCycle(deps());

    expect(report).toEqual({ sent: 2, waiting: 0, stopped: null, failure: null });
    expect(outbox.messages.map((message) => message.html.split('\n')[2])).toEqual([
      'by Channel A',
      'by Channel B',
    ]);
    expect(outbox.messages[0]?.options).toEqual({ preview: true });
    expect(store.findings.countAlertedBetween(at(-MINUTE_MS), at(MINUTE_MS))).toBe(2);
  });

  test('never sends a finding a second time', async () => {
    addFindings(2);

    await runAlertCycle(deps());
    const again = await runAlertCycle(deps());

    expect(again).toBeNull();
    expect(outbox.messages).toHaveLength(2);
  });

  test('stops at the daily limit and leaves the rest waiting', async () => {
    addFindings(5);

    const report = await runAlertCycle(deps({ maxPerDay: 3 }));
    const later = await runAlertCycle(deps({ maxPerDay: 3 }));

    expect(report).toEqual({ sent: 3, waiting: 2, stopped: null, failure: null });
    expect(later).toBeNull();
    expect(outbox.messages).toHaveLength(3);
  });

  test("counts the limit by the owner's day, not by UTC", async () => {
    addFindings(3);
    const sydney = deps({ maxPerDay: 2, timeZone: 'Australia/Sydney' });
    // 20:00 UTC on the 20th is 07:00 on the 21st in Sydney; its next day starts at 13:00 UTC.
    await runAlertCycle(sydney);

    clock = new Date('2026-11-21T12:59:00Z');
    const sameDay = await runAlertCycle(sydney);
    clock = new Date('2026-11-21T13:00:00Z');
    const nextDay = await runAlertCycle(sydney);

    expect(sameDay).toBeNull();
    expect(nextDay).toMatchObject({ sent: 1, waiting: 0 });
  });

  test('marks nothing when Telegram does not accept, and stops there', async () => {
    addFindings(3);
    outbox.answers = [SENT, { kind: 'failed', message: 'Telegram could not be reached: down' }];

    const report = await runAlertCycle(deps());

    expect(report).toEqual({
      sent: 1,
      waiting: 2,
      stopped: 'failed',
      failure: 'Telegram could not be reached: down',
    });
    expect(outbox.messages).toHaveLength(2);
    expect(store.findings.listWaiting(10).map((finding) => finding.id)).toEqual([2, 3]);
  });

  test('waits as long as Telegram asks before trying again, then carries on where it stopped', async () => {
    addFindings(2);
    outbox.answers = [{ kind: 'retry_after', seconds: 120 }];

    const first = await runAlertCycle(deps());
    clock = at(119_000);
    const tooSoon = await runAlertCycle(deps());
    clock = at(120_000);
    const after = await runAlertCycle(deps());

    expect(first).toEqual({ sent: 0, waiting: 2, stopped: 'retry_after', failure: null });
    expect(tooSoon).toBeNull();
    expect(after).toMatchObject({ sent: 2, waiting: 0 });
    expect(outbox.messages).toHaveLength(3);
    expect(titlesSent()[0]).toBe(titlesSent()[1]);
  });

  test('pauses a quarter of an hour after a fault in the settings, and remembers it in the store', async () => {
    addFindings(1);
    outbox.answers = [{ kind: 'misconfigured', message: 'Telegram cannot find the chat.' }];

    const report = await runAlertCycle(deps());

    expect(report).toMatchObject({
      stopped: 'misconfigured',
      failure: 'Telegram cannot find the chat.',
    });
    expect(store.state.get(ALERTS_PAUSED_UNTIL)).toBe(at(ALERT_FAILURE_PAUSE_MS).toISOString());
    clock = at(ALERT_FAILURE_PAUSE_MS - 1);
    expect(await runAlertCycle(deps())).toBeNull();
    clock = at(ALERT_FAILURE_PAUSE_MS);
    expect(await runAlertCycle(deps())).toMatchObject({ sent: 1 });
  });

  test('ignores a remembered pause that cannot be read', async () => {
    addFindings(1);
    store.state.set(ALERTS_PAUSED_UNTIL, 'not a time', NOW);

    expect(await runAlertCycle(deps())).toMatchObject({ sent: 1 });
  });
});

describe('runDailyMessages', () => {
  test("sends nothing before the hour of the owner's day", async () => {
    clock = new Date('2026-11-20T17:59:00Z');

    expect(await runDailyMessages(deps())).toBeNull();
    expect(outbox.messages).toEqual([]);
  });

  test('sends the summary and the still-running line from the hour on, without previews', async () => {
    clock = new Date('2026-11-20T18:00:00Z');

    const report = await runDailyMessages(deps());

    expect(report).toEqual({ digest: 'sent', heartbeat: 'sent', digested: 0, failure: null });
    expect(outbox.messages.map((message) => message.html.split('\n')[0])).toEqual([
      '<b>Shorts finder: summary for 20 November</b>',
      '<b>Shorts finder is still running</b>',
    ]);
    expect(outbox.messages[0]?.options).toBeUndefined();
    expect(outbox.messages[1]?.html).toContain('Videos being tracked: 1.2K');
  });

  test('sends each once a day, and again the next day', async () => {
    await runDailyMessages(deps());

    const sameDay = await runDailyMessages(deps());
    clock = at(DAY_MS);
    const nextDay = await runDailyMessages(deps());

    expect(sameDay).toBeNull();
    expect(nextDay).toMatchObject({ digest: 'sent', heartbeat: 'sent' });
    expect(outbox.messages).toHaveLength(4);
  });

  test('does not send again after a restart, because the store remembers the day', async () => {
    await runDailyMessages(deps());
    const reopened: DailyDeps = { ...deps(), state: openStore(db).state };

    expect(await runDailyMessages(reopened)).toBeNull();
    expect(store.state.get(DIGEST_SENT_FOR_DAY)).toBe('2026-11-20');
    expect(store.state.get(HEARTBEAT_SENT_FOR_DAY)).toBe('2026-11-20');
  });

  test("goes by the hour in the owner's time zone", async () => {
    // 20:00 UTC is 15:00 in Toronto: not yet 18.
    const toronto = deps({ timeZone: 'America/Toronto' });

    const early = await runDailyMessages(toronto);
    clock = at(3 * HOUR_MS);
    const onTime = await runDailyMessages(toronto);

    expect(early).toBeNull();
    expect(onTime).toMatchObject({ digest: 'sent' });
    expect(store.state.get(DIGEST_SENT_FOR_DAY)).toBe('2026-11-20');
  });

  test('tells of what the limit left out in the summary, and does not alert for it later', async () => {
    addFindings(5);
    const limited = deps({ maxPerDay: 2 });
    await runAlertCycle(limited);

    const report = await runDailyMessages(limited);
    clock = at(DAY_MS);
    const nextDay = await runAlertCycle(limited);

    expect(report).toMatchObject({ digest: 'sent', digested: 3 });
    expect(outbox.messages[2]?.html).toContain(
      'Found today: 5\nSent as alerts: 2\nLeft out by the daily limit: 3',
    );
    expect(outbox.messages[2]?.html).toContain('1. <a href=');
    expect(nextDay).toBeNull();
  });

  test('leaves waiting findings for their own alerts while the limit is not reached', async () => {
    addFindings(2);

    const report = await runDailyMessages(deps());

    expect(report).toMatchObject({ digested: 0 });
    expect(outbox.messages[0]?.html).toContain('Left out by the daily limit: 0');
    expect(store.findings.countWaiting()).toBe(2);
  });

  test('marks nothing when the summary is not accepted, and tries both again after the pause', async () => {
    addFindings(3);
    const limited = deps({ maxPerDay: 1 });
    await runAlertCycle(limited);
    outbox.answers = [{ kind: 'retry_after', seconds: 60 }];

    const refused = await runDailyMessages(limited);
    const paused = await runDailyMessages(limited);
    clock = at(60_000);
    const retried = await runDailyMessages(limited);

    expect(refused).toEqual({
      digest: 'retry_after',
      heartbeat: 'not_due',
      digested: 0,
      failure: null,
    });
    expect(paused).toBeNull();
    expect(retried).toEqual({ digest: 'sent', heartbeat: 'sent', digested: 2, failure: null });
  });

  test('sends only the still-running line again when it alone was not accepted', async () => {
    outbox.answers = [
      SENT,
      { kind: 'failed', message: 'Telegram did not answer within 15 seconds' },
    ];

    const first = await runDailyMessages(deps());
    clock = at(ALERT_FAILURE_PAUSE_MS);
    const second = await runDailyMessages(deps());

    expect(first).toEqual({
      digest: 'sent',
      heartbeat: 'failed',
      digested: 0,
      failure: 'Telegram did not answer within 15 seconds',
    });
    expect(second).toEqual({ digest: 'not_due', heartbeat: 'sent', digested: 0, failure: null });
    expect(outbox.messages).toHaveLength(3);
  });
});
