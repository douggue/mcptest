/**
 * The production teardown of one video, as a pipeline led by code:
 *
 * 1. measure the file in code (length, cuts, loudness, keyframes, colours,
 *    every frame for transitions and motion, strips of frames);
 * 2. keep the transcript (captions, else what the engine that watches heard);
 * 3. have an engine name the chapters, then cut a sheet per chapter;
 * 4. have the engine that watches (Antigravity) watch it with sound, chapter
 *    by chapter, when it can;
 * 5. have engines judge the hook, the design system, the component library,
 *    the motion vocabulary (from pictures), the techniques, the sound and the
 *    replication plan, each as checked JSON.
 *
 * Every part is stored as soon as it is made and reused on a later run
 * unless the owner asks for it fresh. A part that cannot be made is stored
 * with its reason and the rest go on.
 */
import {
  OPENING_SECONDS,
  buildTeardownReport,
  checkStage,
  chapterSpans,
  type Measured,
  type TeardownMeasurements,
  type TeardownPart,
  type TeardownRepo,
  type TeardownStage,
  type TimedLine,
} from '@jgtube/core';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import { cleanMessage } from './jobs';
import { CLOSING } from './running';
import { STAGE_TITLES, watchQuestion, type JudgedStage } from './teardownQuestions';
import type { TeardownAsk, TeardownPicture } from './teardownRequests';
import { teardownInput } from './teardownStore';

export interface TeardownDeps {
  readonly now: () => Date;
  readonly stop: AbortSignal;
  readonly repo: TeardownRepo;
  /** The folder this video's pictures go in; null when there is no downloads folder. */
  folder(videoId: string): string | null;
  measure(path: string, folder: string, onStep: (text: string) => void): Promise<Measured>;
  chapterSheets(
    path: string,
    folder: string,
    spans: readonly { readonly start: number; readonly end: number }[],
  ): Promise<Readonly<Record<string, string>>>;
  /** Whether an engine here watches a video file with its sound. */
  watchesFiles(): Promise<boolean>;
  watch(
    videoId: string,
    question: string,
    path: string,
    fileOnly: boolean,
  ): Promise<{ readonly engine: string; readonly text: string }>;
  ask(ask: TeardownAsk, only?: EngineId): Promise<EngineAnswer<EngineId>>;
}

export interface TeardownRun {
  readonly videoId: string;
  /** The file to measure and watch; null when there is none (its reason is stored). */
  readonly path: string | null;
  readonly fileNote: string | null;
  readonly captions: readonly TimedLine[] | null;
  readonly fileOnly: boolean;
  readonly only?: EngineId | undefined;
  readonly fresh?: boolean | undefined;
}

export interface TeardownOutcome {
  readonly watchedBy: string | null;
  readonly lookedBy: string | null;
  readonly runs: number;
}

/** The judged stages after the chapters, in order. */
const LATER_STAGES: readonly JudgedStage[] = [
  'hook',
  'design',
  'archetypes',
  'motion',
  'techniques',
  'sound',
  'plan',
];
const MAX_HOOK_PICTURES = 7;
const MAX_SHEET_PICTURES = 6;
const MAX_KEYFRAME_PICTURES = 24;
const MAX_STRIP_PICTURES = 16;

const spread = <T>(items: readonly T[], count: number): readonly T[] =>
  items.length <= count
    ? items
    : Array.from(
        { length: count },
        (_, index) => items[Math.floor((index * items.length) / count)] as T,
      );

/** The pictures one stage looks at, chosen and capped in code. */
export function picturesFor(
  stage: JudgedStage,
  measured: TeardownMeasurements | null,
  sheets: Readonly<Record<string, string>>,
  folder: string,
): readonly TeardownPicture[] {
  if (measured === null) return [];
  const at = (name: string): TeardownPicture => ({ name, path: join(folder, name) });
  const keyframes = measured.keyframes.map((frame) => frame.file);
  switch (stage) {
    case 'hook':
      return [
        ...(measured.hookSheet ? [measured.hookSheet.file] : []),
        ...measured.keyframes
          .filter((frame) => frame.at < OPENING_SECONDS)
          .map((frame) => frame.file),
      ]
        .slice(0, MAX_HOOK_PICTURES)
        .map(at);
    case 'design': {
      const chapterSheets = Object.values(sheets);
      return (
        chapterSheets.length > 0 ? spread(chapterSheets, MAX_SHEET_PICTURES) : spread(keyframes, 8)
      ).map(at);
    }
    case 'archetypes':
      return spread(keyframes, MAX_KEYFRAME_PICTURES).map(at);
    case 'motion':
      return spread(
        measured.motion?.strips.map((strip) => strip.file) ?? [],
        MAX_STRIP_PICTURES,
      ).map(at);
    default:
      return [];
  }
}

