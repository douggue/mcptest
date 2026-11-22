import type { MoneyCheckOutcome, MoneyVerdict } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  MAX_READ_IDS,
  createMoneyApi,
  filterByMoney,
  matchesMoney,
  moneyTooltip,
  uncheckedNote,
} from '../src/lib/money';
import { createMoneyStore } from '../src/lib/moneyStore';

const id = (letter: string) => `UC${letter.repeat(22)}`;
const bar = {
  key: 'over-1000',
  says: '1,000+ subscribers',
  subscribers: 2000,
  note: 'Eligibility only.',
} as const;
const verdict = (letter: string, status: MoneyVerdict['status']): MoneyVerdict => ({
  channelId: id(letter),
  status,
  says: status === 'not-checked' ? 'Not checked' : `Says ${status}`,
  short: status,
  sign: status === 'not-checked' ? null : `Sign of ${status}.`,
  checkedAt: status === 'not-checked' ? null : '2026-11-21T10:00:00.000Z',
  videoId: status === 'not-checked' ? null : 'abcdefghijk',
  bar,
});

const envelope = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      success: status < 400,
      data,
      error: status < 400 ? null : String(data),
      meta: null,
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );

describe('moneyTooltip', () => {
  test('names the verdict, the sign, the day and video it was read from, and the bar', () => {
    expect(moneyTooltip(verdict('A', 'monetized'))).toBe(
      'Says monetized. Sign of monetized. Read 2026-11-21 from video abcdefghijk. 1,000+ subscribers. Eligibility only.',
    );
  });

  test('a channel never checked says how to check it', () => {
    expect(moneyTooltip(verdict('A', 'not-checked'))).toMatch(
      /^Not checked: press "Check monetization"/,
    );
  });
});

describe('the filter', () => {
  const byId = new Map(
    [
      verdict('A', 'monetized'),
      verdict('B', 'likely'),
      verdict('C', 'not-yet'),
      verdict('D', 'not-checked'),
    ].map((v) => [v.channelId, v] as const),
  );
  const items = ['A', 'B', 'C', 'D', 'E'].map(id);

  test('"Only monetized" keeps a sign of memberships, not ads alone; "Not yet" keeps checked channels with none', () => {
    expect(filterByMoney(items, (x) => x, byId, 'any')).toEqual(items);
    expect(filterByMoney(items, (x) => x, byId, 'monetized')).toEqual([id('A')]);
    expect(filterByMoney(items, (x) => x, byId, 'not-yet')).toEqual([id('C')]);
    expect(matchesMoney(undefined, 'not-yet')).toBe(false);
  });

  test('says how many channels were left out for never being checked', () => {
    expect(uncheckedNote(items, byId, 'any')).toBeNull();
    expect(uncheckedNote(items, byId, 'monetized')).toMatch(/^2 channels are not checked yet/);
    expect(uncheckedNote([id('D')], byId, 'not-yet')).toMatch(/^1 channel is not checked yet/);
    expect(uncheckedNote([id('A')], byId, 'not-yet')).toBeNull();
  });
});

describe('createMoneyApi', () => {
  test('reads verdicts in parts the server allows, once per id', async () => {
    const asked: string[] = [];
    const api = createMoneyApi(async (input) => {
      asked.push(String(input));
      return envelope({ verdicts: [verdict('A', 'monetized')] });
    });
    const ids = Array.from(
      { length: MAX_READ_IDS + 1 },
      (_, n) => `UC${String(n).padStart(22, '0')}`,
    );
    const found = await api.verdicts([...ids, ids[0]!]);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/^\/api\/money\?channels=/);
    expect(found).toHaveLength(2);
  });

  test('a check posts the ids and throws the server’s refusal', async () => {
    const outcome: MoneyCheckOutcome = { verdicts: [], problems: [], stoppedEarly: false };
    let body = '';
    const ok = createMoneyApi(async (_input, init) => {
      body = String(init?.body);
      return envelope(outcome);
    });
    await expect(ok.check([id('A')])).resolves.toEqual(outcome);
    expect(JSON.parse(body)).toEqual({ channels: [id('A')] });
    const busy = createMoneyApi(async () => envelope('Busy reading', 409));
    await expect(busy.check([id('A')])).rejects.toThrow('Busy reading');
  });
});

describe('createMoneyStore', () => {
  const fakeApi = (overrides: Partial<ReturnType<typeof createMoneyApi>> = {}) => {
    const calls: string[][] = [];
    const api = {
      verdicts: async (ids: readonly string[]) => {
        calls.push(['read', ...ids]);
        return ids.map((x) => ({ ...verdict('A', 'not-checked'), channelId: x }));
      },
      check: async (ids: readonly string[]): Promise<MoneyCheckOutcome> => {
        calls.push(['check', ...ids]);
        return {
          verdicts: ids.map((x) => ({ ...verdict('A', 'monetized'), channelId: x })),
          problems: [],
          stoppedEarly: false,
        };
      },
      ...overrides,
    };
    return { calls, store: createMoneyStore(api) };
  };

  test('reads each id once, tells listeners, and reads again when asked', async () => {
    const { calls, store } = fakeApi();
    let told = 0;
    const stop = store.subscribe(() => {
      told += 1;
    });
    await store.load([id('A'), id('B')]);
    await store.load([id('A')]);
    await store.load([id('A')], true);
    stop();
    await store.load([id('C')]);
    expect(calls).toEqual([
      ['read', id('A'), id('B')],
      ['read', id('A')],
      ['read', id('C')],
    ]);
    expect(told).toBe(2);
    expect(store.snapshot().byId.get(id('B'))?.status).toBe('not-checked');
  });

  test('checks ten at a time, marks what is being checked, and keeps the verdicts', async () => {
    const { calls, store } = fakeApi();
    const ids = Array.from({ length: 12 }, (_, n) => `UC${String(n).padStart(22, '0')}`);
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.snapshot().checking.size));
    const problems = await store.check([...ids, ids[0]!]);
    expect(problems).toEqual([]);
    expect(calls.map((call) => call.length - 1)).toEqual([10, 2]);
    expect(seen[0]).toBe(12);
    expect(store.snapshot().checking.size).toBe(0);
    expect(store.snapshot().byId.get(ids[11]!)?.status).toBe('monetized');
    expect(await store.check([])).toEqual([]);
  });

  test('keeps the reason a check or read failed', async () => {
    const { store } = fakeApi({
      check: async () => {
        throw new Error('Busy');
      },
      verdicts: async () => {
        throw 'odd';
      },
    });
    await store.check([id('A')]);
    expect(store.snapshot().problem).toBe('Busy');
    expect(store.snapshot().checking.size).toBe(0);
    await store.load([id('A')]);
    expect(store.snapshot().problem).toBe('The request failed');
  });
});
