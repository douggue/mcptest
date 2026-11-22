import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import {
  MAX_CHECK_CHANNELS,
  checkMoney,
  loadMoneyVerdicts,
  type MoneyDeps,
} from '../src/money/check';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteMoneyRepo } from '../src/repos/sqliteMoneyRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const MEMBERS = fixture('watch-members.html');
const NO_MEMBERS = fixture('watch-no-members.html');
const LTT = 'UCXuqSBlHAE6Xw-yeJA0Tunw';
const B3 = 'UCYO_jab_esuFRV4b17AJtAw';
const OTHER = `UC${'Z'.repeat(22)}`;
const NOW = new Date('2026-11-21T12:00:00Z');
const DAY = 86_400_000;

interface Setup {
  readonly deps: MoneyDeps;
  readonly asked: string[];
}

function setUp(pages: Readonly<Record<string, string | Error>>): Setup {
  const db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  const videos = new SqliteVideoRepo(db);
  const add = (id: string, subscribers: number, videoIds: readonly string[]) => {
    channels.upsert(
      { id, title: id, handle: null, subscribers, subscribersHidden: false, videoCount: null },
      NOW,
    );
    videos.upsertMany(
      videoIds.map((videoId, index) => ({
        id: videoId,
        channelId: id,
        title: videoId,
        views: 100,
        durationSeconds: 60,
        published: {
          date: new Date(NOW.getTime() - (index + 1) * DAY),
          precision: 'day',
          raw: '1 day ago',
        },
      })),
      NOW,
    );
  };
  add(LTT, 16_900_000, ['newestLTT01', 'olderLTT001']);
  add(B3, 8_770_000, ['newestB3001']);
  add(OTHER, 300, []);
  const asked: string[] = [];
  const deps: MoneyDeps = {
    channels,
    videos,
    money: new SqliteMoneyRepo(db),
    now: () => NOW,
    source: {
      fetchWatchHtml: async (videoId) => {
        asked.push(videoId);
        const page = pages[videoId];
        if (page instanceof Error) throw page;
        return page ?? '';
      },
    },
  };
  return { deps, asked };
}

describe('checkMoney', () => {
  let setup: Setup;
  beforeEach(() => {
    setup = setUp({ newestLTT01: MEMBERS, newestB3001: NO_MEMBERS });
  });

  test('reads the newest stored video of each channel once and stores what it shows', async () => {
    const outcome = await checkMoney(setup.deps, [LTT, B3]);
    expect(setup.asked).toEqual(['newestLTT01', 'newestB3001']);
    expect(outcome.problems).toEqual([]);
    expect(outcome.verdicts.map((verdict) => [verdict.channelId, verdict.status])).toEqual([
      [LTT, 'monetized'],
      [B3, 'no-sign'],
    ]);
    expect(outcome.verdicts[0]?.checkedAt).toBe(NOW.toISOString());
    expect(setup.deps.money.find(LTT)?.videoId).toBe('newestLTT01');
  });

  test('a channel never stored or with no stored video is a problem, not a request', async () => {
    const outcome = await checkMoney(setup.deps, [`UC${'Q'.repeat(22)}`, OTHER]);
    expect(setup.asked).toEqual([]);
    expect(outcome.problems.map((problem) => problem.reason)).toEqual([
      expect.stringMatching(/not stored/),
      expect.stringMatching(/no stored video/),
    ]);
  });

  test('a page of another channel is not stored as this one', async () => {
    const swapped = setUp({ newestLTT01: NO_MEMBERS });
    const outcome = await checkMoney(swapped.deps, [LTT]);
    expect(outcome.problems[0]?.reason).toMatch(/another channel/);
    expect(swapped.deps.money.find(LTT)).toBeNull();
  });

  test('a page that could not be read is a problem and keeps the earlier check', async () => {
    await checkMoney(setup.deps, [LTT]);
    const broken = {
      ...setup.deps,
      source: { fetchWatchHtml: async () => '<html>consent</html>' },
    };
    const outcome = await checkMoney(broken, [LTT]);
    expect(outcome.problems[0]?.reason).toMatch(/could not be read/);
    expect(setup.deps.money.find(LTT)?.memberships).toBe(true);
  });

  test('a failed request is a problem for that channel only', async () => {
    const failing = setUp({
      newestLTT01: new Error('status 429\n/at/some/path'),
      newestB3001: NO_MEMBERS,
    });
    const outcome = await checkMoney(failing.deps, [LTT, B3]);
    expect(outcome.problems).toEqual([{ channelId: LTT, reason: 'status 429' }]);
    expect(outcome.verdicts.map((verdict) => verdict.channelId)).toEqual([B3]);
  });

  test('checks each channel once and no more than the cap', async () => {
    const many = Array.from({ length: MAX_CHECK_CHANNELS + 3 }, () => B3);
    await checkMoney(setup.deps, many);
    expect(setup.asked).toEqual(['newestB3001']);
  });

  test('stops before the next channel when asked to', async () => {
    const outcome = await checkMoney(setup.deps, [LTT, B3], {
      shouldStop: () => setup.asked.length > 0,
    });
    expect(setup.asked).toEqual(['newestLTT01']);
    expect(outcome.stoppedEarly).toBe(true);
  });
});

describe('loadMoneyVerdicts', () => {
  test('reads the store only: checked, not checked, and never stored', async () => {
    const { deps, asked } = setUp({ newestLTT01: MEMBERS });
    await checkMoney(deps, [LTT]);
    asked.length = 0;
    const verdicts = loadMoneyVerdicts(deps, [LTT, OTHER, `UC${'Q'.repeat(22)}`]);
    expect(asked).toEqual([]);
    expect(verdicts.map((verdict) => [verdict.channelId, verdict.status, verdict.bar.key])).toEqual(
      [
        [LTT, 'monetized', 'over-1000'],
        [OTHER, 'not-checked', 'under-500'],
      ],
    );
  });
});
