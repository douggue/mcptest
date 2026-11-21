import type { DroppedFormula, VerifiedFormula } from '@jgtube/core';
import type { ClaimsOutcome, ResearchOutcome, ResearchView } from './research';
import { AUTOMATIC, type EngineChoice } from './analyses';
import { apiCaller, type Fetch } from './api';
import type { HookBuildOutcome, HookLabelOutcome, HookLibrary } from './hookLibrary';
import type { ScriptFields } from '@jgtube/core';
import type {
  Answered,
  AnswerOutcome,
  ConceptOutcome,
  ConceptThumbnailOutcome,
  ConceptThumbnailView,
  ConceptView,
} from './ideaLab';
import type {
  ScriptOutcome,
  ScriptStage,
  ScriptView,
  VoiceOutcome,
  VoiceView,
} from './scriptWriter';

/** A length as the owner typed it: minutes (as seconds) or words. */
export type LengthInput =
  | { readonly typed: 'minutes'; readonly seconds: number }
  | { readonly typed: 'words'; readonly words: number };

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
  | ConceptOutcome
  | AnswerOutcome
  | FormulaOutcome
  | HookBuildOutcome
  | HookLabelOutcome
  | ScriptOutcome
  | VoiceOutcome
  | ConceptThumbnailOutcome
  | ResearchOutcome
  | ClaimsOutcome;

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

    /** The thumbnail prompts of a channel's concepts; null when it has no map. */
    async conceptThumbnails(channel: string): Promise<readonly ConceptThumbnailView[] | null> {
      const list = await read<{ thumbnails: readonly ConceptThumbnailView[] }>(
        `/api/lab/concepts/thumbnails?${of(channel)}`,
      );
      return list?.thumbnails ?? null;
    },

    /** Starts the run that writes one concept's thumbnail prompt. */
    startThumbnail: (channel: string, concept: number, choice: EngineChoice) =>
      started('/api/lab/concepts/thumbnail', { channel, concept, ...withEngine(choice) }),

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

    /** Starts a concept's script when there is none, and returns it. */
    async openScript(channel: string, concept: number): Promise<ScriptView> {
      return unwrap<ScriptView>(await send('/api/lab/scripts/open', { channel, concept }));
    },

    /** Stores the owner's changes to a script and returns it as it now stands. */
    async saveScript(
      channel: string,
      concept: number,
      changes: Partial<ScriptFields>,
    ): Promise<ScriptView> {
      return unwrap<ScriptView>(await send('/api/lab/scripts', { channel, concept, changes }));
    },

    /** A concept's fact sheet and claims check. */
    async research(channel: string, concept: number): Promise<ResearchView> {
      return unwrap<ResearchView>(
        await call(`/api/lab/research?${of(channel)}&concept=${concept}`),
      );
    },

    /** Starts a web research run for a concept's subject. */
    startResearch: (channel: string, concept: number, choice: EngineChoice) =>
      started('/api/lab/research', { channel, concept, ...withEngine(choice) }),

    /** Starts a claims check of the next marked claims of a concept's script. */
    startClaims: (channel: string, concept: number, choice: EngineChoice) =>
      started('/api/lab/claims', { channel, concept, ...withEngine(choice) }),

    /** Stores a length typed in minutes or words and returns the script as it now stands. */
    async setLength(channel: string, concept: number, length: LengthInput): Promise<ScriptView> {
      return unwrap<ScriptView>(
        await send('/api/lab/scripts/length', { channel, concept, length }),
      );
    },

    /** Starts one stage of a script: hooks and beats, the draft, or the tighten pass. */
    startStage: (channel: string, concept: number, stage: ScriptStage, choice: EngineChoice) =>
      started('/api/lab/scripts/stage', { channel, concept, stage, ...withEngine(choice) }),

    /** A channel of this map as a voice, measured from its stored captions; null when it is not on the map. */
    voice: (channel: string, voice: string) =>
      read<VoiceView>(`/api/lab/voice?${of(channel)}&voice=${encodeURIComponent(voice)}`),

    /** Reads from YouTube the captions of the voice channel's best videos. Not an AI run. */
    startVoiceRead: (channel: string, voice: string) =>
      started('/api/lab/voice/read', { channel, voice }),

    async job(id: string): Promise<LabJob> {
      return unwrap<LabJob>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type LabApi = ReturnType<typeof createLabApi>;
