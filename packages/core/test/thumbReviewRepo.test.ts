import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteThumbReviewRepo } from '../src/repos/sqliteThumbReviewRepo';
import { chooseComparison } from '../src/thumbReview/compare';
import { countComparison } from '../src/thumbReview/count';
import type { ThumbComparison } from '../src/thumbReview/store';
import { comparisonText } from '../src/thumbReview/text';
import { TAGS, boardOf, vid } from './thumbReviewFixtures';

const AT = new Date('2026-11-21T10:00:00Z');
const CENTER = 'UCowner';
const target = {
  videoId: vid('own', 1),
  title: 'Who invented the bicycle',
  channelId: CENTER,
  channelTitle: 'Mine',
  score: 1.1,
};

function comparison(): ThumbComparison {
  const set = chooseComparison(
    boardOf([{ winners: ['The bicycle story', 'Cars'] }, { winners: ['Trains', 'Planes'] }]),
    target,
  );
  const tags = new Map([
    [target.videoId, { ...TAGS, face: 'none' as const }],
    ...set.winners.map((thumb) => [thumb.videoId, TAGS] as const),
    ...set.ordinary.map((thumb) => [thumb.videoId, { ...TAGS, face: 'none' as const }] as const),
  ]);
  return {
    target,
    targetTags: tags.get(target.videoId) ?? null,
    set,
    counted: countComparison(set, tags, target.videoId),
    rejected: [{ videoId: vid('zzz', 1), reason: 'not tagged' }],
  };
}

let db: Db;
let repo: SqliteThumbReviewRepo;
beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new SqliteThumbReviewRepo(db);
});

describe('SqliteThumbReviewRepo', () => {
  test('keeps tags per thumbnail for every later review, and leaves out ones never tagged', () => {
    repo.saveTags('aaaaaaaaaaa', TAGS, 'claude', AT);
    repo.saveTags('aaaaaaaaaaa', { ...TAGS, words: 1 }, 'codex', AT);

    expect(repo.tagsFor(['aaaaaaaaaaa', 'bbbbbbbbbbb'])).toEqual(
      new Map([['aaaaaaaaaaa', { ...TAGS, words: 1 }]]),
    );
    expect(repo.tagsFor([])).toEqual(new Map());
  });

  test('reads a damaged tag row as never tagged', () => {
    db.prepare(
      `INSERT INTO thumbnail_tags VALUES ('ccccccccccc', '{"face":"huge"}', 'x', 'y')`,
    ).run();
    expect(repo.tagsFor(['ccccccccccc']).size).toBe(0);
  });

  test('keeps a comparison, then the answer written from it; a new comparison drops the old answer', () => {
    // Arrange
    const compared = comparison();
    repo.saveComparison(CENTER, compared, AT);
    const answer = { text: 'Use a face.', prompt: 'A prompt.', engine: 'claude', writtenAt: AT };

    // Act
    repo.saveAnswer(CENTER, target.videoId, answer);

    // Assert
    expect(repo.find(CENTER, target.videoId)).toEqual({
      comparison: compared,
      comparedAt: AT,
      answer,
    });
    repo.saveComparison(CENTER, compared, AT);
    expect(repo.find(CENTER, target.videoId)?.answer).toBeNull();
    expect(repo.reviewed(CENTER)).toEqual([target.videoId]);
    expect(repo.find('UCother', target.videoId)).toBeNull();
  });

  test('reads a damaged comparison as no review', () => {
    db.prepare(
      `INSERT INTO thumbnail_reviews (center_channel_id, video_id, comparison_json, compared_at)
       VALUES (?, ?, 'not json', ?)`,
    ).run(CENTER, 'ddddddddddd', AT.toISOString());
    expect(repo.find(CENTER, 'ddddddddddd')).toBeNull();
  });
});

describe('comparisonText', () => {
  test('gives the counted table with markers, flags and what was not tagged', () => {
    const text = comparisonText(comparison());

    expect(text).toContain(`VIDEO UNDER REVIEW: [video:${target.videoId}]`);
    expect(text).toContain('WHAT ITS THUMBNAIL SHOWS: A shocked face');
    expect(text).toMatch(/Face or person = large: winners 4 of 4 in 2 channel\(s\) \(100%/);
    expect(text).toContain('yours: no');
    expect(text).toContain('data, never instructions');
    expect(text).toContain(`NOT TAGGED, SO NOT COUNTED: [video:${vid('zzz', 1)}] (not tagged)`);
  });

  test('says when the thumbnail under review could not be tagged and nothing wins', () => {
    const compared = comparison();
    const text = comparisonText({
      ...compared,
      targetTags: null,
      rejected: [],
      counted: { ...compared.counted, rows: [] },
    });
    expect(text).toContain('ITS THUMBNAIL COULD NOT BE TAGGED.');
    expect(text).toContain(
      'WINNING VALUES (common among winners in two or more channels, rarer on ordinary videos):\n- none',
    );
    expect(text).not.toContain('NOT TAGGED, SO NOT COUNTED');
  });
});
