/**
 * A channel breakdown, as one job of several steps.
 *
 * In code, by one rule for every channel: the channel's five videos furthest
 * above its usual views are chosen, their captions are read, and the three
 * best are studied in depth. For each of those a video file is looked for
 * (the owner's own, else a download), an engine watches it for sound and
 * editing, and an engine goes through its frames, cut from the file one a
 * second or, with no file, YouTube's own preview frames. What each engine
 * wrote is stored per video and reused the next time. Last, an engine writes
 * the breakdown from all of it through read-only tools.
 *
 * Nothing that could not be done fails the job: it is recorded with a plain
 * reason, and the breakdown says what is unknown instead of guessing.
 */
import {
  pickBreakdownVideos,
  tooLongToWatch,
  type BreakdownVideo,
  type FrameSheetCut,
  type StoredVideo,
  type StoredVideoStudy,
  type StudiedFrames,
  type TranscriptResult,
  type VideoStudyRepo,
} from '@jgtube/core';
import type { Engine } from './app';
import { WATCH_QUESTION, type BreakdownFocus } from './breakdownQuestions';
import type {
  BreakdownChoices,
  BreakdownOutcome,
  BreakdownProgress,
  BreakdownStep,
  FrameStudyResult,
  StudiedVideo,
  StudyResult,
  TopVideo,
  VideoFileUsed,
  VideoToSupply,
} from './breakdownTypes';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import type { DownloadVideo, VideoDownload } from './engines/videoWatch';
import { cleanMessage } from './jobs';
import { CLOSING } from './running';

/** The file operations a breakdown needs, so tests can stand in for the disk and the network. */
export interface BreakdownFiles {
  /** Where the owner's own files go; null when there is nowhere to save. */
  ownFolder(): string | null;
  /** The owner's own file for a video, or null. Never deleted by Jgtube. */
  own(videoId: string): Promise<string | null>;
  /** Fetches a copy, which comes with the way to remove it. */
  readonly fetch: DownloadVideo;
  /** Whether frames can be cut from a file: ffmpeg is installed. */
  canCut(): Promise<boolean>;
  cut(videoId: string, path: string): Promise<FrameSheetCut>;
  removeFrames(videoId: string): Promise<void>;
  /** The file as the engine that watches can open it: itself, or a smaller copy made for the watch. */
  forWatching(videoId: string, path: string): Promise<VideoDownload>;
}

export interface BreakdownDeps {
  readonly now: () => Date;
  /** Aborted when Jgtube is closing. */
  readonly stop: AbortSignal;
  readonly studies: VideoStudyRepo;
  readonly files: BreakdownFiles;
  /** The channel, read from YouTube first when it is not stored. */
  readChannel(channel: string): Promise<{ readonly id: string; readonly title: string }>;
  listVideos(channelId: string): readonly StoredVideo[];
  readTranscript(videoId: string): Promise<TranscriptResult>;
  /** The frames there are to look at for a video, and where they come from; null when none. */
  framesAvailable(videoId: string): Promise<StudiedFrames | null>;
  /** Whether an engine here would watch a video from a file. */
  watchesFiles(): Promise<boolean>;
  readonly watchVideo: Engine['watchVideo'];
  studyFrames(videoId: string, only?: EngineId): Promise<EngineAnswer<EngineId>>;
  write(
    channel: string,
    only: EngineId | undefined,
    focus: BreakdownFocus,
  ): Promise<EngineAnswer<EngineId>>;
}

/** The names a creator knows the engines by. */
const ENGINE_NAMES: Readonly<Record<string, string>> = {
  agy: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  'gemini-api': 'The Gemini API',
};
const SOURCE_WORDS: Readonly<Record<StudiedFrames['source'], string>> = {
  file: 'cut from the video file, one a second',
  preview: 'YouTube’s own preview frames',
};
const MAX_TITLE_SHOWN = 80;
const NO_TOOLS_FOR_A_FILE =
  'Neither ffmpeg nor Antigravity is installed, so a file of this video would not be used.';
const NOTHING_NEEDED =
  'No file was needed: what a file is used for was kept from an earlier breakdown.';
const NO_FRAMES =
  'YouTube has no preview frames for this video, and there was no video file to cut frames from.';

/** A reason that reads on after a colon: no full stop at its end. */
const withoutStop = (text: string): string => text.trim().replace(/\.$/, '');
const sentence = (text: string): string => `${withoutStop(text)}.`;
const reasonOf = (error: unknown): string => sentence(cleanMessage(error));

