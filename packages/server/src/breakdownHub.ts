/**
 * The Breakdown view's part of the engine, on this engine's store, readers
 * and AI engines: the channels the chooser offers, a pasted channel read
 * once, and the production teardown of one video.
 */
import {
  UPLOAD_KINDS,
  cutChapterSheets,
  downloadsRoot,
  measureVideo,
  ownVideosFolder,
  pathInside,
  readTeardownImage,
  teardownFolder,
  teardownImages,
  teardownMarkdown,
  zipFiles,
  type Config,
  type TeardownRepo,
  type VideoBreakdownRepo,
} from '@jgtube/core';
import { readFile, stat } from 'node:fs/promises';
import type { AnalysisParts } from './analysisEngine';
import { breakdownCandidates, candidateOf, type CandidateDeps } from './breakdownCandidates';
import type { BreakdownFiles } from './breakdownEngine';
import type { DownloadsEngine } from './downloadTypes';
import { breakDownVideo, videoBreakdownView, type VideoAbout } from './oneVideoEngine';
import type { BreakdownHub } from './oneVideoTypes';
import type { WorkTracker } from './running';
import { plannedRuns, type TeardownDeps } from './teardownEngine';
import { teardownData, teardownReportOf } from './teardownStore';

export interface HubSetup {
  readonly config: Config;
  readonly candidates: CandidateDeps;
  readonly teardowns: TeardownRepo;
  readonly store: VideoBreakdownRepo;
  readonly reading: DownloadsEngine;
  readonly asking: AnalysisParts;
  readonly files: BreakdownFiles;
  /** Where to look for ffmpeg; tests replace it. */
  readonly env?: Readonly<Record<string, string | undefined>>;
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

/** The teardown pipeline on this engine's tools. */
export function teardownDeps(setup: HubSetup, root: () => string | null): TeardownDeps {
  const { asking, files, stop } = setup;
  const ffmpeg = { ...(setup.env ? { env: setup.env } : {}), signal: stop };
  return {
    now: setup.candidates.now,
    stop,
    repo: setup.teardowns,
    folder: (videoId) => {
      const base = root();
      return base === null ? null : teardownFolder(base, videoId);
    },
    measure: (path, folder, onStep) => measureVideo(path, folder, { ...ffmpeg, onStep }),
    chapterSheets: (path, folder, spans) => cutChapterSheets(path, folder, spans, ffmpeg),
    watchesFiles: () => asking.watchesFiles(),
    watch: (videoId, question, path, fileOnly) =>
      asking.watchVideo(videoId, question, {
        download: async () => files.forWatching(videoId, path),
        fileOnly,
      }),
    ask: (ask, only) => asking.askTeardown(ask, only),
  };
}

export function breakdownHub(setup: HubSetup): BreakdownHub {
  const { reading, files, store } = setup;
  const root = (): string | null => {
    try {
      return downloadsRoot(setup.config);
    } catch {
      return null;
    }
  };
  const folder = (): string | null => {
    const base = root();
    return base === null ? null : ownVideosFolder(base);
  };
  const teardown = teardownDeps(setup, root);
  const details = async (videoId: string): Promise<VideoAbout> => {
    const [found] = (await reading.readVideoDetails([videoId])).videos;
    return {
      title: found?.title ?? null,
      channelId: found?.channelId ?? null,
      durationSeconds: found?.durationSeconds ?? null,
    };
  };
  const markdown = (videoId: string): string | null => {
    const report = teardownReportOf(setup.teardowns, videoId);
    return report === null ? null : teardownMarkdown(report);
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
            store,
            files,
            teardown,
            uploadPath: (videoId) => uploadPathIn(folder(), videoId),
            details,
            readTranscript: reading.readTranscript,
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
      return entry === null ? null : videoBreakdownView(entry, { teardown });
    },

    hasUpload: async (videoId) => (await uploadPathIn(folder(), videoId)) !== null,

    teardownRuns: (videoId, fresh) =>
      videoId === null
        ? plannedRuns(teardown, 'aaaaaaaaaaa', true, true)
        : plannedRuns(teardown, videoId, fresh, true),

    async teardownImage(videoId, name) {
      const base = root();
      return base === null ? null : readTeardownImage(base, videoId, name);
    },

    teardownMarkdown: markdown,

    async teardownZip(videoId) {
      const text = markdown(videoId);
      const base = root();
      if (text === null) return null;
      const names = base === null ? [] : await teardownImages(base, videoId);
      const images = await Promise.all(
        names.map(async (name) => ({
          name: `images/${name}`,
          bytes: new Uint8Array(
            await readFile(pathInside(teardownFolder(base ?? '', videoId), name)),
          ),
        })),
      );
      const data = teardownData(setup.teardowns, videoId, ['measured', 'transcript']);
      const transcript = (data['transcript'] as { lines: readonly string[] }).lines.join('\n');
      return zipFiles([
        { name: 'teardown.md', bytes: Buffer.from(text, 'utf8') },
        { name: 'transcript.txt', bytes: Buffer.from(transcript, 'utf8') },
        {
          name: 'measurements.json',
          bytes: Buffer.from(JSON.stringify(data['measured'], null, 2), 'utf8'),
        },
        ...images,
      ]);
    },

    teardownData: (videoId, include) => teardownData(setup.teardowns, videoId, include),
  };
}
