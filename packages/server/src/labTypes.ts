/**
 * The idea lab as the API and the connector see it: packaging concepts,
 * title formulas and the hook library of one channel's own map. Everything
 * is read and changed through that channel (its centre channel id); nothing
 * reaches a channel from another map.
 */
import type {
  ConceptLength,
  DroppedFormula,
  LibraryHook,
  PickedVideo,
  StoredBatch,
  StoredConcept,
  VerifiedFormula,
} from '@jgtube/core';
import type { SkippedEngine } from './engines/failure';
import type { EngineId } from './engines/types';
import type { ScriptOutcome, VoiceOutcome } from './scriptTypes';

/** What a lab job is doing now. */
export type LabStep = 'asking' | 'reading' | 'captions';

/** One step of a lab job, in plain words, for the page to show while it runs. */
export interface LabProgress {
  readonly step: LabStep;
  readonly text: string;
}

/** The title format a batch is asked to use: a transfer-list template or a stored formula. */
export type FormatChoice =
  | { readonly source: 'transfer'; readonly key: string }
  | { readonly source: 'formula'; readonly id: number };

/** What the owner chose for a batch of concepts. Every part is checked before anything runs. */
export interface ConceptRequest {
  readonly centerChannelId: string;
  /** One to five videos picked on this channel's map. */
  readonly inspiration: readonly string[];
  /** The picked videos whose way of opening is to be modelled; each is among `inspiration`. */
  readonly hookModels: readonly string[];
  readonly format: FormatChoice | null;
  /** The owner's own wording of their topic, one line; null when they gave none. */
  readonly angle: string | null;
  readonly length: ConceptLength;
  /** The one engine to ask; absent, the usual order with its backups. */
  readonly only?: EngineId | undefined;
}

/** A concept as the page shows it: its own parts and what its batch rested on. */
export interface ConceptView extends StoredConcept {
  readonly length: ConceptLength;
  readonly angle: string | null;
  /** The title format its batch was asked to use, as it read then; null when none was picked. */
  readonly formatTemplate: string | null;
  /** The picked videos its rests-on line names. Ids the owner did not pick are not listed. */
  readonly restsOnVideos: readonly PickedVideo[];
  /** How many videos were picked for its batch. */
  readonly pickedCount: number;
}

export interface ConceptList {
  /** The kept ones first, then the newest batch. */
  readonly concepts: readonly ConceptView[];
}

/** Who answered, and who was passed over on the way. */
interface Answered {
  readonly engine: EngineId;
  readonly skipped: readonly SkippedEngine[];
}

export interface ConceptOutcome extends Answered {
  readonly kind: 'concepts';
  readonly batchId: number;
  readonly added: readonly ConceptView[];
  /** How many were asked for. */
  readonly asked: number;
  /** How many more the answer set out that could not be read. */
  readonly unread: number;
  /** One plain sentence when fewer came back than were asked for; else null. */
  readonly note: string | null;
}

export interface AnswerOutcome extends Answered {
  readonly kind: 'answer';
  readonly text: string;
}

/** A formula with its id, and its numbers worked out from the store. */
export interface FormulaView extends VerifiedFormula {
  readonly id: number;
}

export interface FormulaList {
  readonly windowDays: number;
  /** When the run that found them finished, as an ISO-8601 string; null when none has. */
  readonly runAt: string | null;
  /** The engine that proposed them, by its id. */
  readonly engine: string | null;
  readonly formulas: readonly FormulaView[];
}

export interface FormulaOutcome extends Answered {
  readonly kind: 'formulas';
  readonly list: FormulaList;
  /** How many formulas the engine proposed that could be read. */
  readonly proposed: number;
  readonly unread: number;
  /** The proposals that are not shown, each with why. */
  readonly dropped: readonly DroppedFormula[];
}

export interface HookLibrary {
  readonly centerChannelId: string;
  /** How much of each opening is taken, in seconds. */
  readonly seconds: number;
  /** The most videos a library is built from. */
  readonly cap: number;
  /** Highest score first. */
  readonly hooks: readonly LibraryHook[];
}

export interface HookBuildOutcome {
  readonly kind: 'hooks-built';
  readonly library: HookLibrary;
  /** Captions read from YouTube in this run. */
  readonly read: number;
  /** Videos whose captions could not be read this time, each with why. */
  readonly failed: readonly { readonly videoId: string; readonly reason: string }[];
}

export interface HookLabelOutcome extends Answered {
  readonly kind: 'hooks-labelled';
  readonly library: HookLibrary;
  readonly labelled: number;
  readonly unread: number;
}

export type LabOutcome =
  | ConceptOutcome
  | AnswerOutcome
  | FormulaOutcome
  | HookBuildOutcome
  | HookLabelOutcome
  | ScriptOutcome
  | VoiceOutcome;

/** What a batch rested on, as a tool hands it to an engine. */
export interface IdeaBrief {
  readonly batch: StoredBatch;
  /** The picked videos that are still stored. */
  readonly picked: readonly PickedVideo[];
}

/** One stored concept with its batch, as a tool hands it to an engine. */
export interface ConceptForTool extends IdeaBrief {
  readonly concept: StoredConcept;
}

export type Report = (progress: LabProgress) => void;

/** The idea lab's part of the engine. `channel` is a handle, a link or an id; a centre is an id. */
export interface LabEngine {
  /** A channel's concepts; null when no map has been made for it. Reads the store only. */
  listConcepts(centerChannelId: string): ConceptList | null;
  /** False when the concept does not exist or belongs to another channel. */
  setConceptKept(centerChannelId: string, conceptId: number, kept: boolean): boolean;
  /** Removes the channel's concepts that were not kept; returns how many went. */
  clearConcepts(centerChannelId: string): number;
  /** Why a batch cannot be started, in plain words, or null when it can. Reads the store only. */
  conceptProblem(request: ConceptRequest): string | null;
  /** Asks an engine for a batch of concepts and stores the ones that could be read. */
  makeConcepts(request: ConceptRequest, onProgress: Report): Promise<ConceptOutcome>;
  /** Asks for other angles on one concept's subject, or for other subjects in its vein. */
  growConcept(
    kind: 'twist' | 'more',
    centerChannelId: string,
    conceptId: number,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<ConceptOutcome>;
  /** Asks where else what works on this map could be made. */
  whereElse(
    centerChannelId: string,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<AnswerOutcome>;
  /** The stored formulas of a channel and window; null when the channel has no map. */
  listFormulas(centerChannelId: string, windowDays: number): FormulaList | null;
  /** Asks an engine for title formulas and stores the ones that pass the checks. */
  findFormulas(
    centerChannelId: string,
    windowDays: number,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<FormulaOutcome>;
  /** The hook library of a channel's map; null when it has no map. Reads the store only. */
  hookLibrary(channel: string): HookLibrary | null;
  /** Reads from YouTube the captions the library lacks, one video at a time. */
  buildHookLibrary(centerChannelId: string, onProgress: Report): Promise<HookBuildOutcome>;
  /** Asks an engine to name the way each stored opening works. */
  labelHooks(
    centerChannelId: string,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<HookLabelOutcome>;
  /** What a batch rested on; null when it is not this channel's. Reads the store only. */
  findIdeaBrief(channel: string, batchId: number): IdeaBrief | null;
  /** One concept with its batch; null when it is not this channel's. Reads the store only. */
  findConcept(channel: string, conceptId: number): ConceptForTool | null;
}
