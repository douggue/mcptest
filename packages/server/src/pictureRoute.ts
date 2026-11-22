/**
 * Which engines a picture question goes to, in order, and how an answer says
 * that another engine wrote it in place of the one the owner chose.
 *
 * No dead ends: an engine the owner chose that cannot do a picture question
 * (it failed the picture check, the settings leave it out, or its run fails)
 * hands the question on to the next engine that sees pictures, and the answer
 * says so. Only when no engine at all can is nothing written.
 */
import type { EngineAnswer } from './engines/fallback';
import type { SkippedEngine } from './engines/failure';
import type { EngineId } from './engines/types';

export interface PictureRouteInput {
  /** The owner's order of engines, from the settings. */
  readonly order: readonly EngineId[];
  /** The engines that see pictures now. */
  readonly seeing: readonly EngineId[];
  /** The engine the owner chose, if any. */
  readonly only?: EngineId | undefined;
  /** An engine not to use this time (a rerun on another engine). */
  readonly avoid?: EngineId | undefined;
  readonly label: (engine: EngineId) => string;
}

export interface PictureRoute {
  /** The engines to try, in order. */
  readonly engines: readonly EngineId[];
  /** The chosen engine, when it cannot be tried, with the reason. */
  readonly ruledOut: readonly SkippedEngine[];
}

/** Why the chosen engine cannot be tried; null when it can. */
function whyNot({ order, seeing, only, label }: PictureRouteInput): SkippedEngine | null {
  if (only === undefined) return null;
  if (!order.includes(only)) {
    return {
      engine: only,
      reason: 'not-installed',
      message: `${label(only)} is left out by the JGTUBE_ENGINES setting.`,
    };
  }
  if (!seeing.includes(only)) {
    return {
      engine: only,
      reason: 'failed',
      message: `${label(only)} failed the picture check in Settings.`,
    };
  }
  return null;
}

/** The engines for a picture question: the chosen one first when it can, then every other that sees pictures. */
export function pictureRoute(input: PictureRouteInput): PictureRoute {
  const { order, seeing, only, avoid } = input;
  const usable = order.filter((engine) => seeing.includes(engine) && engine !== avoid);
  const ruled = whyNot(input);
  const first = only !== undefined && ruled === null && only !== avoid ? [only] : [];
  return {
    engines: [...first, ...usable.filter((engine) => engine !== only)],
    ruledOut: ruled === null ? [] : [ruled],
  };
}

/** The answer, saying which engine it was written in place of and why, when that is so. */
export function withStandIn(
  answer: EngineAnswer<EngineId>,
  only: EngineId | undefined,
): EngineAnswer<EngineId> {
  if (only === undefined || answer.engine === only) return answer;
  const passed = answer.skipped.find((entry) => entry.engine === only);
  return {
    ...answer,
    standInFor: { engine: only, because: passed?.message ?? 'it could not answer.' },
  };
}