const sentence = (text: string): string => `${text.trim().replace(/\.$/, '')}.`;

function stopIfClosing(deps: TeardownDeps): void {
  if (deps.stop.aborted) throw new Error(CLOSING);
}

/** Whether a part is stored as made, so a run that is not fresh keeps it. */
const kept = (deps: TeardownDeps, run: TeardownRun, part: TeardownPart): boolean =>
  !run.fresh && deps.repo.find(run.videoId, part)?.json != null;

/** The stages a run would still make, so the owner sees the AI runs before starting. */
export async function plannedRuns(
  deps: Pick<TeardownDeps, 'repo' | 'watchesFiles'>,
  videoId: string,
  fresh: boolean,
  hasFile: boolean,
): Promise<{ readonly runs: number; readonly kept: number; readonly watch: boolean }> {
  const watch = hasFile && (await deps.watchesFiles());
  const stages: readonly TeardownStage[] = [
    'structure',
    ...(watch ? (['watch'] as const) : []),
    ...LATER_STAGES,
  ];
  const done = fresh
    ? 0
    : stages.filter((stage) => deps.repo.find(videoId, stage)?.json != null).length;
  return { runs: stages.length - done, kept: done, watch };
}

async function measureStep(
  deps: TeardownDeps,
  run: TeardownRun,
  say: (text: string) => void,
): Promise<void> {
  const folder = deps.folder(run.videoId);
  const stored = deps.repo.find(run.videoId, 'measured');
  if (kept(deps, run, 'measured') && folder !== null) return;
  if (run.path === null || folder === null) {
    if (stored?.json == null) {
      const reason =
        run.path === null
          ? (run.fileNote ?? 'There was no file to measure.')
          : 'There is no downloads folder to keep its pictures in.';
      deps.repo.save(run.videoId, 'measured', { problem: sentence(reason) }, deps.now());
    }
    return;
  }
  await rm(folder, { recursive: true, force: true });
  const measured = await deps.measure(run.path, folder, (text) =>
    say(`Measuring in code: ${text.toLowerCase()}`),
  );
  stopIfClosing(deps);
  deps.repo.save(
    run.videoId,
    'measured',
    measured.ok
      ? { engine: 'jgtube', json: JSON.stringify(measured.measurements) }
      : { problem: `It could not be measured: ${sentence(measured.reason)}` },
    deps.now(),
  );
  deps.repo.save(run.videoId, 'sheets', { engine: 'jgtube', json: '{}' }, deps.now());
}

function saveTranscript(deps: TeardownDeps, run: TeardownRun): void {
  if (run.captions === null || run.captions.length === 0) return;
  const json = JSON.stringify({ source: 'captions', lines: run.captions });
  deps.repo.save(run.videoId, 'transcript', { engine: 'jgtube', json }, deps.now());
}

/** Asks one judged stage and keeps what it answered, checked; or why it could not. */
async function judge(
  deps: TeardownDeps,
  run: TeardownRun,
  stage: JudgedStage,
  pictures: readonly TeardownPicture[],
  heard: boolean,
): Promise<string | null> {
  if (kept(deps, run, stage)) return deps.repo.find(run.videoId, stage)?.engine ?? null;
  const input = teardownInput(deps.repo, run.videoId);
  if (['hook', 'design', 'archetypes', 'motion'].includes(stage) && pictures.length === 0) {
    deps.repo.save(
      run.videoId,
      stage,
      { problem: 'There were no pictures to look at: the video could not be measured.' },
      deps.now(),
    );
    return null;
  }
  try {
    const answer = await deps.ask(
      {
        stage,
        videoId: run.videoId,
        heard,
        chapterCount: Object.keys(input.sheets).length,
        pictures,
      },
      run.only,
    );
    const checked = checkStage(stage, answer.text);
    deps.repo.save(
      run.videoId,
      stage,
      checked.ok
        ? { engine: answer.engine, json: JSON.stringify(checked.data) }
        : { problem: `${answer.engine} answered, but ${checked.reason}.` },
      deps.now(),
    );
    return checked.ok ? answer.engine : null;
  } catch (error) {
    stopIfClosing(deps);
    deps.repo.save(run.videoId, stage, { problem: sentence(cleanMessage(error)) }, deps.now());
    return null;
  }
}

