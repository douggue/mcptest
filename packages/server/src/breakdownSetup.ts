/**
 * Gives a channel breakdown this engine's parts to work with: the readers
 * that fetch what the store lacks, the engines that watch, study and write,
 * the stored studies and the file operations.
 */
import {
  downloadsRoot,
  ownVideosFolder,
  type Config,
  type VideoRepo,
  type VideoStudyRepo,
} from '@jgtube/core';
import type { AnalysisParts } from './analysisEngine';
import type { Engine } from './app';
import { breakDown, type BreakdownFiles } from './breakdownEngine';
import type { DownloadsEngine } from './downloadTypes';
import type { WorkTracker } from './running';

export interface BreakdownSetup {
  readonly config: Config;
  readonly now: () => Date;
  readonly videos: Pick<VideoRepo, 'listByChannel'>;
  readonly studies: VideoStudyRepo;
  /** Tracks the breakdown as work under way, so shutting down can wait for it. */
  readonly run: WorkTracker['run'];
  readonly asking: AnalysisParts;
  readonly reading: DownloadsEngine;
  readonly files: BreakdownFiles;
  /** Aborted when Jgtube is closing. */
  readonly stop: AbortSignal;
}

/** A channel breakdown: the steps in `breakdownEngine`, on this engine's store and engines. */
export function breaking(setup: BreakdownSetup): Pick<Engine, 'breakDown' | 'ownVideosFolder'> {
  const { config, now, videos, studies, asking, reading, files, stop } = setup;
  return {
    breakDown: (channel, onProgress, choices) =>
      setup.run(() =>
        breakDown(
          {
            now,
            stop,
            studies,
            files,
            readChannel: async (ref) => (await reading.readChannelBrand(ref)).channel,
            listVideos: (channelId) => videos.listByChannel(channelId),
            readTranscript: reading.readTranscript,
            framesAvailable: async (videoId) => {
              const frames = await reading.readVideoFrames(videoId, 1, 0);
              return frames === null || frames.frameCount < 1
                ? null
                : { source: frames.source, available: frames.frameCount };
            },
            watchesFiles: asking.watchesFiles,
            watchVideo: asking.watchVideo,
            studyFrames: asking.studyFrames,
            write: (stored, only, focus) => asking.analyse('breakdown', stored, only, focus),
          },
          channel,
          onProgress,
          choices,
        ),
      ),

    ownVideosFolder: () => ownVideosFolder(downloadsRoot(config)),
  };
}
