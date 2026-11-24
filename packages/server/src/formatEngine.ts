/**
 * The format builder's shelf on this engine's store: listing, adding by
 * source, a note of the owner's, and taking an ingredient off.
 */
import {
  SqliteIngredientRepo,
  SqliteVideoRepo,
  buildVideoReport,
  type ChannelRepo,
  type Db,
  type FormatVideo,
  type IngredientRepo,
} from '@jgtube/core';
import { resolveIngredient } from './formatSources';
import type { FormatEngine, FormatSources } from './formatTypes';

export interface FormatDeps {
  readonly repo: IngredientRepo;
  readonly now: () => Date;
  readonly sources: FormatSources;
  readonly imagesFolder: () => string;
}

export function formatEngine(deps: FormatDeps): FormatEngine {
  const { repo, now, sources } = deps;
  return {
    listIngredients: () => repo.list(),
    addIngredient(request) {
      let resolved;
      try {
        resolved = resolveIngredient(sources, request);
      } catch (error) {
        return { problem: error instanceof Error ? error.message : String(error), status: 400 };
      }
      if ('missing' in resolved) return { problem: resolved.missing, status: 404 };
      try {
        return { added: repo.add(resolved, now()) };
      } catch (error) {
        return { problem: error instanceof Error ? error.message : String(error), status: 400 };
      }
    },
    setIngredientNote: (id, note) => repo.setNote(id, note),
    removeIngredient: (id) => repo.remove(id),
    imagesFolder: deps.imagesFolder,
  };
}

/** A stored video with its title, channel and outlier score, read from the store. */
export function storedVideoFacts(
  db: Db,
  channels: Pick<ChannelRepo, 'findById'>,
  now: () => Date,
): (videoId: string) => FormatVideo | null {
  const videos = new SqliteVideoRepo(db);
  return (videoId) => {
    const video = videos.findById(videoId);
    if (!video) return null;
    const row = buildVideoReport(videos.listByChannel(video.channelId), now()).find(
      (item) => item.id === videoId,
    );
    return {
      videoId,
      title: video.title,
      channelId: video.channelId,
      channelTitle: channels.findById(video.channelId)?.title ?? video.channelId,
      views: video.views,
      durationSeconds: video.durationSeconds,
      score: row?.score ?? null,
    };
  };
}

export const ingredientRepo = (db: Db): IngredientRepo => new SqliteIngredientRepo(db);
