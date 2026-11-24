/**
 * The format builder's formats as the API sees them: each with its fit and
 * originality checks worked out in code from the shelf, and "Suggest a mix",
 * an AI run whose answer code checks against the shelf before it is kept.
 */
import type { Format, FormatChange, FormatChecks, ShelfForMix } from '@jgtube/core';
import type { EngineId } from './engines/types';

/** A format with its checks, as the page shows it. */
export interface FormatView extends Format {
  readonly checks: FormatChecks;
  /** The name of the channel the originality check counts most slots from; null when none. */
  readonly topChannelTitle: string | null;
}

/** The step a suggestion is on, in plain words. */
export interface MixProgress {
  readonly step: 'asking' | 'checking';
  readonly text: string;
}

export interface FormatBuilderEngine {
  /** The formats of a channel (null: made with no map open), the one changed last first. */
  listFormats(channel?: string | null): readonly FormatView[];
  /** Throws, in plain words, for a name or length that breaks a rule. */
  createFormat(name: string, targetSeconds: number | null, channel?: string | null): FormatView;
  /** Null when there is no such format; throws for a change that breaks a rule. */
  updateFormat(id: number, change: FormatChange): FormatView | null;
  /** A copy named "… v2"; null when there is no such format. */
  duplicateFormat(id: number): FormatView | null;
  removeFormat(id: number): boolean;
  /** The format's name; null when there is no such format. */
  formatName(id: number): string | null;
  /**
   * Asks an AI for a full mix from the shelf, reading the map of `channel`
   * when one is given; keeps the checked suggestion on the format.
   * Rejects, in plain words, when the format or shelf is empty or no slot
   * of the answer survives the checks.
   */
  suggestMix(
    formatId: number,
    channel: string | null,
    only: EngineId | undefined,
    report: (progress: MixProgress) => void,
  ): Promise<FormatView>;
  /** The shelf as the connector's tool shows it; null when there is no such format. */
  shelfForMix(formatId: number): ShelfForMix | null;
  /** One of the shelf's pictures by its name made in code; null when there is none. */
  mixPicture(name: string): Promise<Uint8Array | null>;
}
