import type { TeardownReport, VideoSeen, VideoSource } from '@jgtube/core';
import type { CandidateFacts } from './breakdownCandidates';
import type { EngineId } from './engines/types';

/** The video to break down: a YouTube video by its id, or a file the owner gave by the id it was saved under. */
export type VideoTarget =
  | { readonly kind: 'youtube'; readonly videoId: string }
  | { readonly kind: 'file'; readonly videoId: string; readonly name: string };

/** The owner's choices for one run. */
export interface OneVideoChoices {
  /** The one engine for the frame study and the writing; absent, the usual order. */
  readonly only?: EngineId | undefined;
  /** Watch it and study its frames again instead of reusing what is stored. */
  readonly fresh?: boolean | undefined;
}

export type OneVideoStep = 'reading' | 'downloading' | 'measuring' | 'judging';

export interface OneVideoProgress {
  readonly step: OneVideoStep;
  /** The step in plain words. */
  readonly text: string;
}

/** A kept breakdown of one video as the page shows it. */
export interface VideoBreakdownView {
  readonly videoId: string;
  readonly source: VideoSource;
  readonly title: string;
  readonly channelId: string | null;
  readonly writtenAt: string;
  /** How the video was seen, recorded in code. */
  readonly seen: VideoSeen;
  /** Who put it together; null when it could not be made. */
  readonly engine: string | null;
  /** Why it could not be made; null when it was. */
  readonly problem: string | null;
  /** The production teardown: measured in code, judged stage by stage; null for one made before teardowns. */
  readonly teardown: TeardownReport | null;
}

/** One kept breakdown in the list. */
export interface VideoBreakdownSummary {
  readonly videoId: string;
  readonly source: VideoSource;
  readonly title: string;
  readonly writtenAt: string;
  readonly written: boolean;
}

/** A video file the owner gave, as saved. */
export interface SavedUpload {
  readonly file: string;
  readonly bytes: number;
  readonly kind: string;
}

/** The breakdown view's own part of the engine. */
export interface BreakdownHub {
  /** The stored channels among those asked about, with what the chooser shows of each. */
  candidates(ids: readonly string[]): readonly CandidateFacts[];
  /** Reads one channel from YouTube when it is not stored (its page and recent videos), and describes it. */
  readCandidate(channel: string): Promise<CandidateFacts>;
  /** Breaks one video down deeply; resolves with the kept breakdown. Takes minutes. */
  breakDownVideo(
    target: VideoTarget,
    onProgress: (progress: OneVideoProgress) => void,
    choices?: OneVideoChoices,
  ): Promise<VideoBreakdownView>;
  /** Every kept breakdown of one video, the newest first; reads the store only. */
  videoBreakdowns(): readonly VideoBreakdownSummary[];
  /** One kept breakdown; null when the video was never broken down. */
  findVideoBreakdown(videoId: string): VideoBreakdownView | null;
  /** Whether the owner gave a file of that id, still on this computer. */
  hasUpload(videoId: string): Promise<boolean>;
  /** The AI runs a teardown of this video would take now, and how many parts are kept. */
  teardownRuns(videoId: string | null, fresh: boolean): Promise<TeardownRunsView>;
  /** One picture of a teardown, by its fixed name; null when there is none. */
  teardownImage(videoId: string, name: string): Promise<Uint8Array | null>;
  /** The teardown as Markdown, pictures linked under images/; null when there is none. */
  teardownMarkdown(videoId: string): string | null;
  /** The teardown folder as a ZIP: the Markdown, its pictures, the transcript and the measurements. */
  teardownZip(videoId: string): Promise<Buffer | null>;
  /** The stored parts a teardown stage asks for, as data. */
  teardownData(videoId: string, include: readonly string[]): Record<string, unknown>;
}

export interface TeardownRunsView {
  /** AI runs it would start: one per stage not kept. */
  readonly runs: number;
  readonly kept: number;
  /** Whether an engine here would watch it with sound (one of the runs). */
  readonly watch: boolean;
}
