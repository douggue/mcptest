import { describe, expect, test } from 'vitest';
import { isRefusal } from '../src/sweep/refusal';
import { runSweep, SWEEP_MAX_FAILURES_IN_A_ROW } from '../src/sweep/sweep';
import { NOW, cid, vid, world } from './sweepFixture';

const ROOMY = { pages: 400, units: 0 };
const hoursLater = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

describe('a niche sweep', () => {
  test('searches each active keyword, reads the channels found and says what each did', async () => {
    const w = world({ results: { 'lost cities': 'ABA', 'deep sea': 'C' }, qualifying: 'A' });
    w.sweeps.addKeyword('lost cities', NOW);
    w.sweeps.addKeyword('deep sea', NOW);
    const paused = w.sweeps.addKeyword('paused one', NOW);
    w.sweeps.setPaused(paused?.id ?? 0, true);
    const steps: string[] = [];

    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY }, (p) =>
      steps.push(p.text),
    );

    expect(w.calls.searches).toEqual(['lost cities', 'deep sea']);
    expect(w.calls.channels.slice(0, 3)).toEqual([cid('A'), cid('B'), cid('C')]);
    expect(outcome.stopped).toBe('done');
    expect(outcome.summary.keywords).toEqual([
      expect.objectContaining({
        keyword: 'lost cities',
        channelsFound: 2,
        channelsRead: 2,
        qualified: 1,
        requests: 1 + 2 * 5,
      }),
      expect.objectContaining({ keyword: 'deep sea', channelsRead: 1, qualified: 0, requests: 6 }),
    ]);
    expect(outcome.summary.newNiches).toBe(1);
    expect(outcome.summary.keywordsLeft).toBe(0);
    expect(steps[0]).toMatch(/lost cities/);
    expect(w.sweeps.keywords().map((one) => one.lastSweptAt)).toEqual([NOW, NOW, null]);
    expect(w.sweeps.keywords()[0]?.found).toBe(1);
    expect(w.sweeps.finds().get(cid('A'))).toMatchObject({
      source: 'keyword',
      keyword: 'lost cities',
      qualified: true,
      sweepId: outcome.sweepId,
    });
    expect(w.sweeps.finds().get(cid('B'))).toMatchObject({ qualified: false });
    expect(w.sweeps.latest()).toMatchObject({ stopped: 'done', requests: outcome.spent.pages });
  });

  test('takes the keyword swept longest ago first, never-swept ones before all', async () => {
    const w = world({ results: {} });
    const old = w.sweeps.addKeyword('old', NOW);
    const recent = w.sweeps.addKeyword('recent', NOW);
    w.sweeps.addKeyword('never', NOW);
    w.sweeps.markSwept(recent?.id ?? 0, hoursLater(-2));
    w.sweeps.markSwept(old?.id ?? 0, hoursLater(-50));
    await runSweep(w.deps, { startedBy: 'schedule', left: ROOMY });
    expect(w.calls.searches).toEqual(['never', 'old', 'recent']);
    expect(w.sweeps.latest()?.startedBy).toBe('schedule');
  });

  test('a channel read in the last week is not read again and costs nothing', async () => {
    const w = world({ results: { first: 'AB', second: 'AC' } });
    w.sweeps.addKeyword('first', NOW);
    await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });
    w.sweeps.addKeyword('second', NOW);
    w.setNow(hoursLater(48));
    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });
    const second = outcome.summary.keywords.find((one) => one.keyword === 'second');
    expect(second).toMatchObject({ channelsRead: 1, alreadyKnown: 1, requests: 6 });
    expect(w.calls.channels.filter((id) => id === cid('A'))).toHaveLength(1);
    // Found by the first keyword; the second does not take it over.
    expect(w.sweeps.finds().get(cid('A'))?.keyword).toBe('first');
  });

  test('refuses to start with no active keyword', async () => {
    const w = world({ results: {} });
    await expect(runSweep(w.deps, { startedBy: 'owner', left: ROOMY })).rejects.toThrow(
      /Add a keyword/,
    );
    expect(w.sweeps.latest()).toBeNull();
  });
});

