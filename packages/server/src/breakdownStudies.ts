/**
 * The study of each deep video of a breakdown: a file is looked for (the
 * owner's own, else a download), an engine watches it for sound and editing,
 * and an engine goes through its frames, cut from the file one a second or,
 * with no file, YouTube's own preview frames. What each engine wrote is
 * stored per video and reused the next time.
 *
 * Nothing that could not be done fails the job: it is recorded with a plain
 * reason.
 */
import {
  BREAKDOWN_CONTRAST_VIDEOS,
  tooLongToWatch,
  type BreakdownPicks,
  type BreakdownVideo,
  type StoredVideoStudy,
  type StudiedFrames,
} from '@jgtube/core';
import { ENGINE_NAMES } from './breakdownBasis';
import type { BreakdownDeps } from './breakdownEngine';
import { WATCH_QUESTION } from './breakdownQuestions';
import type {
  BreakdownChoices,
  BreakdownProgress,
  BreakdownStep,
  FrameStudyResult,
  StudiedVideo,
  StudyResult,
  VideoFileUsed,
  VideoToSupply,
} from './breakdownTypes';
import type { MeasureOutcome } from './channelMeasure';
import type { DownloadVideo } from './engines/videoWatch';
import { cleanMessage } from './jobs';
import { CLOSING } from './running';

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
export const reasonOf = (error: unknown): string => sentence(cleanMessage(error));

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
export interface Teller {
  say(step: BreakdownStep, text: string): void;
  supply(video: VideoToSupply): void;
  supplied(): readonly VideoToSupply[];
}

export function teller(report: (progress: BreakdownProgress) => void): Teller {
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

export function stopIfClosing(deps: BreakdownDeps): void {
  if (deps.stop.aborted) throw new Error(CLOSING);
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
  const toMeasure = needsMeasuring(deps, videoId, run.choices, canCut);
  // A file is looked for only when something here would use it: a watch by an
  // engine that opens files, frames cut by ffmpeg that are not stored yet, or
  // measurements not kept yet.
  const needsFile =
    (kept.watch === null && canWatch) ||
    (canCut && kept.frames?.frames?.source !== 'file') ||
    toMeasure;
  const file: HeldFile = needsFile
    ? await fileFor(deps, video, run)
    : { ok: false, reason: canCut || canWatch ? NOTHING_NEEDED : NO_TOOLS_FOR_A_FILE };
  try {
    const watch =
      kept.watch === null ? await watchOne(deps, video, file, run) : keptStudy(kept.watch);
    const frames = await studyFramesOf(deps, video, file, kept.frames, run);
    const measured = await measureOne(deps, videoId, file, run, toMeasure);
    const used: VideoFileUsed = file.ok
      ? { used: file.used }
      : { used: 'none', reason: file.reason };
    return { videoId, title, file: used, watch, frames, ...(measured ? { measured } : {}) };
  } finally {
    // Only what Jgtube made is removed: the cut frames and a copy it downloaded.
    await deps.files.removeFrames(videoId).catch(() => undefined);
    if (file.ok) await file.remove?.().catch(() => undefined);
  }
}

/** Whether a video still needs measuring in code: the measuring is wired, ffmpeg is here, and nothing is kept. */
function needsMeasuring(
  deps: BreakdownDeps,
  videoId: string,
  choices: BreakdownChoices,
  canCut: boolean,
): boolean {
  if (deps.measure === undefined || !canCut) return false;
  return choices.fresh === true || !(deps.isMeasured?.(videoId) ?? false);
}

/** The captions of a video as timed lines, when they are stored or can be read. */
async function captionLines(deps: BreakdownDeps, videoId: string) {
  try {
    const { transcript } = await deps.readTranscript(videoId);
    return transcript === null
      ? null
      : transcript.segments.map((segment) => ({ at: segment.startMs / 1000, text: segment.text }));
  } catch {
    stopIfClosing(deps);
    return null;
  }
}

/** Measures one video in code from the file in hand; kept when nothing needs doing; undefined when not wired. */
async function measureOne(
  deps: BreakdownDeps,
  videoId: string,
  file: HeldFile,
  run: VideoRun,
  toMeasure: boolean,
): Promise<MeasureOutcome | undefined> {
  if (deps.measure === undefined) return undefined;
  if (!toMeasure) return deps.isMeasured?.(videoId) ? { state: 'kept' } : undefined;
  if (!file.ok) return { state: 'failed', reason: file.reason };
  run.tell.say('measuring', `${run.label}: measuring every frame and its sound in code`);
  try {
    const outcome = await deps.measure(
      videoId,
      file.path,
      run.choices.fresh === true,
      await captionLines(deps, videoId),
      (text) => run.tell.say('measuring', `${run.label}: ${text.toLowerCase()}`),
    );
    stopIfClosing(deps);
    return outcome;
  } catch (error) {
    stopIfClosing(deps);
    return { state: 'failed', reason: reasonOf(error) };
  }
}

/**
 * Measures a few ordinary videos in code too (no AI), so the parts can set
 * the winners' numbers beside them. A video that cannot be had is skipped.
 */
export async function measureContrast(
  deps: BreakdownDeps,
  picks: BreakdownPicks,
  choices: BreakdownChoices,
  tell: Teller,
): Promise<void> {
  if (deps.measure === undefined || !(await deps.files.canCut())) return;
  const chosen = picks.ordinary.slice(0, BREAKDOWN_CONTRAST_VIDEOS);
  for (const [index, video] of chosen.entries()) {
    stopIfClosing(deps);
    if (!needsMeasuring(deps, video.videoId, choices, true) || tooLongToWatch(video) !== null)
      continue;
    const label = `Ordinary video ${index + 1} of ${chosen.length}, “${shown(video.title)}”`;
    const own = await deps.files.own(video.videoId);
    if (own === null) tell.say('downloading', `${label}: downloading the video to measure it`);
    const copy = own === null ? await deps.files.fetch(video.videoId, deps.stop) : null;
    const file: HeldFile =
      own !== null
        ? { ok: true, path: own, used: 'own' }
        : copy?.ok
          ? { ok: true, path: copy.path, used: 'downloaded', remove: copy.remove }
          : { ok: false, reason: 'not downloaded' };
    try {
      await measureOne(deps, video.videoId, file, { label, choices, tell }, true);
    } finally {
      if (file.ok) await file.remove?.().catch(() => undefined);
    }
  }
}

const shown = (title: string): string =>
  title.length > MAX_TITLE_SHOWN ? `${title.slice(0, MAX_TITLE_SHOWN)}…` : title;

/** Studies each deep video in turn: a file, a watch, its frames. */
export async function studyDeep(
  deps: BreakdownDeps,
  picks: BreakdownPicks,
  choices: BreakdownChoices,
  tell: Teller,
): Promise<readonly StudiedVideo[]> {
  let deep: readonly StudiedVideo[] = [];
  for (const [index, video] of picks.deep.entries()) {
    stopIfClosing(deps);
    const label = `Video ${index + 1} of ${picks.deep.length}, “${shown(video.title)}”`;
    deep = [...deep, await studyVideo(deps, video, { label, choices, tell })];
  }
  return deep;
}
