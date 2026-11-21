import type { DroppedFormula, VerifiedFormula } from '@jgtube/core';
import { AUTOMATIC, type EngineChoice } from './analyses';
import { apiCaller, type Fetch } from './api';
import type { HookBuildOutcome, HookLabelOutcome, HookLibrary } from './hookLibrary';
import type { Answered, AnswerOutcome, ConceptOutcome, ConceptView } from './ideaLab';

/** The idea lab's part of the local server's API: concepts, title formulas and the hook library. */

export interface FormulaView extends VerifiedFormula {
  readonly id: number;
}

export interface FormulaList {
  readonly windowDays: number;
  /** When the run that found them finished; null when none has. */
  readonly runAt: string | null;
  readonly engine: string | null;
  readonly formulas: readonly FormulaView[];
}

export interface FormulaOutcome extends Answered {
  readonly kind: 'formulas';
  readonly list: FormulaList;
  readonly proposed: number;
  readonly unread: number;
  readonly dropped: readonly DroppedFormula[];
}

export type LabOutcome =
  ConceptOutcome | AnswerOutcome | FormulaOutcome | HookBuildOutcome | HookLabelOutcome;

export interface LabJob {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: { readonly step: string; readonly text: string } | null;
  readonly result: LabOutcome | null;
  readonly error: string | null;
}

const withEngine = (choice: EngineChoice): Record<string, unknown> =>
  choice === AUTOMATIC ? {} : { engine: choice };

export function createLabApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  /** A read that answers 404 when the channel has no map. */
  const read = async <T>(path: string): Promise<T | null> => {
    const envelope = await call(path);
    return envelope.status === 404 ? null : unwrap<T>(envelope);
  };
  const started = async (path: string, body: unknown): Promise<string> =>
    unwrap<{ jobId: string }>(await send(path, body)).jobId;
  const of = (channel: string): string => `channel=${encodeURIComponent(channel)}`;

  return {
    /** A channel's concepts, the kept ones first; null when it has no map. */
    async concepts(channel: string): Promise<readonly ConceptView[] | null> {
      const list = await read<{ concepts: readonly ConceptView[] }>(
        `/api/lab/concepts?${of(channel)}`,
      );
      return list?.concepts ?? null;
    },

    /** Starts a batch of concepts; the body is built by `batchRequest`. */
    startBatch: (body: Record<string, unknown>) => started('/api/lab/concepts', body),

    /** Starts other angles on one concept's subject, or other subjects in its vein. */
    grow: (kind: 'twist' | 'more', channel: string, concept: number, choice: EngineChoice) =>
      started(`/api/lab/concepts/${kind}`, { channel, concept, ...withEngine(choice) }),

    async keep(channel: string, concept: number, kept: boolean): Promise<void> {
      unwrap<unknown>(await send('/api/lab/concepts/keep', { channel, concept, kept }));
    },

    /** Removes the concepts that were not kept; resolves with how many went. */
    async clear(channel: string): Promise<number> {
      return unwrap<{ removed: number }>(await send('/api/lab/concepts/clear', { channel }))
        .removed;
    },

    startWhereElse: (channel: string, choice: EngineChoice) =>
      started('/api/lab/where-else', { channel, ...withEngine(choice) }),

    formulas: (channel: string, windowDays: number) =>
      read<FormulaList>(`/api/lab/formulas?${of(channel)}&window=${windowDays}`),

    startFormulas: (channel: string, windowDays: number, choice: EngineChoice) =>
      started('/api/lab/formulas', { channel, window: windowDays, ...withEngine(choice) }),

    hooks: (channel: string) => read<HookLibrary>(`/api/lab/hooks?${of(channel)}`),

    /** Reads from YouTube the captions the library lacks. Not an AI run. */
    startHookBuild: (channel: string) => started('/api/lab/hooks/build', { channel }),

    startHookLabels: (channel: string, choice: EngineChoice) =>
      started('/api/lab/hooks/label', { channel, ...withEngine(choice) }),

    async job(id: string): Promise<LabJob> {
      return unwrap<LabJob>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type LabApi = ReturnType<typeof createLabApi>;
