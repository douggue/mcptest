/**
 * The Breakdown view's part of the engine, on this engine's store, readers
 * and AI engines: the channels the chooser offers, a pasted channel read
 * once, and a deep breakdown of one video.
 */
import {
  UPLOAD_KINDS,
  downloadsRoot,
  ownVideosFolder,
  pathInside,
  type Config,
  type VideoBreakdownRepo,
  type VideoStudyRepo,
} from '@jgtube/core';
import { stat } from 'node:fs/promises';
import type { AnalysisParts } from './analysisEngine';
import { breakdownCandidates, candidateOf, type CandidateDeps } from './breakdownCandidates';
import type { BreakdownFiles } from './breakdownEngine';
import type { DownloadsEngine } from './downloadTypes';
import { breakDownVideo, videoBreakdownView, type VideoAbout } from './oneVideoEngine';
import type { BreakdownHub } from './oneVideoTypes';
import type { WorkTracker } from './running';

export interface HubSetup {
  readonly config: Config;
  readonly candidates: CandidateDeps;
  readonly studies: VideoStudyRepo;
  readonly store: VideoBreakdownRepo;
  readonly reading: DownloadsEngine;
  readonly asking: AnalysisParts;
  readonly files: BreakdownFiles;
  /** Tracks a run as work under way, so shutting down can wait for it. */
  readonly run: WorkTracker['run'];
  readonly stop: AbortSignal;
}

const isFile = async (path: string): Promise<boolean> =>
  (await stat(path).catch(() => null))?.isFile() ?? false;

/** Where the file the owner gave under an id is: `<my-videos>/<id>.<mp4|webm|mov>`. */
export async function uploadPathIn(folder: string | null, videoId: string): Promise<string | null> {
  if (folder === null || !/^[\w-]{11}$/.test(videoId)) return null;
  for (const kind of UPLOAD_KINDS) {
    const path = pathInside(folder, `${videoId}${kind.extension}`);
    if (await isFile(path)) return path;
  }
  return null;
}

export function breakdownHub(setup: HubSetup): BreakdownHub {
  const { reading, asking, files, store } = setup;
  const folder = (): string | null => {
    try {
      return ownVideosFolder(downloadsRoot(setup.config));
    } catch {
      return null;
    }
  };
  const details = async (videoId: string): Promise<VideoAbout> => {
    const [found] = (await reading.readVideoDetails([videoId])).videos;
    return {
      title: found?.title ?? null,
      channelId: found?.channelId ?? null,
      durationSeconds: found?.durationSeconds ?? null,
    };
  };
  return {
    candidates: (ids) => breakdownCandidates(setup.candidates, ids),

    async readCandidate(channel) {
      const read = await reading.readChannelBrand(channel);
      return candidateOf(setup.candidates, read.channel);
    },

    breakDownVideo: (target, onProgress, choices) =>
      setup.run(() =>
        breakDownVideo(
          {
            now: setup.candidates.now,
            stop: setup.stop,
            studies: setup.studies,
            store,
            files,
            uploadPath: (videoId) => uploadPathIn(folder(), videoId),
            details,
            readTranscript: reading.readTranscript,
            framesAvailable: async (videoId) => {
              const frames = await reading.readVideoFrames(videoId, 1, 0);
              return frames === null || frames.frameCount < 1
                ? null
                : { source: frames.source, available: frames.frameCount };
            },
            watchVideo: asking.watchVideo,
            studyFrames: asking.studyFrames,
            write: (analysis, focus, only) => asking.analyse(analysis, '', only, focus),
          },
          target,
          onProgress,
          choices,
        ),
      ),

    videoBreakdowns: () =>
      store.list().map((entry) => ({
        videoId: entry.videoId,
        source: entry.source,
        title: entry.title,
        writtenAt: entry.writtenAt.toISOString(),
        written: entry.written !== null,
      })),

    findVideoBreakdown(videoId) {
      const entry = store.find(videoId);
      return entry === null ? null : videoBreakdownView(entry);
    },

    hasUpload: async (videoId) => (await uploadPathIn(folder(), videoId)) !== null,
  };
}
