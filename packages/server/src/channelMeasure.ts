/**
 * The measured layer of a channel breakdown. Each studied video is measured
 * in code into the same store the One video tab's teardown uses, so neither
 * measures a video the other already did. The numbers across the channel are
 * then put together in code (`channelFacts`) for every part to read through
 * `get_channel_measurements`.
 */
import {
  channelFacts,
  parseMeasurements,
  pickBreakdownVideos,
  type MeasuredChannelFacts,
  type StoredVideo,
  type TeardownRepo,
  type TimedLine,
  type VideoStudyRepo,
} from '@jgtube/core';
import { rm } from 'node:fs/promises';
import type { TeardownDeps } from './teardownEngine';
import { teardownInput } from './teardownStore';

export type MeasureOutcome =
  { readonly state: 'kept' | 'made' } | { readonly state: 'failed'; readonly reason: string };

/** Whether a video's measurements are kept, so no file is needed for them. */
export const isMeasured = (repo: TeardownRepo, videoId: string): boolean =>
  repo.find(videoId, 'measured')?.json != null;

/** Measures one video file in code and keeps it, with its captions; a kept measurement stands unless `fresh`. */
export async function measureForChannel(
  teardown: TeardownDeps,
  videoId: string,
  path: string,
  fresh: boolean,
  captions: readonly TimedLine[] | null,
  onStep: (text: string) => void,
): Promise<MeasureOutcome> {
  if (captions !== null && captions.length > 0) {
    const json = JSON.stringify({ source: 'captions', lines: captions });
    teardown.repo.save(videoId, 'transcript', { engine: 'jgtube', json }, teardown.now());
  }
  if (!fresh && isMeasured(teardown.repo, videoId)) return { state: 'kept' };
  const folder = teardown.folder(videoId);
  if (folder === null)
    return { state: 'failed', reason: 'There is no downloads folder to keep its pictures in.' };
  await rm(folder, { recursive: true, force: true });
  const measured = await teardown.measure(path, folder, onStep);
  if (!measured.ok)
    return { state: 'failed', reason: `It could not be measured: ${measured.reason}` };
  teardown.repo.save(
    videoId,
    'measured',
    { engine: 'jgtube', json: JSON.stringify(measured.measurements) },
    teardown.now(),
  );
  teardown.repo.save(videoId, 'sheets', { engine: 'jgtube', json: '{}' }, teardown.now());
  return { state: 'made' };
}

export interface ChannelFactsDeps {
  readonly now: () => Date;
  readonly teardowns: TeardownRepo;
  readonly studies: Pick<VideoStudyRepo, 'find'>;
  /** The checklists stored for thumbnails, by video id. */
  thumbnailTags(
    videoIds: readonly string[],
  ): ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** Stored captions as timed lines; null when none are stored. */
  storedCaptions(videoId: string): readonly TimedLine[] | null;
}

const GROUP_SHARE = 3;

/** Everything code measured across a channel's top and ordinary videos. */
export function channelMeasurements(
  deps: ChannelFactsDeps,
  videos: readonly StoredVideo[],
): MeasuredChannelFacts {
  const picks = pickBreakdownVideos(videos, deps.now());
  const roles = [
    ...picks.top.map((video) => ({ video, role: 'winner' as const })),
    ...picks.ordinary.map((video) => ({ video, role: 'ordinary' as const })),
  ];
  const tags = deps.thumbnailTags(roles.map(({ video }) => video.videoId));
  const size = Math.ceil(picks.titles.length / GROUP_SHARE);
  return channelFacts({
    titles: {
      winners: picks.titles.slice(0, size).map((video) => video.title),
      ordinary:
        picks.titles.length > size ? picks.titles.slice(-size).map((video) => video.title) : [],
    },
    videos: roles.map(({ video, role }) => {
      const input = teardownInput(deps.teardowns, video.videoId);
      const watch = deps.teardowns.find(video.videoId, 'watch');
      const heardBy =
        watch?.json != null
          ? watch.engine
          : (deps.studies.find(video.videoId, 'watch')?.engine ?? null);
      const measuredPart = deps.teardowns.find(video.videoId, 'measured');
      return {
        videoId: video.videoId,
        title: video.title,
        role,
        views: video.views,
        score: video.score,
        measured: measuredPart?.json ? parseMeasurements(measuredPart.json) : null,
        lines: input.transcript?.lines ?? deps.storedCaptions(video.videoId),
        heardBy,
        thumbnail: tags.get(video.videoId) ?? null,
      };
    }),
  });
}