async function sheetsStep(deps: TeardownDeps, run: TeardownRun): Promise<void> {
  const folder = deps.folder(run.videoId);
  const input = teardownInput(deps.repo, run.videoId);
  if (run.path === null || folder === null || input.measured === null) return;
  if (Object.keys(input.sheets).length > 0 && !run.fresh) return;
  const report = chapterSpans(
    buildTeardownReport(input).stages.structure,
    input.measured.video.durationSeconds,
  );
  const made = await deps.chapterSheets(run.path, folder, report.items);
  deps.repo.save(
    run.videoId,
    'sheets',
    { engine: 'jgtube', json: JSON.stringify(made) },
    deps.now(),
  );
}

async function watchStep(
  deps: TeardownDeps,
  run: TeardownRun,
  say: (text: string) => void,
): Promise<string | null> {
  if (kept(deps, run, 'watch')) return deps.repo.find(run.videoId, 'watch')?.engine ?? null;
  if (run.path === null || !(await deps.watchesFiles())) return null;
  const input = teardownInput(deps.repo, run.videoId);
  const duration = input.measured?.video.durationSeconds ?? 0;
  const spans =
    duration > 0 ? chapterSpans(buildTeardownReport(input).stages.structure, duration).items : [];
  const path = run.path;
  say(`Stage 2: ${STAGE_TITLES.watch}`);
  try {
    const answer = await deps.watch(
      run.videoId,
      watchQuestion(spans, (input.transcript?.lines.length ?? 0) === 0),
      path,
      run.fileOnly,
    );
    const checked = checkStage('watch', answer.text);
    if (!checked.ok) {
      deps.repo.save(
        run.videoId,
        'watch',
        { problem: `${answer.engine} watched it, but ${checked.reason}.` },
        deps.now(),
      );
      return null;
    }
    deps.repo.save(
      run.videoId,
      'watch',
      { engine: answer.engine, json: JSON.stringify(checked.data) },
      deps.now(),
    );
    if ((input.transcript?.lines.length ?? 0) === 0 && checked.data.transcript.length > 0) {
      const json = JSON.stringify({ source: 'heard', lines: checked.data.transcript });
      deps.repo.save(run.videoId, 'transcript', { engine: answer.engine, json }, deps.now());
    }
    return answer.engine;
  } catch (error) {
    stopIfClosing(deps);
    deps.repo.save(
      run.videoId,
      'watch',
      { problem: `Not watched, so its sound was not heard: ${sentence(cleanMessage(error))}` },
      deps.now(),
    );
    return null;
  }
}

/** Runs the whole teardown, keeping every part as it is made. */
export async function runTeardown(
  deps: TeardownDeps,
  run: TeardownRun,
  say: (text: string) => void,
): Promise<TeardownOutcome> {
  const planned = await plannedRuns(deps, run.videoId, run.fresh === true, run.path !== null);
  await measureStep(deps, run, say);
  saveTranscript(deps, run);
  stopIfClosing(deps);
  const total = LATER_STAGES.length + 2;
  say(`Stage 1 of ${total}: ${STAGE_TITLES.structure}`);
  await judge(deps, run, 'structure', [], false);
  stopIfClosing(deps);
  await sheetsStep(deps, run);
  const watchedBy = await watchStep(deps, run, say);
  stopIfClosing(deps);
  const heard = deps.repo.find(run.videoId, 'watch')?.json != null;
  const folder = deps.folder(run.videoId) ?? '';
  let lookedBy: string | null = null;
  for (const [index, stage] of LATER_STAGES.entries()) {
    say(`Stage ${index + 3} of ${total}: ${STAGE_TITLES[stage]}`);
    const input = teardownInput(deps.repo, run.videoId);
    const engine = await judge(
      deps,
      run,
      stage,
      picturesFor(stage, input.measured, input.sheets, folder),
      heard,
    );
    if (stage === 'archetypes') lookedBy = engine;
    stopIfClosing(deps);
  }
  return { watchedBy, lookedBy, runs: planned.runs };
}
