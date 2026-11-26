import { describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';

const planOf = (sql: string): string => {
  const db = openDatabase(':memory:');
  const plan = db
    .prepare<[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((row) => row.detail)
    .join(' | ');
  db.close();
  return plan;
};

describe('the hot reads of a large store', () => {
  test("read a channel's videos newest first from an index, with no sort after", () => {
    const plan = planOf(
      "SELECT id FROM videos WHERE channel_id = 'UCx' ORDER BY published_at DESC, id",
    );

    expect(plan).toContain('videos_channel_newest');
    expect(plan).not.toContain('TEMP B-TREE');
  });

  test('read the outlier bank in its order with no sort after', () => {
    const plan = planOf(
      'SELECT * FROM outlier_bank_rows ORDER BY channel_id, published_at DESC, video_id',
    );

    expect(plan).not.toContain('TEMP B-TREE');
  });

  test('find when a video was last read without reading every video', () => {
    expect(planOf('SELECT max(fetched_at) FROM videos')).toContain('videos_fetched');
  });
});
