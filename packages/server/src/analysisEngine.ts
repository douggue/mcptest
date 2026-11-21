/**
 * The part of the engine that asks an AI: the fixed analyses, watching a
 * video, and what is known about the AI engines on this computer.
 */
import type { Config } from '@jgtube/core';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANALYSES,
  SERVER_NAME,
  VIDEO_SYSTEM_PROMPT,
  analysisRequest,
  enginesFor,
  type AnalysisId,
} from './analyses';
import type { Engine } from './app';
import { checkEngines, createEngines, type Engines } from './engines/catalog';
import { firstAnswer } from './engines/fallback';
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
   * Fetches a video to a file on this computer for an engine to watch. Absent
   * until a downloader is connected: video is then watched through the Gemini
   * API only.
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

interface AnalysisParts extends Pick<Engine, 'analyse' | 'engineStatus' | 'watchVideo'> {
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

/** What to say when no engine could answer an analysis. */
function nobodyFor(analysis: AnalysisId, order: readonly EngineId[], engines: Engines): string {
  if (order.length > 0) return 'None of the AI engines on this computer could answer.';
  const { title, engines: needed = [] } = ANALYSES[analysis];
  const names = needed.map((id) => engines[id].label).join(' or ');
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

/** One fixed analysis, put to the engines in order until one answers. */
function analyser(shared: Shared, wiring: AnalysisWiring, stop: AbortSignal): Engine['analyse'] {
  const { settings, engines, deps, folders } = shared;
  const run =
    wiring.options.runEngine ??
    ((id: EngineId, request: EngineRunRequest) => engines[id].run(request, deps));
  return async (analysis, channel) => {
    const dbPath = storeFile(wiring);
    const order = enginesFor(analysis, settings.order);
    const requestFor = (engine: EngineId): EngineRunRequest =>
      analysisRequest(analysis, channel, {
        projectRoot: PROJECT_ROOT,
        dbPath,
        workDir: folders.for(engine),
      });
    return firstAnswer(
      order.map((id) => ({ engine: id, run: () => run(id, requestFor(id), stop) })),
      nobodyFor(analysis, order, engines),
      () => stop.aborted,
    );
  };
}

/** One video, watched by the first engine that can. */
function watcher(shared: Shared, options: AnalysisOptions): Engine['watchVideo'] {
  const { settings, deps, folders, statuses } = shared;
  return (videoId, question) =>
    watchVideo(
      { videoId, question, systemPrompt: VIDEO_SYSTEM_PROMPT },
      {
        settings,
        deps,
        workDir: folders.for(VIDEO_FOLDER),
        agyInstalled: async () =>
          (await statuses()).some((status) => status.id === 'agy' && status.installed),
        download: options.downloadVideo,
        geminiFetch: options.geminiFetch,
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
  const analyse = analyser(shared, wiring, stop);
  const watch = watcher(shared, options);
  return {
    analyse: (analysis, channel) => work.run(() => analyse(analysis, channel)),
    watchVideo: (videoId, question) => work.run(() => watch(videoId, question)),
    engineStatus: () =>
      work.run(async () => ({ engines: await statuses(), order: settings.order })),
    cleanUp: shared.folders.remove,
  };
}