describe('the snowball', () => {
  test('reads the sidebars of a new niche’s two took-off videos and its unknown siblings, one hop', async () => {
    const w = world({
      results: { 'lost cities': 'AB' },
      qualifying: 'AS',
      // S and T stand beside A's videos; B is known already; U stands beside S (never asked).
      sidebars: { [vid('A', 0)]: 'SBT', [vid('A', 1)]: 'SA', [vid('S', 0)]: 'U' },
    });
    w.sweeps.addKeyword('lost cities', NOW);

    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });

    expect(w.calls.sidebars).toEqual([vid('A', 0), vid('A', 1)]);
    expect(w.calls.channels).toEqual([cid('A'), cid('B'), cid('S'), cid('T')]);
    expect(outcome.summary.snowball).toEqual({
      sources: 1,
      sidebarsRead: 2,
      channelsRead: 2,
      failed: 0,
      qualified: 1,
      requests: 2 * 2 + 2 * 5,
      apiUnits: 0,
    });
    expect(outcome.summary.newNiches).toBe(2);
    expect(w.sweeps.finds().get(cid('S'))).toMatchObject({
      source: 'snowball',
      fromChannelId: cid('A'),
      qualified: true,
    });
    expect(w.channels.findById(cid('U'))).toBeNull();
  });

  test('reads at most three siblings from each new niche, the most seen first', async () => {
    const w = world({
      results: { k: 'A' },
      qualifying: 'A',
      sidebars: { [vid('A', 0)]: 'PQRST', [vid('A', 1)]: 'TS' },
    });
    w.sweeps.addKeyword('k', NOW);
    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });
    expect(w.calls.channels.slice(1)).toEqual([cid('S'), cid('T'), cid('P')]);
    expect(outcome.summary.snowball.channelsRead).toBe(3);
  });
});

describe('the budget', () => {
  test('a sweep never asks for more than the budget it was given, whatever the watchlist', async () => {
    for (const pages of [0, 5, 6, 7, 17, 40, 63, 120, 399]) {
      const w = world({
        results: { one: 'ABCDEFGHIJKL', two: 'MNOPQRSTUVWX', three: 'abcdefghijkl' },
        qualifying: 'ABMNab',
        sidebars: { [vid('A', 0)]: 'xyz', [vid('A', 1)]: 'wvu', [vid('B', 0)]: 'tsr' },
      });
      ['one', 'two', 'three'].forEach((keyword) => w.sweeps.addKeyword(keyword, NOW));
      const outcome = await runSweep(w.deps, { startedBy: 'owner', left: { pages, units: 0 } });
      expect(w.pagesAsked()).toBeLessThanOrEqual(pages);
      expect(outcome.spent.pages).toBe(w.pagesAsked());
      expect(w.sweeps.spentSince(hoursLater(-1)).pages).toBe(w.pagesAsked());
    }
  });

  test('stops cleanly at the budget, says so, and the next sweep takes up the rest', async () => {
    const w = world({ results: { one: 'ABC', two: 'DEF', three: 'GHI' } });
    ['one', 'two', 'three'].forEach((keyword) => w.sweeps.addKeyword(keyword, NOW));

    const first = await runSweep(w.deps, { startedBy: 'owner', left: { pages: 24, units: 0 } });

    expect(first.stopped).toBe('budget');
    expect(first.message).toMatch(/budget/);
    expect(first.summary.keywordsLeft).toBe(2);
    expect(w.calls.searches).toEqual(['one']);
    expect(w.sweeps.latest()).toMatchObject({ stopped: 'budget' });

    w.setNow(hoursLater(24));
    const next = await runSweep(w.deps, { startedBy: 'schedule', left: ROOMY });
    expect(w.calls.searches).toEqual(['one', 'two', 'three', 'one']);
    expect(next.stopped).toBe('done');
  });

  test('with an API key the search and the channels are counted in units', async () => {
    const w = world({ results: { one: 'AB' } });
    w.sweeps.addKeyword('one', NOW);
    let made = 0;
    const deps = {
      ...w.deps,
      via: 'api' as const,
      source: {
        ...w.deps.source,
        fetchChannel: (id: string, max: number) => {
          made += 3;
          return w.deps.source.fetchChannel(id, max);
        },
      },
      apiRequestsMade: () => made,
    };
    const outcome = await runSweep(deps, { startedBy: 'owner', left: { pages: 400, units: 1500 } });
    expect(outcome.spent).toEqual({ pages: 0, units: 100 + 2 * 3 });
    expect(outcome.summary.keywords[0]).toMatchObject({ requests: 0, apiUnits: 106 });
    const capped = world({ results: { one: 'AB' } });
    capped.sweeps.addKeyword('one', NOW);
    const none = await runSweep(
      { ...capped.deps, via: 'api' },
      { startedBy: 'owner', left: { pages: 400, units: 99 } },
    );
    expect(none.stopped).toBe('budget');
    expect(capped.calls.searches).toEqual([]);
  });
});

