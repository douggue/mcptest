/**
 * The script writer as the API and the connector see it. A script belongs to
 * one concept, and through it to one centre channel; a voice is a channel on
 * that channel's own map, measured from its own captions.
 */
import type { LengthRange, ScriptFields, StoredScript, VoiceProfile } from '@jgtube/core';
import type { SkippedEngine } from './engines/failure';
import type { EngineId } from './engines/types';
import type { ConceptForTool, ConceptView, Report } from './labTypes';

export const SCRIPT_STAGES = ['hooks', 'draft', 'tighten'] as const;
export type ScriptStage = (typeof SCRIPT_STAGES)[number];

/** A channel's voice as numbers, and what they were measured from. */
export interface VoiceView {
  readonly channelId: string;
  readonly title: string;
  readonly profile: VoiceProfile;
  /** The best videos of the channel whose captions were never read; reading them improves the numbers. */
  readonly toRead: number;
  /** Of its best videos, those YouTube lists no captions for. */
  readonly noCaptions: number;
  /** Its best videos that a channel breakdown stored a frame study for, by id. */
  readonly frameStudies: readonly string[];
}

/** What a script is written to, worked out from its voice and its length. */
export interface ScriptPlan {
  readonly hookSeconds: number;
  /** Words in the hook at the voice's rate; null until a rate is known. */
  readonly hookWords: number | null;
  /** Words in the whole script at the voice's rate; null until a rate and a length are known. */
  readonly targetWords: number | null;
}

export interface ScriptView {
  readonly concept: ConceptView;
  /** Null until the script has been started. */
  readonly script: StoredScript | null;
  readonly plan: ScriptPlan;
  /** How long the look-alikes' winners on this map run; null when too few to say. */
  readonly lengthRange: LengthRange | null;
  /** The voice the script is written in, as it measures now; null until one is chosen. */
  readonly voice: VoiceView | null;
  /** Whether the owner has facts marked for checking (Settings); the page hides the marker count and list when not. */
  readonly markFacts: boolean;
}

export interface ScriptOutcome {
  readonly kind: 'script';
  readonly stage: ScriptStage;
  readonly view: ScriptView;
  readonly engine: EngineId;
  readonly skipped: readonly SkippedEngine[];
}

export interface VoiceOutcome {
  readonly kind: 'voice';
  readonly voice: VoiceView;
  /** Captions read from YouTube in this run. */
  readonly read: number;
  readonly failed: readonly { readonly videoId: string; readonly reason: string }[];
}

/** A script with its concept, as a tool hands it to an engine. */
export interface ScriptForTool extends ConceptForTool {
  readonly script: StoredScript | null;
  readonly plan: ScriptPlan;
  readonly voice: VoiceView | null;
}

/** The script writer's part of the engine. `channel` is a handle, a link or an id; a centre is an id. */
export interface ScriptEngine {
  /** A concept's script as the page shows it; null when the concept is not this channel's. */
  findScriptView(centerChannelId: string, conceptId: number): ScriptView | null;
  /**
   * Starts the script when there is none, with a voice, a rate, a length and
   * a model hook taken from what is stored, and returns it. Null when the
   * concept is not this channel's.
   */
  openScript(centerChannelId: string, conceptId: number): ScriptView | null;
  /** Why the changes cannot be stored, in plain words, or null when they can. */
  scriptChangeProblem(
    centerChannelId: string,
    conceptId: number,
    changes: Partial<ScriptFields>,
  ): string | null;
  /** Stores the owner's changes. Null when the concept is not this channel's. */
  saveScript(
    centerChannelId: string,
    conceptId: number,
    changes: Partial<ScriptFields>,
  ): ScriptView | null;
  /** Why a stage cannot be run yet, in plain words, or null when it can. */
  stageProblem(stage: ScriptStage, centerChannelId: string, conceptId: number): string | null;
  /** Has an engine write one stage and stores what it wrote. */
  runScriptStage(
    stage: ScriptStage,
    centerChannelId: string,
    conceptId: number,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<ScriptOutcome>;
  /** A channel on this map as a voice; null when it is not on the map. Reads the store only. */
  voiceOf(centerChannelId: string, voiceChannelId: string): VoiceView | null;
  /** Reads from YouTube the captions of the voice channel's best videos that the store lacks. */
  readVoice(
    centerChannelId: string,
    voiceChannelId: string,
    onProgress: Report,
  ): Promise<VoiceOutcome>;
  /** A script with its concept; null when it is not this channel's. Reads the store only. */
  findScript(channel: string, conceptId: number): ScriptForTool | null;
}
