/**
 * A deep breakdown of one video, as one job of a few steps: the video is
 * named and its captions read (a YouTube video), a file is found (the
 * owner's own copy, a download, or the file the owner gave), an engine that
 * watches video watches it, an engine that sees pictures goes through its
 * frames, and one engine writes the breakdown from those through read-only
 * tools. How the video was seen is recorded in code and kept beside the
 * answer, so the page can say what the engine could and could not see.
 *
 * What could not be done is recorded with a plain reason. The job fails
 * only when there is nothing at all to go on, when the writing fails, or
 * when Jgtube is closing.
 */
import {
  liftOneVideoPrompts,
  tooLongToWatch,
  type StoredVideoBreakdown,
  type StudiedFrames,
  type TranscriptResult,
  type VideoBreakdownRepo,
  type VideoSeen,
  type VideoStudyRepo,
} from '@jgtube/core';
import type { Engine } from './app';
import { ENGINE_NAMES } from './breakdownBasis';
import type { BreakdownFiles } from './breakdownEngine';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import type { DownloadVideo } from './engines/videoWatch';
import { cleanMessage } from './jobs';
import { DEEP_WATCH_QUESTION, type OneVideoAnalysisId, type OneVideoFocus } from './oneVideoQuestions';
import type {
  OneVideoChoices,
  OneVideoProgress,
  OneVideoStep,
  VideoBreakdownView,
  VideoTarget,
} from './oneVideoTypes';
import { CLOSING } from './running';

export interface OneVideoDeps {
  readonly now: () => Date;
  /** Aborted when Jgtube is closing. */
  readonly stop: AbortSignal;
  readonly studies: VideoStudyRepo;
  readonly store: VideoBreakdownRepo;
  readonly files: BreakdownFiles;
  /** Where the file the owner gave under this id is; null when it is not there. */
  uploadPath(videoId: string): Promise<string | null>;
  /** A YouTube video's title, channel and length, read once; nulls for what is not known. */
  details(videoId: string): Promise<VideoAbout>;
  readTranscript(videoId: string): Promise<TranscriptResult>;
  /** The frames there are to look at for a video, and where they come from; null when none. */
  framesAvailable(videoId: string): Promise<StudiedFrames | null>;
  readonly watchVideo: Engine['watchVideo'];
  studyFrames(videoId: string, only?: EngineId): Promise<EngineAnswer<EngineId>>;
  write(
    analysis: OneVideoAnalysisId,
    focus: OneVideoFocus,
    only?: EngineId,
  ): Promise<EngineAnswer<EngineId>>;
}

export interface VideoAbout {
  readonly title: string | null;
  readonly channelId: string | null;
  readonly durationSeconds: number | null;
}

type Say = (step: OneVideoStep, text: string) => void;

type HeldFile =
  | {
      readonly ok: true;
      readonly path: string;
      readonly used: 'own' | 'downloaded' | 'uploaded';
      readonly remove?: (() => Promise<void>) | undefined;
    }
  | { readonly ok: false; readonly reason: string };

interface Studied {
  readonly by: string | null;
  readonly note: string | null;
}
interface FramesStudied extends Studied {
  readonly frames: StudiedFrames | null;
}

const NOTHING_TO_GO_ON =
  'No engine could watch this video, its frames could not be studied, and it has no captions, so there is nothing to break it down from.';
const NO_UPLOAD = 'The video file you gave is no longer on this computer. Choose it again.';
const NO_FRAMES = 'There were no frames to study: no file to cut them from and no preview frames.';
const MAX_TITLE_SHOWN = 80;

const withoutStop = (text: string): string => text.trim().replace(/\.$/, '');
const sentence = (text: string): string => `${withoutStop(text)}.`;
const reasonOf = (error: unknown): string => sentence(cleanMessage(error));
const nameOf = (engine: string): string => ENGINE_NAMES[engine] ?? engine;

function stopIfClosing(deps: OneVideoDeps): void {
  if (deps.stop.aborted) throw new Error(CLOSING);
}

/** The video's title and channel: a YouTube video's own, or the name of the file the owner gave. */
async function describe(deps: OneVideoDeps, target: VideoTarget): Promise<VideoAbout> {
  if (target.kind === 'file') {
    return { title: target.name, channelId: null, durationSeconds: null };
  }
  try {
    return await deps.details(target.videoId);
  } catch {
    stopIfClosing(deps);
    return { title: null, channelId: null, durationSeconds: null };
  }
}