describe('when YouTube refuses', () => {
  test('a sign-in wall stops the sweep for the day with a plain message and no other attempt', async () => {
    const wall = new Error('Sign in to confirm you’re not a bot');
    const w = world({ results: { one: 'ABC', two: 'DEF' }, failing: { B: wall } });
    ['one', 'two'].forEach((keyword) => w.sweeps.addKeyword(keyword, NOW));

    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });

    expect(outcome.stopped).toBe('refused');
    expect(outcome.message).toMatch(/YouTube refused/);
    expect(outcome.message).toMatch(/stopped for today/);
    expect(w.calls.channels).toEqual([cid('A'), cid('B')]);
    expect(w.calls.searches).toEqual(['one']);
    expect(w.calls.sidebars).toEqual([]);
    expect(w.sweeps.latest()).toMatchObject({ stopped: 'refused' });
  });

  test('a refused search stops it too', async () => {
    const refused = Object.assign(new Error('Request failed'), { status: 429 });
    const w = world({ results: { one: 'A' }, searchFailing: { one: refused } });
    w.sweeps.addKeyword('one', NOW);
    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });
    expect(outcome.stopped).toBe('refused');
    expect(w.calls.channels).toEqual([]);
  });

  test('knows a refusal from a passing failure', () => {
    expect(isRefusal(Object.assign(new Error('x'), { status: 403 }))).toBe(true);
    expect(isRefusal(new Error('Request failed with status code 429'))).toBe(true);
    expect(isRefusal(new Error('Our systems have detected unusual traffic'))).toBe(true);
    expect(isRefusal(new Error('outer', { cause: new Error('LOGIN_REQUIRED') }))).toBe(true);
    expect(isRefusal(new Error('fetch failed'))).toBe(false);
    expect(isRefusal(new Error('Could not read the channel page for UCx'))).toBe(false);
    expect(isRefusal('nothing')).toBe(false);
  });
});

describe('reads that fail', () => {
  test('one channel that cannot be read is counted and skipped', async () => {
    const w = world({ results: { one: 'ABC' }, failing: { B: new Error('gone') } });
    w.sweeps.addKeyword('one', NOW);
    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });
    expect(outcome.stopped).toBe('done');
    expect(outcome.summary.keywords[0]).toMatchObject({ channelsRead: 2, failed: 1 });
    expect(outcome.summary.problems).toEqual(['gone']);
  });

  test('several in a row end the sweep', async () => {
    const gone = new Error('fetch failed');
    const letters = 'ABCDEFGH';
    const w = world({
      results: { one: letters, two: 'XYZ' },
      failing: Object.fromEntries([...letters].map((letter) => [letter, gone])),
    });
    ['one', 'two'].forEach((keyword) => w.sweeps.addKeyword(keyword, NOW));
    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });
    expect(outcome.stopped).toBe('failed');
    expect(w.calls.channels).toHaveLength(SWEEP_MAX_FAILURES_IN_A_ROW);
    expect(w.calls.searches).toEqual(['one']);
    expect(outcome.message).toMatch(/in a row/);
  });

  test('a search that fails is a failed keyword, and the next one is tried', async () => {
    const w = world({ results: { two: 'A' }, searchFailing: { one: new Error('fetch failed') } });
    ['one', 'two'].forEach((keyword) => w.sweeps.addKeyword(keyword, NOW));
    const outcome = await runSweep(w.deps, { startedBy: 'owner', left: ROOMY });
    expect(outcome.stopped).toBe('done');
    expect(outcome.summary.keywords[0]).toMatchObject({
      keyword: 'one',
      failed: 1,
      channelsRead: 0,
    });
    expect(outcome.summary.keywords[1]).toMatchObject({ keyword: 'two', channelsRead: 1 });
  });
});
