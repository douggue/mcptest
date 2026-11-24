import type { BankCollection, CollectionRepo } from '../bank/collections';
import type { Db } from '../db/sqlite';
import { VIDEO_ID_PATTERN } from '../sources/parse';

interface CollectionRow {
  id: number;
  name: string;
  created_at: string;
  count: number;
}

const toCollection = (row: CollectionRow): BankCollection => ({
  id: row.id,
  name: row.name,
  count: row.count,
  createdAt: row.created_at,
});

const SELECT = `SELECT c.id, c.name, c.created_at,
  (SELECT count(*) FROM outlier_collection_videos v WHERE v.collection_id = c.id) AS count
  FROM outlier_collections c`;

/** The outlier bank's collections (store step 47, provisional). */
export class SqliteCollectionRepo implements CollectionRepo {
  constructor(private readonly db: Db) {}

  create(name: string, at: Date): number {
    const trimmed = name.trim();
    this.db
      .prepare('INSERT OR IGNORE INTO outlier_collections (name, created_at) VALUES (?, ?)')
      .run(trimmed, at.toISOString());
    const row = this.db
      .prepare<[string], { id: number }>('SELECT id FROM outlier_collections WHERE name = ?')
      .get(trimmed);
    if (!row) throw new Error('The collection could not be made');
    return row.id;
  }

  find(id: number): BankCollection | null {
    const row = this.db.prepare<[number], CollectionRow>(`${SELECT} WHERE c.id = ?`).get(id);
    return row ? toCollection(row) : null;
  }

  list(): readonly BankCollection[] {
    return this.db
      .prepare<[], CollectionRow>(`${SELECT} ORDER BY c.name COLLATE NOCASE, c.id`)
      .all()
      .map(toCollection);
  }

  add(id: number, videoId: string, at: Date): boolean {
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error('Not a valid YouTube video id');
    if (this.find(id) === null) return false;
    this.db
      .prepare(
        `INSERT INTO outlier_collection_videos (collection_id, video_id, added_at) VALUES (?, ?, ?)
         ON CONFLICT (collection_id, video_id) DO NOTHING`,
      )
      .run(id, videoId, at.toISOString());
    return true;
  }

  remove(id: number, videoId: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM outlier_collection_videos WHERE collection_id = ? AND video_id = ?')
        .run(id, videoId).changes > 0
    );
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM outlier_collections WHERE id = ?').run(id).changes > 0;
  }

  videoIds(id: number): readonly string[] {
    return this.db
      .prepare<[number], { video_id: string }>(
        `SELECT video_id FROM outlier_collection_videos WHERE collection_id = ?
         ORDER BY added_at DESC, rowid DESC`,
      )
      .all(id)
      .map((row) => row.video_id);
  }

  membership(): ReadonlyMap<string, readonly number[]> {
    const rows = this.db
      .prepare<[], { video_id: string; collection_id: number }>(
        'SELECT video_id, collection_id FROM outlier_collection_videos ORDER BY collection_id',
      )
      .all();
    return rows.reduce((found, row) => {
      found.set(row.video_id, [...(found.get(row.video_id) ?? []), row.collection_id]);
      return found;
    }, new Map<string, readonly number[]>());
  }
}
