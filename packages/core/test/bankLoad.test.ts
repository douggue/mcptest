import { describe, expect, test } from 'vitest';
import { bankFingerprint, buildBank, createBankReader, loadBankRows } from '../src/bank/load';
import { buildVideoReport } from '../src/report';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import { A_VIDEOS, NOW, cid, seededStore, vid, videosOf } from './bankFixture';

const noCloseness = () => null;

describe('the outlier bank', () => {
  test('holds every stored video once, whatever read it, with when it was last read', () => {
    const db = seededStore();
    const bank = buildBank(loadBankRows(db), { closenessOf: noCloseness }, NOW);
    expect(bank.videos).toHaveLength(7);
    expect(new Set(bank.videos.map((video) => video.videoId)).size).toBe(7);
    expect(bank.videos.every((video) => video.readAt === NOW.toISOString())).toBe(true);
  });

  test('scores each video the way the channel report does, with the usual cautions', () => {
    const db = seededStore();
    const bank = buildBank(loadBankRows(db), { closenessOf: noCloseness }, NOW);
    const report = buildVideoReport(A_VIDEOS, NOW);
    const hit = bank.videos.find((video) => video.videoId === vid('A', 0));
    const expected = report.find((row) => row.id === vid('A', 0));
    expect(hit?.score).toBeCloseTo(expected?.score ?? 0, 6);
    expect(hit?.baseline).toBe(expected?.baseline);
    expect(hit?.sampleSize).toBe(4);
    expect(hit?.caution).toBe('few-videos');
    expect(hit?.viewsPerDay).toBeCloseTo(5000, 6);
    expect(hit?.isShort).toBe(false);
    expect(bank.videos.find((video) => video.videoId === vid('A', 4))?.isShort).toBe(true);
    // Two videos cannot be compared against three others.
    expect(bank.videos.find((video) => video.videoId === vid('B', 0))?.score).toBeNull();
  });

  test('carries the channel: size, money sign, map, alphabet and topic', () => {
    const db = seededStore();
    const closeness = { centerId: cid('C'), centerTitle: 'Channel C', tier: 'close' as const };
    const bank = buildBank(
      loadBankRows(db),
      { closenessOf: (id) => (id === cid('A') ? closeness : null) },
      NOW,
    );
    const a = bank.videos.find((video) => video.channel.id === cid('A'))?.channel;
    const b = bank.videos.find((video) => video.channel.id === cid('B'))?.channel;
    expect(a).toMatchObject({
      title: 'Channel A',
      subscribers: 5000,
      money: 'monetized',
      onAMap: true,
      alphabet: 'latin',
      closeness,
      topic: { label: 'Science & space' },
      logoUrl: null,
      country: null,
    });
    expect(b).toMatchObject({
      subscribers: null,
      money: 'not-checked',
      onAMap: false,
      alphabet: 'Cyrillic',
      closeness: null,
    });
  });

  test('the strongest come first and unscored videos last', () => {
    const bank = buildBank(loadBankRows(seededStore()), { closenessOf: noCloseness }, NOW);
    expect(bank.videos[0]?.videoId).toBe(vid('A', 0));
    expect(bank.videos.at(-1)?.score).toBeNull();
  });
});

describe('the bank reader', () => {
  test('builds once and again only when the store has changed', () => {
    const db = seededStore();
    let builds = 0;
    const reader = createBankReader(db, {
      context: () => {
        builds += 1;
        return { closenessOf: noCloseness };
      },
      now: () => NOW,
    });
    const first = reader.read();
    expect(reader.read()).toBe(first);
    expect(builds).toBe(1);
    const before = bankFingerprint(db);
    new SqliteVideoRepo(db).upsertMany(
      videosOf('B', [
        { views: 3100, daysAgo: 3, title: 'Как построить дом' },
        { views: 2000, daysAgo: 100, title: 'Старый дом' },
        { views: 10, daysAgo: 1, title: 'Новое' },
      ]),
      new Date(NOW.getTime() + 1000),
    );
    expect(bankFingerprint(db)).not.toBe(before);
    expect(reader.read().videos).toHaveLength(8);
  });
});
