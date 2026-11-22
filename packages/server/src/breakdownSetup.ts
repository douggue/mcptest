/**
 * Gives a channel breakdown this engine's parts to work with: the readers
 * that fetch what the store lacks, the engines that watch, study and write,
 * the stored studies and the file operations.
 */
import {
  downloadsRoot,
  ownVideosFolder,
  parseChannelRef,
  type BreakdownRepo,
  type ChannelRepo,
  type Config,
  type VideoRepo,
  type VideoStudyRepo,
} from '@jgtube/core';
import type { AnalysisParts } from './analysisEngine';
import type { Engine } from './app';
import { breakDown, type BreakdownFiles } from './breakdownEngine';
import { breakdownAnalysisId } from './breakdownParts';
import { breakdownStore } from './breakdownStore';
import {
  channelMeasurements,
  isMeasured,
  measureForChannel,
  type ChannelFactsDeps,
} from './channelMeasure';
import type { DownloadsEngine } from './downloadTypes';
import type { WorkTracker } from './running';
import type { TeardownDeps } from './teardownEngine';

export interface BreakdownSetup {
  readonly config: Config;
  readonly now: () => Date;
  readonly videos: Pick<VideoRepo, 'listByChannel'>;
  readonly studies: VideoStudyRepo;
  readonly channels: Pick<ChannelRepo, 'findById' | 'findByHandle'>;
  /** The stored parts of each channel's breakdown. */
  readonly breakdowns: BreakdownRepo;
  /** Tracks the breakdown as work under way, so shutting down can wait for it. */
  readonly run: WorkTracker['run'];
  readonly asking: AnalysisParts;
  readonly reading: DownloadsEngine;
  readonly files: BreakdownFiles;
  /** Aborted when Jgtube is closing. */
  readonly stop: AbortSignal;
  /** The teardown store and measuring, shared with the One video tab. */
  readonly teardown: TeardownDeps;
  /** What the channel measurements read besides the teardowns. */
  readonly facts: Omit<ChannelFactsDeps, 'now' | 'teardowns' | 'studies'>;
}

type Breaking = Pick<
  Engine,
  'breakDown' | 'ownVideosFolder' | 'findBreakdown' | 'breakdownText' | 'channelMeasurements'
>;

/**
 * A channel breakdown: the steps in `breakdownEngine`, on this engine's store
 * and engines, and the stored breakdown read back.
 */
export function breaking(setup: BreakdownSetup): Breaking {
  const { config, now, videos, studies, asking, reading, files, stop } = setup;
  const stored = breakdownStore({
    parts: setup.breakdowns,
    now,
    root: () => downloadsRoot(config),
  });
  /** The stored channel a handle, link or id refers to; null when it is not stored. */
  const channelOf = (channel: string) => {
    const ref = parseChannelRef(channel);
    return ref.kind === 'id'
      ? setup.channels.findById(ref.id)
      : setup.channels.findByHandle(ref.handle);
  };
  return {
    async findBreakdown(channel) {
      const found = channelOf(channel);
      return found === null ? null : stored.view(found);
    },

    breakdownText(channel, file) {
      const found = channelOf(channel);
      return found === null ? null : { channel: found, file: stored.text(found, file) };
    },

    breakDown: (channel, onProgress, choices) =>
      setup.run(() =>
        breakDown(
          {
            now,
            stop,
            studies,
            parts: setup.breakdowns,
            stored,
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
            write: (part, channelId, only, focus, avoid) =>
              asking.analyse(breakdownAnalysisId(part), channelId, only, focus, avoid),
            measure: (videoId, path, fresh, captions, onStep) =>
              measureForChannel(setup.teardown, videoId, path, fresh, captions, onStep),
            isMeasured: (videoId) => isMeasured(setup.teardown.repo, videoId),
          },
          channel,
          onProgress,
          choices,
        ),
      ),

    ownVideosFolder: () => ownVideosFolder(downloadsRoot(config)),

    channelMeasurements(channel) {
      const found = channelOf(channel);
      if (found === null) return null;
      return channelMeasurements(
        { ...setup.facts, now, teardowns: setup.teardown.repo, studies },
        videos.listByChannel(found.id),
      );
    },
  };
}
