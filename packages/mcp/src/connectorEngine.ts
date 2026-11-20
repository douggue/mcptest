import {
  SqliteChannelRepo,
  SqliteVideoRepo,
  buildVideoReport,
  openDatabase,
  parseChannelRef,
  type Config,
} from '@jgtube/core';
import { createEngine, type EngineOptions } from '@jgtube/server/src/engine';
import type { ChannelVideos, ConnectorEngine } from './types';

export interface RunningConnectorEngine extends ConnectorEngine {
  close(): void;
}

/**
 * The engine the web app's server uses, plus a lookup of one channel's videos.
 *
 * The lookup reads through a second connection to the same store file, because
 * the server's engine keeps its own to itself. SQLite in WAL mode allows that,
 * as it allows the web app to run beside the connector. The store must be a
 * file: two connections to ":memory:" would be two separate stores.
 */
export function createConnectorEngine(
  config: Config,
  options: EngineOptions = {},
): RunningConnectorEngine {
  const engine = createEngine(config, options);
  const db = openDatabase(config.dbPath);
  const channels = new SqliteChannelRepo(db);
  const videos = new SqliteVideoRepo(db);
  const now = options.now ?? (() => new Date());

  return {
    ...engine,

    findChannelVideos(channel): ChannelVideos | null {
      const ref = parseChannelRef(channel);
      const stored =
        ref.kind === 'id' ? channels.findById(ref.id) : channels.findByHandle(ref.handle);
      if (!stored) return null;
      const storedVideos = videos.listByChannel(stored.id);
      const durations = new Map(storedVideos.map((video) => [video.id, video.durationSeconds]));
      return {
        channel: {
          id: stored.id,
          title: stored.title,
          handle: stored.handle,
          subscribers: stored.subscribers,
        },
        videos: buildVideoReport(storedVideos, now()).map((row) => ({
          ...row,
          durationSeconds: durations.get(row.id) ?? null,
        })),
      };
    },

    close() {
      db.close();
      engine.close();
    },
  };
}
