/**
 * The format builder as the API sees it: the shelf of ingredients, each put
 * there by naming its source. The engine reads the source from the store and
 * works out what it rests on; nothing the page sends is taken as evidence.
 */
import type {
  BreakdownPartId,
  FormatVideo,
  Ingredient,
  IngredientLayer,
  MeasuredChannelFacts,
  NicheList,
  StoredBreakdownPart,
  TeardownReport,
  TeardownSection,
  TransferList,
} from '@jgtube/core';
import type { FormulaList, HookLibrary } from './labTypes';

/** The source an "Add to format" button names. */
export type IngredientRequest =
  | {
      readonly kind: 'formula';
      readonly center: string;
      readonly id: number;
      readonly windowDays: number;
    }
  | { readonly kind: 'transfer-format' | 'transfer-idea'; readonly key: string }
  | { readonly kind: 'hook'; readonly center: string; readonly videoId: string }
  | {
      readonly kind: 'video';
      readonly use: 'video' | 'own-video' | 'thumbnail';
      readonly videoId: string;
      readonly center: string | null;
    }
  | { readonly kind: 'niche'; readonly channelId: string }
  | {
      readonly kind: 'breakdown-part';
      readonly channelId: string;
      readonly part: BreakdownPartId;
      readonly layer: IngredientLayer | null;
    }
  | {
      readonly kind: 'teardown';
      readonly videoId: string;
      readonly section: TeardownSection;
      readonly index: number;
    }
  | { readonly kind: 'link'; readonly videoId: string }
  | {
      readonly kind: 'note';
      readonly layer: IngredientLayer;
      readonly name: string;
      readonly text: string;
    }
  | {
      readonly kind: 'image' | 'clip';
      readonly layer: IngredientLayer;
      readonly name: string;
      readonly file: string;
    };

export type AddOutcome =
  { readonly added: Ingredient } | { readonly problem: string; readonly status: 400 | 404 };

/** What the shelf reads its sources through; every one reads the store only. */
export interface FormatSources {
  listFormulas(center: string, windowDays: number): FormulaList | null;
  hookLibrary(center: string): HookLibrary | null;
  listTransfers(): TransferList;
  listNiches(): NicheList;
  findBreakdownPart(channelId: string, part: BreakdownPartId): StoredBreakdownPart | null;
  channelTitle(channelId: string): string | null;
  /** What code measured across a channel's studied videos; null when it was never measured. */
  channelMeasurements(channelId: string): MeasuredChannelFacts | null;
  teardownReport(videoId: string): TeardownReport | null;
  /** A stored video with its outlier score; null when it is not stored. */
  videoFacts(videoId: string): FormatVideo | null;
}

export interface FormatEngine {
  listIngredients(): readonly Ingredient[];
  addIngredient(request: IngredientRequest): AddOutcome;
  /** False when there is no such ingredient. */
  setIngredientNote(id: number, note: string): boolean;
  /** False when there is no such ingredient. */
  removeIngredient(id: number): boolean;
  /** The folder the owner's pictures for the shelf are kept in. Throws when there is none. */
  imagesFolder(): string;
}
