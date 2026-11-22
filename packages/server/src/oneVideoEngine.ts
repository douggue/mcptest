/**
 * The deep breakdown of one video: a production teardown led by code. The
 * video is named and its captions read (a YouTube video), a file is found
 * (the owner's own copy, a 720p download, or the file the owner gave), and
 * the teardown pipeline measures it in code and has engines judge it stage by
 * stage (`teardownEngine.ts`). How the video was seen is recorded in code and
 * kept beside it; the whole teardown is also kept as Markdown in the list of
 * one-video breakdowns.
 *
 * What could not be done is recorded with a plain reason. The job fails only
 * when nothing at all could be measured or judged, or when Jgtube is closing.
 */
import {
  MAX_VIDEO_BREAKDOWN_CHARS,
  teardownMarkdown,
  tooLongToWatch,
  type StoredVideoBreakdown,
  type TimedLine,
  type TranscriptResult,
  type VideoBreakdownRepo,
  type VideoSeen,
} from '@jgtube/core';
import { ENGINE_NAMES } from './breakdownBasis';
import type { BreakdownFiles } from './breakdownEngine';
import type {
  OneVideoChoices,
  OneVideoProgress,
  OneVideoStep,
  VideoBreakdownView,
  VideoTarget,
} from './oneVideoTypes';
import { CLOSING } from './running';
import {
  plannedRuns,
  runTeardown,
  type TeardownDeps,
  type TeardownOutcome,
} from './teardownEngine';
import { teardownReportOf } from './teardownStore';

