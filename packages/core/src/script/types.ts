/**
 * A script for one kept concept, written in three stages: hooks and a beat
 * sheet, the draft, and a tightened draft. It belongs to its concept, and
 * through it to one centre channel; like the concept it is never read for
 * another channel.
 */

export const SCRIPT_STATUSES = ['idea', 'drafting', 'ready'] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

/** The most library hooks the owner can choose as models for a script's opening. */
export const MAX_HOOK_MODELS = 3;
/** How many hooks the first stage writes. */
export const SCRIPT_HOOKS = 3;
/** How long a full-length video's hook runs, in seconds: the owner asked for one-minute hooks. */
export const LONG_HOOK_SECONDS = 60;
/** How long a Short's hook runs: a clip under a minute cannot spend a minute opening. */
export const SHORTS_HOOK_SECONDS = 10;
/** The length a Short is written to, and the most it may be: under a minute. */
export const SHORTS_TARGET_SECONDS = 50;
export const SHORTS_LIMIT_SECONDS = 59;

/** One of the hooks the first stage wrote. */
export interface ScriptHook {
  /** The way it opens, in a few words. */
  readonly way: string;
  /** The library hook it learns from, by video id; null when it names none. */
  readonly model: string | null;
  readonly text: string;
}

/** What a script holds besides whose it is. */
export interface ScriptFields {
  readonly status: ScriptStatus;
  /** The channel whose voice the script is written in; null until one is chosen. */
  readonly voiceChannelId: string | null;
  /** The speaking rate the script is written and timed at; null until it is known. */
  readonly wordsPerMinute: number | null;
  /** How long the video is to be, in seconds. */
  readonly targetSeconds: number | null;
  /** The reading grade the tighten pass aims at: the voice channel's own; null when unknown. */
  readonly targetGrade: number | null;
  /** The library hooks chosen as models for the opening, by video id. */
  readonly hookModels: readonly string[];
  /** The hooks the first stage wrote. */
  readonly hooks: readonly ScriptHook[];
  /** The hook the owner picked, as they left it. */
  readonly chosenHook: string;
  /** The beat sheet, one beat to a line, as the owner left it. */
  readonly beats: string;
  readonly draft: string;
  readonly tightened: string;
}

export interface StoredScript extends ScriptFields {
  readonly conceptId: number;
  readonly centerChannelId: string;
  readonly updatedAt: Date;
}

/** A script nobody has worked on yet. */
export const EMPTY_SCRIPT: ScriptFields = {
  status: 'idea',
  voiceChannelId: null,
  wordsPerMinute: null,
  targetSeconds: null,
  targetGrade: null,
  hookModels: [],
  hooks: [],
  chosenHook: '',
  beats: '',
  draft: '',
  tightened: '',
};

/** One script per concept, read and changed through the concept's centre channel. */
export interface ScriptRepo {
  /** Null when there is no script, or the concept belongs to another channel. */
  find(centerChannelId: string, conceptId: number): StoredScript | null;
  /**
   * Stores the changes, creating the script when there is none; starting a
   * script keeps its concept. False when the concept is not this channel's.
   */
  save(
    centerChannelId: string,
    conceptId: number,
    changes: Partial<ScriptFields>,
    updatedAt: Date,
  ): boolean;
  /** Which of the channel's concepts have a script, and where each stands. */
  list(
    centerChannelId: string,
  ): readonly Pick<StoredScript, 'conceptId' | 'status' | 'updatedAt'>[];
}