async function captionsOf(deps: OneVideoDeps, target: VideoTarget): Promise<VideoSeen['captions']> {
  if (target.kind === 'file') return 'not-asked';
  try {
    const { transcript } = await deps.readTranscript(target.videoId);
    return transcript === null ? 'none' : 'read';
  } catch {
    stopIfClosing(deps);
    return 'failed';
  }
}

/** The file to watch and cut frames from: the one given, the owner's own, else a download. */
async function fileFor(
  deps: OneVideoDeps,
  target: VideoTarget,
  about: VideoAbout,
  say: Say,
): Promise<HeldFile> {
  const { videoId } = target;
  if (target.kind === 'file') {
    const path = await deps.uploadPath(videoId);
    if (path === null) throw new Error(NO_UPLOAD);
    return { ok: true, path, used: 'uploaded' };
  }
  const own = await deps.files.own(videoId);
  if (own !== null) return { ok: true, path: own, used: 'own' };
  const tooLong = tooLongToWatch(about);
  if (tooLong !== null) return { ok: false, reason: tooLong };
  say('downloading', 'Downloading the video, up to 720p');
  const copy = await deps.files.fetch(videoId, deps.stop);
  stopIfClosing(deps);
  return copy.ok
    ? { ok: true, path: copy.path, used: 'downloaded', remove: copy.remove }
    : { ok: false, reason: sentence(copy.reason) };
}

/** Has an engine watch the video, picture and sound; a watch already stored is reused. */
async function watchIt(
  deps: OneVideoDeps,
  target: VideoTarget,
  file: HeldFile,
  choices: OneVideoChoices,
  say: Say,
): Promise<Studied> {
  const { videoId } = target;
  const kept = choices.fresh ? null : deps.studies.find(videoId, 'watch');
  if (kept !== null) return { by: kept.engine, note: null };
  const download: DownloadVideo = async () =>
    file.ok
      ? deps.files.forWatching(videoId, file.path)
      : { ok: false, reason: withoutStop(file.reason) };
  try {
    const answer = await deps.watchVideo(videoId, DEEP_WATCH_QUESTION, {
      download,
      fileOnly: target.kind === 'file',
      onStep: (step) => {
        if (step.kind === 'watching') say('watching', `${nameOf(step.engine)} is watching it`);
      },
    });
    deps.studies.save({ videoId, kind: 'watch', engine: answer.engine, text: answer.text }, deps.now());
    return { by: answer.engine, note: null };
  } catch (error) {
    stopIfClosing(deps);
    return { by: null, note: `Not watched, so its sound is not known: ${reasonOf(error)}` };
  }
}

/** Frames cut from the file when ffmpeg is there, else YouTube's preview frames (never for a file). */
async function framesToStudy(
  deps: OneVideoDeps,
  target: VideoTarget,
  file: HeldFile,
  say: Say,
): Promise<StudiedFrames | null> {
  if (file.ok && (await deps.files.canCut())) {
    say('frames', 'Cutting one frame a second from the file');
    const cut = await deps.files.cut(target.videoId, file.path);
    stopIfClosing(deps);
    if (cut.ok) return deps.framesAvailable(target.videoId);
  }
  return target.kind === 'file' ? null : deps.framesAvailable(target.videoId);
}

/** Has an engine that sees pictures go through the frames; a study already stored is reused. */
async function studyIt(
  deps: OneVideoDeps,
  target: VideoTarget,
  file: HeldFile,
  choices: OneVideoChoices,
  say: Say,
): Promise<FramesStudied> {
  const { videoId } = target;
  const kept = choices.fresh ? null : deps.studies.find(videoId, 'frames');
  // A study from preview frames is made again once frames can be cut from a file.
  if (kept !== null && (kept.frames?.source === 'file' || !file.ok)) {
    return { by: kept.engine, note: null, frames: kept.frames };
  }
  try {
    const frames = await framesToStudy(deps, target, file, say);
    if (frames === null) return { by: null, note: NO_FRAMES, frames: null };
    say('frames', `An AI is going through its ${frames.available} frames`);
    const answer = await deps.studyFrames(videoId, choices.only);
    deps.studies.save({ videoId, kind: 'frames', engine: answer.engine, text: answer.text, frames }, deps.now());
    return { by: answer.engine, note: null, frames };
  } catch (error) {
    stopIfClosing(deps);
    return { by: null, note: `Frames not studied: ${reasonOf(error)}`, frames: null };
  }
}