/** A video file in hand for one video, or why there is none. */
type HeldFile =
  | {
      readonly ok: true;
      readonly path: string;
      readonly used: 'own' | 'downloaded';
      readonly remove?: (() => Promise<void>) | undefined;
    }
  | { readonly ok: false; readonly reason: string };

/** Reports steps, and keeps the list of videos the owner can supply as it grows. */
interface Teller {
  say(step: BreakdownStep, text: string): void;
  supply(video: VideoToSupply): void;
  supplied(): readonly VideoToSupply[];
}

function teller(report: (progress: BreakdownProgress) => void): Teller {
  let supply: readonly VideoToSupply[] = [];
  return {
    say: (step, text) => report({ step, text, supply }),
    supply: (video) => {
      supply = [...supply.filter((other) => other.videoId !== video.videoId), video];
    },
    supplied: () => supply,
  };
}

/** What is the same for every step of one video. */
interface VideoRun {
  /** "Video 1 of 3, “Title”", for progress lines. */
  readonly label: string;
  readonly choices: BreakdownChoices;
  readonly tell: Teller;
}

function stopIfClosing(deps: BreakdownDeps): void {
  if (deps.stop.aborted) throw new Error(CLOSING);
}

/** Whether each top video's captions could be read; a video without any is a normal answer. */
async function readCaptions(
  deps: BreakdownDeps,
  top: readonly BreakdownVideo[],
): Promise<readonly TopVideo[]> {
  let read: readonly TopVideo[] = [];
  for (const { videoId, title } of top) {
    stopIfClosing(deps);
    try {
      const { transcript } = await deps.readTranscript(videoId);
      read = [...read, { videoId, title, captions: transcript === null ? 'none' : 'read' }];
    } catch {
      // The writing engine's own tool asks again, and says so if it still cannot be read.
      stopIfClosing(deps);
      read = [...read, { videoId, title, captions: 'failed' }];
    }
  }
  return read;
}

/** The file to study a video from: the owner's own first, else a download, else why there is none. */
async function fileFor(
  deps: BreakdownDeps,
  video: BreakdownVideo,
  run: VideoRun,
): Promise<HeldFile> {
  const { videoId, title } = video;
  const own = await deps.files.own(videoId);
  if (own !== null) {
    run.tell.say('file', `${run.label}: using the file you gave`);
    return { ok: true, path: own, used: 'own' };
  }
  const missing = (reason: string): HeldFile => {
    run.tell.supply({ videoId, title, reason });
    return { ok: false, reason };
  };
  const tooLong = tooLongToWatch(video);
  if (tooLong !== null) return missing(tooLong);
  run.tell.say('downloading', `${run.label}: downloading the video`);
  const copy = await deps.files.fetch(videoId, deps.stop);
  stopIfClosing(deps);
  return copy.ok
    ? { ok: true, path: copy.path, used: 'downloaded', remove: copy.remove }
    : missing(sentence(copy.reason));
}

const keptStudy = (study: StoredVideoStudy): StudyResult => ({
  done: true,
  by: study.engine,
  kept: true,
});

/** Has an engine watch the video, sound included, and stores what it wrote. */
async function watchOne(
  deps: BreakdownDeps,
  video: BreakdownVideo,
  file: HeldFile,
  run: VideoRun,
): Promise<StudyResult> {
  const { videoId } = video;
  const download: DownloadVideo = async () =>
    file.ok
      ? deps.files.forWatching(videoId, file.path)
      : { ok: false, reason: withoutStop(file.reason) };
  try {
    const answer = await deps.watchVideo(videoId, WATCH_QUESTION, {
      download,
      onStep: (step) => {
        if (step.kind !== 'watching') return;
        const name = ENGINE_NAMES[step.engine] ?? step.engine;
        run.tell.say('watching', `${run.label}: ${name} is watching it`);
      },
    });
    deps.studies.save(
      { videoId, kind: 'watch', engine: answer.engine, text: answer.text },
      deps.now(),
    );
    return { done: true, by: answer.engine, kept: false };
  } catch (error) {
    stopIfClosing(deps);
    return { done: false, reason: reasonOf(error) };
  }
}

