/**
 * The part of the engine that asks an AI: the fixed analyses, watching a
 * video, and what is known about the AI engines on this computer.
 */
import { downloadsRoot, type Config } from '@jgtube/core';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYSES,
  FRAME_STUDY_TITLE,
  PICTURE_ENGINES,
  SERVER_NAME,
  VIDEO_SYSTEM_PROMPT,
  analysisRequest,
  enginesFor,
  frameStudyRequest,
  type AnalysisSettings,
} from './analyses';
import type { Engine } from './app';
import { checkEngines, createEngines, type Engines } from './engines/catalog';
import { firstAnswer, type EngineAnswer } from './engines/fallback';
import type { GeminiFetch } from './engines/geminiVideo';
import { spawnProcess } from './engines/process';
import { DEFAULT_ENGINE_SETTINGS, type EngineSettings } from './engines/settings';
import type {
  EngineDeps,
  EngineId,
  EngineRunRequest,
  EngineRunResult,
  EngineStatus,
  SpawnProcess,
} from './engines/types';
import { watchVideo, type DownloadVideo } from './engines/videoWatch';
import type { WorkTracker } from './running';

const IN_MEMORY = ':memory:';
/** The Jgtube folder: the connector the engines are given lives under it. */
const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
/** Prefix of the private folder the engines start in. */
const WORK_PREFIX = join(tmpdir(), 'jgtube-engines-');
const OWNER_ONLY = 0o700;
/** The folder, inside the private one, where an engine watches a video. */
const VIDEO_FOLDER = 'video';
/**
 * How long what was learnt about the engines is reused. Finding out starts
 * several programs, which is too much for every opening of the page, and
 * installing or signing in to one takes longer than this anyway.
 */
const STATUS_FRESH_MS = 60_000;
/** A work folder this old was left behind by a run that was cut short. */
const LEFTOVER_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AnalysisOptions {
  /** The store as the connector should open it; defaults to the configured path made absolute. */
  readonly storePath?: string;
  /** The owner's settings for the engines; without them, the usual order and no Gemini key. */
  readonly engines?: EngineSettings;
  /**
   * Fetches a video to a file on this computer for an engine to watch. The
   * engine connects core's downloader here; a test may put a stand-in. With
   * none, video is watched through the Gemini API only.
   */
  readonly downloadVideo?: DownloadVideo;
  /** Replaces running an engine; used by tests. The signal aborts when the engine shuts down. */
  readonly runEngine?: (
    id: EngineId,
    request: EngineRunRequest,
    stop: AbortSignal,
  ) => Promise<EngineRunResult>;
  /** Replaces asking the engines about themselves; used by tests. */
  readonly checkEngines?: () => Promise<readonly EngineStatus[]>;
  /** Replaces starting programs; used by tests. */
  readonly spawn?: SpawnProcess;
  /** Replaces the request to Google; used by tests. */
  readonly geminiFetch?: GeminiFetch;
}

export interface AnalysisWiring {
  readonly config: Config;
  readonly options: AnalysisOptions;
  /** The work under way, so shutting down can wait for it. */
  readonly work: WorkTracker;
}

export interface AnalysisParts extends Pick<Engine, 'analyse' | 'engineStatus' | 'watchVideo'> {
  /**
   * Has the first engine that sees pictures go through one video's frames,
   * start to end. Rejects with an EngineRunError like `analyse`.
   */
  studyFrames(videoId: string, only?: EngineId): Promise<EngineAnswer<EngineId>>;
  /** Whether an engine here would watch a video from a file: Antigravity, installed and not left out. */
  watchesFiles(): Promise<boolean>;
  /** Removes the private folder the engines were started in, if one was made. */
  cleanUp(): void;
}

/**
 * Removes work folders left behind by a run that was cut short (a crash, a
 * power cut, a program that would not let go) more than a day ago. They can
 * hold a copy of a video, so they are not left to pile up.
 */
