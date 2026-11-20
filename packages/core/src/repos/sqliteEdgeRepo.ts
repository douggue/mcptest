import type { Db } from '../db/sqlite';
import type { EdgeReading, EdgeRepo, RecEdge } from './types';

interface EdgeRow {
  from_channel: string;
  to_channel: string;
  hits: number;
  sampled: number;
  share: number;
}

const EDGE_COLUMNS = 'from_channel, to_channel, hits, sampled, share';

function toEdge(row: EdgeRow): RecEdge {
  return {
    fromChannelId: row.from_channel,
    toChannelId: row.to_channel,
    hits: row.hits,
    sampled: row.sampled,
    share: row.share,
  };
}

export class SqliteEdgeRepo implements EdgeRepo {
  constructor(private readonly db: Db) {}

  listFrom(fromChannelId: string): EdgeReading | null {
    const crawl = this.db
      .prepare<[string], { crawled_at: string; region: string }>(
        'SELECT crawled_at, region FROM edge_crawls WHERE channel_id = ?',
      )
      .get(fromChannelId);
    if (!crawl) return null;
    const rows = this.db
      .prepare<[string], EdgeRow>(
        `SELECT ${EDGE_COLUMNS} FROM rec_edges
         WHERE from_channel = ? ORDER BY hits DESC, to_channel`,
      )
      .all(fromChannelId);
    return {
      crawledAt: new Date(crawl.crawled_at),
      region: crawl.region,
      edges: rows.map(toEdge),
    };
  }

  replaceFrom(
    fromChannelId: string,
    edges: readonly RecEdge[],
    region: string,
    crawledAt: Date,
  ): void {
    const clear = this.db.prepare('DELETE FROM rec_edges WHERE from_channel = ?');
    const insert = this.db.prepare(
      `INSERT INTO rec_edges (from_channel, to_channel, hits, sampled, share)
       VALUES (@from, @to, @hits, @sampled, @share)`,
    );
    const mark = this.db.prepare(
      `INSERT INTO edge_crawls (channel_id, region, crawled_at)
       VALUES (@channelId, @region, @crawledAt)
       ON CONFLICT (channel_id) DO UPDATE SET
         region = excluded.region,
         crawled_at = excluded.crawled_at`,
    );
    const writeAll = this.db.transaction(() => {
      clear.run(fromChannelId);
      for (const edge of edges) {
        insert.run({
          from: fromChannelId,
          to: edge.toChannelId,
          hits: edge.hits,
          sampled: edge.sampled,
          share: edge.share,
        });
      }
      mark.run({ channelId: fromChannelId, region, crawledAt: crawledAt.toISOString() });
    });
    writeAll();
  }

  listAmong(channelIds: readonly string[]): readonly RecEdge[] {
    if (channelIds.length === 0) return [];
    const ids = JSON.stringify(channelIds);
    return this.db
      .prepare<[string, string], EdgeRow>(
        `SELECT ${EDGE_COLUMNS} FROM rec_edges
         WHERE from_channel IN (SELECT value FROM json_each(?))
           AND to_channel IN (SELECT value FROM json_each(?))
         ORDER BY from_channel, hits DESC, to_channel`,
      )
      .all(ids, ids)
      .map(toEdge);
  }
}
