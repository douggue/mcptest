/**
 * Title formulas for one channel's map. An engine proposes them; what is
 * stored and shown is decided in code: only videos that are stored videos of
 * this map inside the window count, a formula needs enough of them and a real
 * wording, and every number beside a formula comes from the store.
 */
import {
  NO_MAP,
  parseFormulas,
  verifyFormulas,
  videosOnMap,
  type FormulaVideo,
  type StoredFormula,
} from '@jgtube/core';
import type { LabDeps } from './labDeps';
import type { FormulaList, FormulaView, LabEngine } from './labTypes';

type FormulaParts = Pick<LabEngine, 'listFormulas' | 'findFormulas'>;

/** No limit of days: a stored formula keeps its videos after they pass out of the window. */
const ANY_AGE = Number.POSITIVE_INFINITY;

/** A stored formula with its numbers as the store has them now; null when too little is left of it. */
function viewOf(
  stored: StoredFormula,
  onMap: ReadonlyMap<string, FormulaVideo>,
): FormulaView | null {
  const [verified] = verifyFormulas([stored], onMap).kept;
  return verified ? { ...verified, id: stored.id } : null;
}

function listOf(deps: LabDeps, centerChannelId: string, windowDays: number): FormulaList | null {
  const onMap = videosOnMap(deps.repos, centerChannelId, deps.now(), ANY_AGE);
  if (onMap === null) return null;
  const stored = deps.repos.formulas.list(centerChannelId, windowDays);
  const [first] = stored;
  return {
    windowDays,
    runAt: first?.runAt.toISOString() ?? null,
    engine: first?.engine ?? null,
    formulas: stored.flatMap((one) => viewOf(one, onMap) ?? []),
  };
}

/** The formulas side of the idea lab, on this engine's store and engines. */
export function formulaEngine(deps: LabDeps): FormulaParts {
  return {
    listFormulas: (centerChannelId, windowDays) => listOf(deps, centerChannelId, windowDays),

    async findFormulas(centerChannelId, windowDays, only, onProgress) {
      const inWindow = videosOnMap(deps.repos, centerChannelId, deps.now(), windowDays);
      if (inWindow === null) throw new Error(NO_MAP);
      onProgress({
        step: 'asking',
        text: `Asking the AI to group the titles doing well on this map in the last ${windowDays} days`,
      });
      const answer = await deps.analyse('title-formulas', centerChannelId, only, {
        kind: 'window',
        windowDays,
      });
      onProgress({ step: 'reading', text: 'Checking each formula against the stored videos' });
      const { formulas, unread } = parseFormulas(answer.text);
      const { kept, dropped } = verifyFormulas(formulas, inWindow);
      if (kept.length === 0) {
        throw new Error(
          formulas.length === 0
            ? 'The AI answered, but not with formulas in the form asked for. Nothing was changed. Try again.'
            : `The AI proposed ${formulas.length} formulas and none passed the checks: each needs at least two stored videos of this map inside the window and real fixed words. Nothing was changed.`,
        );
      }
      deps.repos.formulas.replace(
        { centerChannelId, windowDays, engine: answer.engine },
        kept.map((one) => ({
          formula: one.formula,
          why: one.why,
          videoIds: one.videos.map((video) => video.videoId),
        })),
        deps.now(),
      );
      const list = listOf(deps, centerChannelId, windowDays);
      if (list === null) throw new Error(NO_MAP);
      return {
        kind: 'formulas',
        list,
        proposed: formulas.length,
        unread,
        dropped,
        engine: answer.engine,
        skipped: answer.skipped,
      };
    },
  };
}