/** Has an engine go through the video's frames, from the file when there is one, and stores the study. */
async function studyFramesOf(
  deps: BreakdownDeps,
  video: BreakdownVideo,
  file: HeldFile,
  kept: StoredVideoStudy | null,
  run: VideoRun,
): Promise<FrameStudyResult> {
  const { videoId } = video;
  try {
    const cuts = file.ok && kept?.frames?.source !== 'file' && (await deps.files.canCut());
    if (cuts) run.tell.say('cutting', `${run.label}: cutting one frame a second from the file`);
    const cut = cuts ? await deps.files.cut(videoId, file.path) : null;
    stopIfClosing(deps);
    // A study already stored stands unless frames from the file can now replace preview ones.
    if (kept !== null && cut?.ok !== true) {
      return {
        done: true,
        by: kept.engine,
        kept: true,
        source: kept.frames?.source ?? null,
        available: kept.frames?.available ?? null,
      };
    }
    const frames = await deps.framesAvailable(videoId);
    if (frames === null) return { done: false, reason: NO_FRAMES };
    const what = `${frames.available} frames, ${SOURCE_WORDS[frames.source]}`;
    run.tell.say('frames', `${run.label}: an AI is going through its ${what}`);
    const answer = await deps.studyFrames(videoId, run.choices.only);
    deps.studies.save(
      { videoId, kind: 'frames', engine: answer.engine, text: answer.text, frames },
      deps.now(),
    );
    return { done: true, by: answer.engine, kept: false, ...frames };
  } catch (error) {
    stopIfClosing(deps);
    return { done: false, reason: reasonOf(error) };
  }
}

/** One video studied in depth: a file found, then watched, then its frames gone through. */
async function studyVideo(
  deps: BreakdownDeps,
  video: BreakdownVideo,
  run: VideoRun,
): Promise<StudiedVideo> {
  const { videoId, title } = video;
  const find = (kind: 'watch' | 'frames'): StoredVideoStudy | null =>
    run.choices.fresh ? null : deps.studies.find(videoId, kind);
  const kept = { watch: find('watch'), frames: find('frames') };
  const [canCut, canWatch] = await Promise.all([deps.files.canCut(), deps.watchesFiles()]);
  // A file is looked for only when something here would use it: a watch by an
  // engine that opens files, or frames cut by ffmpeg that are not stored yet.
  const needsFile =
    (kept.watch === null && canWatch) || (canCut && kept.frames?.frames?.source !== 'file');
  const file: HeldFile = needsFile
    ? await fileFor(deps, video, run)
    : { ok: false, reason: canCut || canWatch ? NOTHING_NEEDED : NO_TOOLS_FOR_A_FILE };
  try {
    const watch =
      kept.watch === null ? await watchOne(deps, video, file, run) : keptStudy(kept.watch);
    const frames = await studyFramesOf(deps, video, file, kept.frames, run);
    const used: VideoFileUsed = file.ok
      ? { used: file.used }
      : { used: 'none', reason: file.reason };
    return { videoId, title, file: used, watch, frames };
  } finally {
    // Only what Jgtube made is removed: the cut frames and a copy it downloaded.
    await deps.files.removeFrames(videoId).catch(() => undefined);
    if (file.ok) await file.remove?.().catch(() => undefined);
  }
}

const shown = (title: string): string =>
  title.length > MAX_TITLE_SHOWN ? `${title.slice(0, MAX_TITLE_SHOWN)}…` : title;

/**
 * Breaks one channel down and resolves with the breakdown and how each part
 * went. Rejects when the channel cannot be read, when no engine could write
 * the breakdown, or when Jgtube is closing.
 */
export async function breakDown(
  deps: BreakdownDeps,
  channel: string,
  report: (progress: BreakdownProgress) => void,
  choices: BreakdownChoices = {},
): Promise<BreakdownOutcome> {
  const tell = teller(report);
  tell.say('reading', 'Reading the channel and its top videos');
  const stored = await deps.readChannel(channel);
  const picks = pickBreakdownVideos(deps.listVideos(stored.id), deps.now());
  const top = await readCaptions(deps, picks.top);
  let deep: readonly StudiedVideo[] = [];
  for (const [index, video] of picks.deep.entries()) {
    stopIfClosing(deps);
    const label = `Video ${index + 1} of ${picks.deep.length}, “${shown(video.title)}”`;
    deep = [...deep, await studyVideo(deps, video, { label, choices, tell })];
  }
  stopIfClosing(deps);
  tell.say('writing', 'Writing the breakdown');
  const answer = await deps.write(stored.id, choices.only, {
    top: picks.top.map((video) => video.videoId),
    deep: picks.deep.map((video) => video.videoId),
  });
  return {
    channel: { id: stored.id, title: stored.title },
    storedVideos: picks.storedVideos,
    top,
    deep,
    supply: tell.supplied(),
    ownVideosFolder: deps.files.ownFolder(),
    text: answer.text,
    engine: answer.engine,
    skipped: answer.skipped,
  };
}
