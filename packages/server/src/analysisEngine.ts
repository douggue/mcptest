/**
 * The part of the engine that asks an AI: the fixed analyses, watching a
 * video, and what is known about the AI engines on this computer.
 */
import type { Config } from '@jgtube/core';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asker } from './analysisAsker';
import { SERVER_NAME, VIDEO_SYSTEM_PROMPT } from './analyses';
import { runPictureCheck } from './pictureCheckEngine';
import { pictureChecks, pictureChecksPath, type PictureChecks } from './pictureChecks';
import type { PictureFileSet, PictureNeed } from './pictureFiles';
import type { Engine } from './app';
import { checkEngines, createEngines, type Engines } from './engines/catalog';
import type { EngineAnswer } from './engines/fallback';
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
import { runClaudeWeb, type WebRunRequest } from './engines/webRun';
import { inPrivateFolder } from './webRunner';
import type { WorkTracker } from './running';
import type { TeardownAsk } from './teardownRequests';

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
  /** Replaces a web research run; used by tests. */
  readonly runWeb?: (request: WebRunRequest) => Promise<EngineRunResult>;
  /** Replaces asking the engines about themselves; used by tests. */
  readonly checkEngines?: () => Promise<readonly EngineStatus[]>;
  /** Replaces starting programs; used by tests. */
  readonly spawn?: SpawnProcess;
  /** Replaces the request to Google; used by tests. */
  readonly geminiFetch?: GeminiFetch;
  /**
   * The pictures a question needs as files, for an engine shown pictures that
   * way: thumbnails, a teardown's strips and keyframes, or a video's frame
   * sheets. Without it, such an engine is passed over for picture questions.
   */
  readonly pictureFiles?: (channel: string, need: PictureNeed) => Promise<PictureFileSet>;
  /** Where the picture checks are kept; defaults to a file beside the store, none for one in memory. */
  readonly pictureChecksPath?: string | null;
  /** Replaces Math.random for the picture check's colours; used by tests. */
  readonly random?: () => number;
}

export interface AnalysisWiring {
  readonly config: Config;
  readonly options: AnalysisOptions;
  /** The work under way, so shutting down can wait for it. */
  readonly work: WorkTracker;
}

export interface AnalysisParts extends Pick<
  Engine,
  'analyse' | 'engineStatus' | 'watchVideo' | 'checkPictures'
> {
  /**
   * Has the first engine that sees pictures go through one video's frames,
   * start to end. Rejects with an EngineRunError like `analyse`.
   */
  studyFrames(videoId: string, only?: EngineId): Promise<EngineAnswer<EngineId>>;
  /**
   * One stage of a production teardown: a picture stage goes to the engines
   * that see pictures (Claude Code and Codex, and one that passed the picture
   * check, shown the pictures as files); a text stage to any engine in order.
   */
  askTeardown(ask: TeardownAsk, only?: EngineId): Promise<EngineAnswer<EngineId>>;
  /** Whether an engine here would watch a video from a file: Antigravity, installed and not left out. */
  watchesFiles(): Promise<boolean>;
  /**
   * One web research run of Claude Code (the web and nothing else), in a fresh
   * private folder. Rejects when Claude Code is left out in the settings file.
   */
  runWeb(request: WebRunRequest): Promise<EngineRunResult>;
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

/** Reuses what `load` found for `freshMs` before asking again; `fresh` asks again now. */
function remembered<T>(load: () => Promise<T>, freshMs: number): (fresh?: boolean) => Promise<T> {
  let kept: { readonly at: number; readonly value: Promise<T> } | null = null;
  return (fresh = false) => {
    if (fresh || kept === null || Date.now() - kept.at > freshMs) {
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

/** What the analyses and video watching are both built from. */
interface Shared {
  readonly settings: EngineSettings;
  readonly engines: Engines;
  readonly deps: EngineDeps;
  readonly folders: ReturnType<typeof privateFolders>;
  /** What is known about the engines, found out at most once a minute. */
  readonly statuses: (fresh?: boolean) => Promise<readonly EngineStatus[]>;
  /** The last picture check of each engine. */
  readonly checks: PictureChecks;
}

/** Where the picture checks are kept: beside the store on disk, nowhere for one in memory. */
function checksPathOf({ config, options }: AnalysisWiring): string | null {
  if (options.pictureChecksPath !== undefined) return options.pictureChecksPath;
  const store =
    options.storePath ?? (config.dbPath === IN_MEMORY ? IN_MEMORY : resolve(config.dbPath));
  return pictureChecksPath(store);
}

/** The analyses, the frame study, the teardown stages and the picture check. */
function askers(shared: Shared, wiring: AnalysisWiring, stop: AbortSignal) {
  const asking = asker(shared, { ...wiring, projectRoot: PROJECT_ROOT }, stop);
  const run =
    wiring.options.runEngine ??
    ((id: EngineId, request: EngineRunRequest) => shared.engines[id].run(request, shared.deps));
  return {
    ...asking,
    checkPictures: (engine: EngineId) =>
      runPictureCheck(engine, {
        run: (id, request) => run(id, request, stop),
        workDir: (id) => shared.folders.for(id),
        checks: shared.checks,
        order: () => shared.settings.order,
        now: () => new Date(),
        random: wiring.options.random,
      }),
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
        fileOnly: watch.fileOnly,
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
  const checks = pictureChecks(checksPathOf(wiring));
  const shared: Shared = { settings, engines, deps, folders: privateFolders(), statuses, checks };
  const asking = askers(shared, wiring, stop);
  const watch = watcher(shared, options);
  return {
    analyse: (analysis, channel, only, focus, avoid) =>
      work.run(() => asking.analyse(analysis, channel, only, focus, avoid)),
    studyFrames: (videoId, only) => work.run(() => asking.studyFrames(videoId, only)),
    askTeardown: (teardown, only) => work.run(() => asking.askTeardown(teardown, only)),
    checkPictures: (engine) => work.run(() => asking.checkPictures(engine)),
    watchesFiles: async () => settings.order.includes('agy') && (await agyInstalled(shared)),
    watchVideo: (videoId, question, options) => work.run(() => watch(videoId, question, options)),
    engineStatus: (fresh) =>
      work.run(async () => ({
        engines: await statuses(fresh),
        order: settings.order,
        pictureChecks: checks.all(),
      })),
    runWeb: (request) =>
      work.run(() => {
        if (!settings.order.includes('claude')) {
          throw new Error(
            'Research on the web needs Claude Code, which is switched off in the settings file (JGTUBE_ENGINES).',
          );
        }
        const run = options.runWeb ?? inPrivateFolder((asked) => runClaudeWeb(asked, deps));
        return run(request);
      }),
    cleanUp: shared.folders.remove,
  };
}
