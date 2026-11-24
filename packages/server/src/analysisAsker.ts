/**
 * Puts the fixed analyses, the frame study and the teardown's stages to the
 * engines, in order, until one answers.
 *
 * A picture question goes to every engine that sees pictures: Claude Code and
 * Codex through the picture tools, Antigravity with the pictures written into
 * its run folder and named with `@` (see `pictureFiles.ts`), unless its last
 * picture check failed. The engine the owner chose goes first; when it cannot,
 * the next one writes it and the answer says so (`pictureRoute.ts`). An
 * answer from pictures handed over as files is checked for the file names.
 */
import { downloadsRoot, type Config } from '@jgtube/core';
import { resolve } from 'node:path';
import {
  ANALYSES,
  FRAME_STUDY_TITLE,
  analysisRequest,
  frameStudyRequest,
  pictureEngines,
  seesFiles,
  type AnalysisId,
  type AnalysisSettings,
} from './analyses';
import type { AnalysisOptions } from './analysisEngine';
import type { Engines } from './engines/catalog';
import { EngineRunError, type SkippedEngine } from './engines/failure';
import { firstAnswer, type EngineAnswer } from './engines/fallback';
import type { EngineDeps, EngineId, EngineRunRequest } from './engines/types';
import { cleanMessage } from './jobs';
import {
  filesFromPaths,
  picturesSeen,
  type PictureFileSet,
  type PictureNeed,
} from './pictureFiles';
import { pictureRoute, withStandIn, type PictureRoute } from './pictureRoute';
import type { PictureChecks } from './pictureChecks';
import type { EngineSettings } from './engines/settings';
import type { QuestionFocus } from './questionFocus';
import {
  runTitle,
  looksAtPictures as mixLooks,
  mixRequest,
  type MixAsk,
} from './formatMixRequests';
import { STAGE_TITLES } from './teardownQuestions';
import { looksAtPictures, teardownRequest, type TeardownAsk } from './teardownRequests';

const IN_MEMORY = ':memory:';

/** The folders the engines are started in, one each. */
export interface EngineFolders {
  for(name: string): string;
}

export interface AskerShared {
  readonly settings: EngineSettings;
  readonly engines: Engines;
  readonly deps: EngineDeps;
  readonly folders: EngineFolders;
  /** The last picture check of each engine. */
  readonly checks: PictureChecks;
}

export interface AskerWiring {
  readonly config: Config;
  readonly options: AnalysisOptions;
  /** The Jgtube folder, where the connector the engines are given lives. */
  readonly projectRoot: string;
}

type Answer = Promise<EngineAnswer<EngineId>>;

export interface Asker {
  analyse(
    analysis: AnalysisId,
    channel: string,
    only?: EngineId,
    focus?: QuestionFocus,
    /** An engine not to use this time: a rerun on another engine. */
    avoid?: EngineId,
  ): Answer;
  studyFrames(videoId: string, only?: EngineId): Answer;
  askTeardown(ask: TeardownAsk, only?: EngineId): Answer;
  askFormatMix(ask: MixAsk, only?: EngineId): Answer;
}