/** How the video was seen, in the form it is kept. */
function seenOf(
  file: HeldFile,
  watched: Studied,
  frames: FramesStudied,
  captions: VideoSeen['captions'],
): VideoSeen {
  return {
    file: file.ok ? file.used : 'none',
    fileNote: file.ok ? null : file.reason,
    watchedBy: watched.by,
    framesBy: frames.by,
    frameSource: frames.frames?.source ?? null,
    frames: frames.frames?.available ?? null,
    captions,
    notes: [watched.note, frames.note].flatMap((note) => note ?? []),
  };
}

/** A kept breakdown as the page shows it, the prompts lifted out. */
export function videoBreakdownView(entry: StoredVideoBreakdown): VideoBreakdownView {
  const lifted = entry.written === null ? null : liftOneVideoPrompts(entry.written.text);
  return {
    videoId: entry.videoId,
    source: entry.source,
    title: entry.title,
    channelId: entry.channelId,
    writtenAt: entry.writtenAt.toISOString(),
    seen: entry.seen,
    engine: entry.written?.engine ?? null,
    body: lifted?.body ?? null,
    prompts: lifted?.prompts ?? { script: null, visual: null, thumbnail: null },
    problem: entry.problem,
  };
}

const shown = (title: string): string =>
  title.length > MAX_TITLE_SHOWN ? `${title.slice(0, MAX_TITLE_SHOWN)}…` : title;

/** Watches and studies the video with whatever this computer has, keeping what each engine wrote. */
async function study(deps: OneVideoDeps, target: VideoTarget, choices: OneVideoChoices, say: Say) {
  const about = await describe(deps, target);
  const captions = await captionsOf(deps, target);
  const file = await fileFor(deps, target, about, say);
  try {
    const watched = await watchIt(deps, target, file, choices, say);
    const frames = await studyIt(deps, target, file, choices, say);
    return { about, seen: seenOf(file, watched, frames, captions) };
  } finally {
    // Only what Jgtube made is removed: the cut frames and a copy it downloaded.
    await deps.files.removeFrames(target.videoId).catch(() => undefined);
    if (file.ok) await file.remove?.().catch(() => undefined);
  }
}

/**
 * Breaks one video down and resolves with the kept breakdown. Rejects when
 * there is nothing to go on, when the writing fails (the reason is kept),
 * or when Jgtube is closing.
 */
export async function breakDownVideo(
  deps: OneVideoDeps,
  target: VideoTarget,
  report: (progress: OneVideoProgress) => void,
  choices: OneVideoChoices = {},
): Promise<VideoBreakdownView> {
  const say: Say = (step, text) => report({ step, text });
  say('reading', target.kind === 'file' ? 'Opening the file you gave' : 'Reading the video and its captions');
  const { about, seen } = await study(deps, target, choices, say);
  stopIfClosing(deps);
  if (seen.watchedBy === null && seen.framesBy === null && seen.captions !== 'read') {
    throw new Error(NOTHING_TO_GO_ON);
  }
  const title = about.title ?? `YouTube video ${target.videoId}`;
  const kept = { videoId: target.videoId, source: target.kind, title, channelId: about.channelId, seen };
  say('writing', `Writing the breakdown of “${shown(title)}”`);
  const focus: OneVideoFocus = {
    kind: 'one-video',
    videoId: target.videoId,
    watched: seen.watchedBy !== null,
    frames: seen.framesBy !== null,
    captions: seen.captions === 'read',
  };
  const analysis: OneVideoAnalysisId = target.kind === 'file' ? 'one-video-file' : 'one-video';
  try {
    const answer = await deps.write(analysis, focus, choices.only);
    deps.store.save({ ...kept, written: { engine: answer.engine, text: answer.text } }, deps.now());
  } catch (error) {
    stopIfClosing(deps);
    deps.store.save({ ...kept, problem: reasonOf(error) }, deps.now());
    throw error;
  }
  const stored = deps.store.find(target.videoId);
  if (stored === null) throw new Error('The breakdown was written but could not be read back.');
  return videoBreakdownView(stored);
}