export interface OneVideoDeps {
  readonly now: () => Date;
  /** Aborted when Jgtube is closing. */
  readonly stop: AbortSignal;
  readonly store: VideoBreakdownRepo;
  readonly files: BreakdownFiles;
  readonly teardown: TeardownDeps;
  /** Where the file the owner gave under this id is; null when it is not there. */
  uploadPath(videoId: string): Promise<string | null>;
  /** A YouTube video's title, channel and length, read once; nulls for what is not known. */
  details(videoId: string): Promise<VideoAbout>;
  readTranscript(videoId: string): Promise<TranscriptResult>;
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

const NOTHING_MADE = 'Nothing could be measured or judged for this video, so there is no teardown.';
const NO_UPLOAD = 'The video file you gave is no longer on this computer. Choose it again.';
const NO_FILE_NEEDED = 'Everything was kept from an earlier run, so no file was needed.';
const MAX_TITLE_SHOWN = 80;
const MS = 1000;

const withoutStop = (text: string): string => text.trim().replace(/\.$/, '');
const sentence = (text: string): string => `${withoutStop(text)}.`;
const nameOf = (engine: string): string => ENGINE_NAMES[engine] ?? engine;

function stopIfClosing(deps: OneVideoDeps): void {
  if (deps.stop.aborted) throw new Error(CLOSING);
}

async function describe(deps: OneVideoDeps, target: VideoTarget): Promise<VideoAbout> {
  if (target.kind === 'file') return { title: target.name, channelId: null, durationSeconds: null };
  try {
    return await deps.details(target.videoId);
  } catch {
    stopIfClosing(deps);
    return { title: null, channelId: null, durationSeconds: null };
  }
}

interface Captions {
  readonly state: VideoSeen['captions'];
  readonly lines: readonly TimedLine[] | null;
}

async function captionsOf(deps: OneVideoDeps, target: VideoTarget): Promise<Captions> {
  if (target.kind === 'file') return { state: 'not-asked', lines: null };
  try {
    const { transcript } = await deps.readTranscript(target.videoId);
    if (transcript === null) return { state: 'none', lines: null };
    const lines = transcript.segments.map((segment) => ({
      at: segment.startMs / MS,
      text: segment.text,
    }));
    return { state: 'read', lines };
  } catch {
    stopIfClosing(deps);
    return { state: 'failed', lines: null };
  }
}

/** The file to measure and watch: the one given, the owner's own, else a 720p download. */
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

/** Whether a file is needed at all: not when every part is kept from an earlier run. */
async function needsFile(
  deps: OneVideoDeps,
  target: VideoTarget,
  choices: OneVideoChoices,
): Promise<boolean> {
  if (target.kind === 'file' || choices.fresh) return true;
  const measured = deps.teardown.repo.find(target.videoId, 'measured');
  if (measured?.json == null) return true;
  return (await plannedRuns(deps.teardown, target.videoId, false, true)).runs > 0;
}

function seenOf(
  file: HeldFile | null,
  outcome: TeardownOutcome,
  captions: Captions,
  frames: number | null,
): VideoSeen {
  return {
    file: file === null ? 'none' : file.ok ? file.used : 'none',
    fileNote: file === null ? NO_FILE_NEEDED : file.ok ? null : file.reason,
    watchedBy: outcome.watchedBy,
    framesBy: outcome.lookedBy,
    frameSource: frames === null ? null : 'file',
    frames,
    captions: captions.state,
    notes: [],
  };
}

function seenLines(seen: VideoSeen): readonly string[] {
  return [
    seen.watchedBy === null
      ? 'Not watched with sound: sound rests on the measured loudness.'
      : `Watched with sound by ${nameOf(seen.watchedBy)}.`,
    seen.frames === null ? 'No frames were measured.' : `${seen.frames} frames measured in code.`,
    seen.framesBy === null ? '' : `Pictures studied by ${nameOf(seen.framesBy)}.`,
  ].filter((line) => line !== '');
}

/** A kept breakdown as the page shows it, with its teardown when there is one. */
export function videoBreakdownView(
  entry: StoredVideoBreakdown,
  deps: Pick<OneVideoDeps, 'teardown'>,
): VideoBreakdownView {
  return {
    videoId: entry.videoId,
    source: entry.source,
    title: entry.title,
    channelId: entry.channelId,
    writtenAt: entry.writtenAt.toISOString(),
    seen: entry.seen,
    engine: entry.written?.engine ?? null,
    problem: entry.problem,
    teardown: teardownReportOf(deps.teardown.repo, entry.videoId),
  };
}

const shown = (title: string): string =>
  title.length > MAX_TITLE_SHOWN ? `${title.slice(0, MAX_TITLE_SHOWN)}…` : title;

/**
 * Takes one video apart and resolves with the kept breakdown. Rejects when
 * nothing at all could be measured or judged, or when Jgtube is closing.
 */
export async function breakDownVideo(
  deps: OneVideoDeps,
  target: VideoTarget,
  report: (progress: OneVideoProgress) => void,
  choices: OneVideoChoices = {},
): Promise<VideoBreakdownView> {
  const say: Say = (step, text) => report({ step, text });
  const { videoId } = target;
  say(
    'reading',
    target.kind === 'file' ? 'Opening the file you gave' : 'Reading the video and its captions',
  );
  const about = await describe(deps, target);
  const captions = await captionsOf(deps, target);
  const file = (await needsFile(deps, target, choices))
    ? await fileFor(deps, target, about, say)
    : null;
  const title = about.title ?? `YouTube video ${videoId}`;
  let outcome: TeardownOutcome;
  try {
    say('measuring', `Taking “${shown(title)}” apart`);
    outcome = await runTeardown(
      deps.teardown,
      {
        videoId,
        path: file?.ok ? file.path : null,
        fileNote: file !== null && !file.ok ? file.reason : null,
        captions: captions.lines,
        fileOnly: target.kind === 'file',
        only: choices.only,
        fresh: choices.fresh,
      },
      (text) => say('judging', text),
    );
  } finally {
    if (file?.ok) await file.remove?.().catch(() => undefined);
  }
  stopIfClosing(deps);
  const made = teardownReportOf(deps.teardown.repo, videoId);
  const frames = made?.measured?.motion?.frames ?? made?.measured?.keyframes.length ?? null;
  const seen = seenOf(file, outcome, captions, made?.measured ? frames : null);
  deps.teardown.repo.save(
    videoId,
    'about',
    {
      engine: 'jgtube',
      json: JSON.stringify({
        title,
        source: target.kind,
        channelId: about.channelId,
        seen: seenLines(seen),
      }),
    },
    deps.now(),
  );
  const anything =
    made !== null &&
    (made.measured !== null || Object.values(made.stages).some((stage) => stage.state === 'done'));
  const kept = { videoId, source: target.kind, title, channelId: about.channelId, seen };
  if (!anything) {
    const reasons = [file !== null && !file.ok ? file.reason : null, made?.measuredProblem ?? null];
    const problem = [NOTHING_MADE, ...reasons.flatMap((reason) => reason ?? [])].join(' ');
    deps.store.save({ ...kept, problem }, deps.now());
    throw new Error(problem);
  }
  const text = teardownMarkdown(teardownReportOf(deps.teardown.repo, videoId) ?? made).slice(
    0,
    MAX_VIDEO_BREAKDOWN_CHARS,
  );
  deps.store.save({ ...kept, written: { engine: 'jgtube', text } }, deps.now());
  const stored = deps.store.find(videoId);
  if (stored === null) throw new Error('The breakdown was made but could not be read back.');
  return videoBreakdownView(stored, deps);
}