/** The store as a file an engine's connector can open. Throws when it is only in memory. */
function storeFile({ config, options }: AskerWiring): string {
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

/** What to say when no engine could answer a question any engine may answer. */
function nobodyFor(order: readonly EngineId[], engines: Engines, only?: EngineId): string {
  if (only === undefined) {
    return order.length > 0
      ? 'None of the AI engines on this computer could answer.'
      : 'The JGTUBE_ENGINES setting leaves out every AI engine.';
  }
  const chosen = engines[only].label;
  return order.length > 0
    ? `${chosen} could not answer. Choose another AI, or Automatic, and try again.`
    : `${chosen} is left out by the JGTUBE_ENGINES setting.`;
}

/** What to say when no engine that sees pictures could answer: only then is nothing written. */
function nobodyForPictures(title: string, route: PictureRoute, chosen: string | null): string {
  if (route.engines.length > 0) {
    return chosen === null
      ? 'None of the AI engines on this computer could answer.'
      : `${chosen} could not answer, and no other AI that sees pictures could either.`;
  }
  const why = route.ruledOut.map((entry) => entry.message).join(' ');
  return `${title} needs an AI that sees pictures (Claude Code, Codex or Antigravity), and none is available here.${why ? ` ${why}` : ''}`;
}

/** Two sets of picture files as one. */
export function joinFiles(first: PictureFileSet, second: PictureFileSet | null): PictureFileSet {
  if (second === null || second.files.length === 0) return first;
  if (first.files.length === 0) return second;
  return {
    files: [...first.files, ...second.files],
    listing: `${first.listing}; ${second.listing}`,
  };
}

/** How one engine is asked a picture question, and the pictures it was handed as files, if any. */
interface PictureAsk {
  readonly request: EngineRunRequest;
  readonly files?: PictureFileSet;
}

/** The fixed analyses, the frame study and the teardown stages, each put to the engines in order. */
export function asker(shared: AskerShared, wiring: AskerWiring, stop: AbortSignal): Asker {
  const { settings, engines, deps, folders, checks } = shared;
  const run =
    wiring.options.runEngine ??
    ((id: EngineId, request: EngineRunRequest) => engines[id].run(request, deps));
  const label = (engine: EngineId): string => engines[engine].label;
  // The owner's choice of one engine means that engine and no backup, for a question any engine may answer.
  const allowedBy = (only?: EngineId): readonly EngineId[] =>
    only === undefined ? settings.order : settings.order.filter((id) => id === only);
  /** Where an engine's connector finds the store; throws when the store is only in memory. */
  const settingsFor = (): ((engine: EngineId) => AnalysisSettings) => {
    const dbPath = storeFile(wiring);
    const downloadsPath = downloadsPathOf(wiring.config);
    return (engine) => ({
      projectRoot: wiring.projectRoot,
      dbPath,
      workDir: folders.for(engine),
      downloadsPath,
    });
  };
  const ask = (
    order: readonly EngineId[],
    requestFor: (engine: EngineId) => EngineRunRequest | Promise<EngineRunRequest>,
    nobody: string,
    ruledOut: readonly SkippedEngine[] = [],
  ): Answer =>
    firstAnswer(
      [
        ...ruledOut,
        ...order.map((id) => ({
          engine: id,
          run: async () => run(id, await requestFor(id), stop),
        })),
      ],
      nobody,
      () => stop.aborted,
    );
  /** The pictures as files, made only when such an engine's turn comes. */
  const filesFor = async (channel: string, need: PictureNeed): Promise<PictureFileSet> => {
    const make = wiring.options.pictureFiles;
    if (!make) throw new EngineRunError('failed', 'Jgtube cannot hand this engine pictures here.');
    try {
      return await make(channel, need);
    } catch (error) {
      throw new EngineRunError(
        'failed',
        `The pictures could not be made into files: ${cleanMessage(error)}`,
      );
    }
  };
  /** A picture question: the chosen engine first, then every other that sees pictures. */
  const askPictures = async (
    title: string,
    choice: { readonly only?: EngineId | undefined; readonly avoid?: EngineId | undefined },
    requestFor: (engine: EngineId) => Promise<PictureAsk>,
    checkSeen: boolean,
  ): Answer => {
    const { only, avoid } = choice;
    const seeing = pictureEngines(checks.failed());
    const route = pictureRoute({ order: settings.order, seeing, only, avoid, label });
    const handed = new Map<EngineId, PictureFileSet>();
    const answer = await ask(
      route.engines,
      async (engine) => {
        const { request, files } = await requestFor(engine);
        if (files) handed.set(engine, files);
        return request;
      },
      nobodyForPictures(title, route, only === undefined ? null : label(only)),
      route.ruledOut,
    );
    const files = handed.get(answer.engine);
    const seen = checkSeen && files ? { seen: picturesSeen(answer.text, files) } : {};
    return withStandIn({ ...answer, ...seen }, only);
  };
  return {
    async analyse(analysis, channel, only, focus, avoid) {
      const at = settingsFor();
      const spec = ANALYSES[analysis];
      if (spec.pictures !== true) {
        const order = allowedBy(only).filter((engine) => engine !== avoid);
        return ask(
          order,
          (engine) => analysisRequest(analysis, channel, at(engine), focus),
          nobodyFor(order, engines, only),
        );
      }
      const route = spec.filesRoute;
      return askPictures(
        spec.title,
        { only, avoid },
        async (engine) => {
          if (!seesFiles(engine) || route === undefined) {
            return { request: analysisRequest(analysis, channel, at(engine), focus) };
          }
          const files = await filesFor(channel, route.pictures?.(focus) ?? { kind: 'board' });
          return {
            request: analysisRequest(analysis, channel, at(engine), focus, files),
            files,
          };
        },
        route?.json !== true,
      );
    },
    async askTeardown(teardown, only) {
      const at = settingsFor();
      if (!looksAtPictures(teardown)) {
        const order = allowedBy(only);
        return ask(
          order,
          (engine) => teardownRequest(teardown, engine, at(engine)),
          nobodyFor(order, engines, only),
        );
      }
      // A stage answers with JSON, which a line naming the files opened would spoil.
      return askPictures(
        `The teardown's ${STAGE_TITLES[teardown.stage]}`,
        { only },
        async (engine) => ({ request: await teardownRequest(teardown, engine, at(engine)) }),
        false,
      );
    },
    async askFormatMix(mix, only) {
      const at = settingsFor();
      if (!mixLooks(mix)) {
        const order = allowedBy(only);
        return ask(
          order,
          (engine) => mixRequest(mix, engine, at(engine)),
          nobodyFor(order, engines, only),
        );
      }
      // The answer is JSON, which a line naming the files opened would spoil.
      return askPictures(
        runTitle(mix),
        { only },
        async (engine) => {
          if (!seesFiles(engine)) return { request: mixRequest(mix, engine, at(engine)) };
          const files = joinFiles(
            await filesFromPaths([{ label: 'pictures on the shelf', pictures: mix.pictures }]),
            mix.thumbnails.length === 0
              ? null
              : await filesFor('', {
                  kind: 'thumbnails',
                  groups: [{ label: 'thumbnails on the shelf', videoIds: mix.thumbnails }],
                }),
          );
          return { request: mixRequest(mix, engine, at(engine), files) };
        },
        false,
      );
    },
    async studyFrames(videoId, only) {
      const at = settingsFor();
      return askPictures(
        FRAME_STUDY_TITLE,
        { only },
        async (engine) => {
          if (!seesFiles(engine)) return { request: frameStudyRequest(videoId, at(engine)) };
          const files = await filesFor('', { kind: 'frames', videoId });
          return { request: frameStudyRequest(videoId, at(engine), files), files };
        },
        true,
      );
    },
  };
}