function removeOldWorkFolders(): void {
  const parent = dirname(WORK_PREFIX);
  const prefix = basename(WORK_PREFIX);
  const oldest = Date.now() - LEFTOVER_AFTER_MS;
  try {
    for (const name of readdirSync(parent)) {
      const folder = join(parent, name);
      if (name.startsWith(prefix) && statSync(folder).mtimeMs < oldest) {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  } catch {
    // Another account's folder, or one in use: not ours to remove, and nothing depends on it.
  }
}

/** Private folders made on first use, one inside the other. */
function privateFolders() {
  let base: string | null = null;
  return {
    /**
     * A folder of its own for one engine. The outer folder is owner-only and
     * has a name nobody can guess, so no other account on the computer can
     * plant settings in it; each engine has its own so that one which may
     * write to its folder cannot plant settings for another.
     */
    for(name: string): string {
      if (base === null) {
        removeOldWorkFolders();
        base = mkdtempSync(WORK_PREFIX);
      }
      const folder = join(base, name);
      mkdirSync(folder, { recursive: true, mode: OWNER_ONLY });
      return folder;
    },
    remove(): void {
      if (base === null) return;
      try {
        rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // A program still letting go of its folder: closing the store matters more
        // than tidying up, and the folder is removed the next time engines start.
      }
    },
  };
}

/** Reuses what `load` found for `freshMs` before asking again. */
function remembered<T>(load: () => Promise<T>, freshMs: number): () => Promise<T> {
  let kept: { readonly at: number; readonly value: Promise<T> } | null = null;
  return () => {
    if (kept === null || Date.now() - kept.at > freshMs) {
      const value = load();
      const fresh = { at: Date.now(), value };
      kept = fresh;
      // A failure is not worth remembering: the next call asks again.
      value.catch(() => {
        if (kept === fresh) kept = null;
      });
    }
    return kept.value;
  };
}

/** What is being asked, as far as the message for "nobody could" needs it. */
interface Asked {
  readonly title: string;
  /** The engines that may answer it, when it cannot be left to every engine. */
  readonly engines?: readonly EngineId[];
}

/** What to say when no engine could answer; `only` is the one engine the owner chose, if any. */
function nobodyFor(
  asked: Asked,
  order: readonly EngineId[],
  engines: Engines,
  only?: EngineId,
): string {
  const chosen = only === undefined ? null : engines[only].label;
  if (order.length > 0) {
    return chosen === null
      ? 'None of the AI engines on this computer could answer.'
      : `${chosen} could not answer. Choose another AI, or Automatic, and try again.`;
  }
  const { title, engines: needed } = asked;
  const names = (needed ?? []).map((id) => engines[id].label).join(' or ');
  if (chosen !== null && only !== undefined && needed !== undefined && !needed.includes(only)) {
    return `${title} cannot be done by ${chosen}: it needs ${names}. Choose one of those, or Automatic.`;
  }
  if (chosen !== null) return `${chosen} is left out by the JGTUBE_ENGINES setting.`;
  return `${title} needs ${names}, and the JGTUBE_ENGINES setting leaves that out.`;
}

/** What the analyses and video watching are both built from. */
interface Shared {
  readonly settings: EngineSettings;
  readonly engines: Engines;
  readonly deps: EngineDeps;
  readonly folders: ReturnType<typeof privateFolders>;
  /** What is known about the engines, found out at most once a minute. */
  readonly statuses: () => Promise<readonly EngineStatus[]>;
}

/** The store as a file an engine's connector can open. Throws when it is only in memory. */
function storeFile({ config, options }: AnalysisWiring): string {
  if (options.storePath !== undefined) return options.storePath;
  if (config.dbPath === IN_MEMORY) {
    throw new Error(
      'An AI engine needs the store to be a file on disk, and this one is only in memory',
    );
  }
  return resolve(config.dbPath);
}

/** The downloads folder, for the connector to look in; none for a store that is only in memory. */
function downloadsPathOf(config: Config): string | undefined {
  try {
    return downloadsRoot(config);
  } catch {
    return undefined;
  }
}

/** The fixed analyses and the frame study, each put to the engines in order until one answers. */
function asker(
  shared: Shared,
  wiring: AnalysisWiring,
  stop: AbortSignal,
): Pick<AnalysisParts, 'analyse' | 'studyFrames'> {
  const { settings, engines, deps, folders } = shared;
  const run =
    wiring.options.runEngine ??
    ((id: EngineId, request: EngineRunRequest) => engines[id].run(request, deps));
  // The owner's choice of one engine means that engine and no backup.
  const allowedBy = (only?: EngineId): readonly EngineId[] =>
    only === undefined ? settings.order : settings.order.filter((id) => id === only);
  /** Where an engine's connector finds the store; throws when the store is only in memory. */
  const settingsFor = (): ((engine: EngineId) => AnalysisSettings) => {
    const dbPath = storeFile(wiring);
    const downloadsPath = downloadsPathOf(wiring.config);
    return (engine) => ({
      projectRoot: PROJECT_ROOT,
      dbPath,
      workDir: folders.for(engine),
      downloadsPath,
    });
  };
  const ask = (
    order: readonly EngineId[],
    requestFor: (engine: EngineId) => EngineRunRequest,
    nobody: string,
  ): Promise<EngineAnswer<EngineId>> =>
    firstAnswer(
      order.map((id) => ({ engine: id, run: () => run(id, requestFor(id), stop) })),
      nobody,
      () => stop.aborted,
    );
  return {
    async analyse(analysis, channel, only, focus) {
      const at = settingsFor();
      const order = enginesFor(analysis, allowedBy(only));
      return ask(
        order,
        (engine) => analysisRequest(analysis, channel, at(engine), focus),
        nobodyFor(ANALYSES[analysis], order, engines, only),
      );
    },
    async studyFrames(videoId, only) {
      const at = settingsFor();
      const order = allowedBy(only).filter((id) => PICTURE_ENGINES.includes(id));
      return ask(
        order,
        (engine) => frameStudyRequest(videoId, at(engine)),
        nobodyFor({ title: FRAME_STUDY_TITLE, engines: PICTURE_ENGINES }, order, engines, only),
      );
    },
  };
}

/** Whether Antigravity is on this computer. */
const agyInstalled = async (shared: Shared): Promise<boolean> =>
  (await shared.statuses()).some((status) => status.id === 'agy' && status.installed);

/** One video, watched by the first engine that can. */
function watcher(shared: Shared, options: AnalysisOptions): Engine['watchVideo'] {
  const { settings, deps, folders } = shared;
  return (videoId, question, watch = {}) =>
    watchVideo(
      { videoId, question, systemPrompt: VIDEO_SYSTEM_PROMPT },
      {
        settings,
        deps,
        workDir: folders.for(VIDEO_FOLDER),
        agyInstalled: () => agyInstalled(shared),
        download: watch.download ?? options.downloadVideo,
        geminiFetch: options.geminiFetch,
        onStep: watch.onStep,
      },
    );
}

/** The fixed analyses and video watching, each a boxed-in run that `stop` can end. */
export function analysisEngines(wiring: AnalysisWiring, stop: AbortSignal): AnalysisParts {
  const { options, work } = wiring;
  const settings = options.engines ?? DEFAULT_ENGINE_SETTINGS;
  const engines = createEngines(settings, SERVER_NAME);
  const deps: EngineDeps = { spawn: options.spawn ?? spawnProcess, env: process.env, signal: stop };
  const statuses = remembered(
    () => options.checkEngines?.() ?? checkEngines(engines, settings, deps),
    STATUS_FRESH_MS,
  );
  const shared: Shared = { settings, engines, deps, folders: privateFolders(), statuses };
  const asking = asker(shared, wiring, stop);
  const watch = watcher(shared, options);
  return {
    analyse: (analysis, channel, only, focus) =>
      work.run(() => asking.analyse(analysis, channel, only, focus)),
    studyFrames: (videoId, only) => work.run(() => asking.studyFrames(videoId, only)),
    watchesFiles: async () => settings.order.includes('agy') && (await agyInstalled(shared)),
    watchVideo: (videoId, question, options) => work.run(() => watch(videoId, question, options)),
    engineStatus: () =>
      work.run(async () => ({ engines: await statuses(), order: settings.order })),
    cleanUp: shared.folders.remove,
  };
}
