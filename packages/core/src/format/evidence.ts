/**
 * What makes an ingredient "proven", how the shelf orders ingredients by
 * what they rest on, and the rules a draft must meet before it is stored.
 */
import { CHANNEL_ID_PATTERN } from '../sources/parse';
import {
  INGREDIENT_LAYERS,
  INGREDIENT_SOURCES,
  type IngredientDraft,
  type IngredientEvidence,
} from './types';

/** One video is an example, not a pattern. */
export const PROVEN_MIN_VIDEOS = 2;
/** One channel repeating itself is its own habit, not something that works across a niche. */
export const PROVEN_MIN_CHANNELS = 2;
export const MAX_INGREDIENT_NAME = 80;
export const MAX_SOURCE_KEY = 200;
export const MAX_SOURCE_LABEL = 200;
/** The most characters of the owner's own note on one ingredient. */
export const MAX_INGREDIENT_NOTE = 2_000;

export const noEvidence = (): IngredientEvidence => ({
  score: null,
  scoredVideos: 0,
  videos: null,
  channels: null,
  measured: [],
});

/** Used by at least two videos of at least two channels. */
export const isProven = (evidence: IngredientEvidence): boolean =>
  (evidence.videos ?? 0) >= PROVEN_MIN_VIDEOS && (evidence.channels ?? 0) >= PROVEN_MIN_CHANNELS;

/** The mean of the scores there are, and over how many. */
export function meanScore(scores: readonly (number | null)[]): {
  readonly score: number | null;
  readonly scoredVideos: number;
} {
  const known = scores.filter((score): score is number => score !== null);
  if (known.length === 0) return { score: null, scoredVideos: 0 };
  return {
    score: known.reduce((sum, score) => sum + score, 0) / known.length,
    scoredVideos: known.length,
  };
}

/** Proven first, then more channels, more videos, a higher score. */
export function compareByEvidence(
  a: { readonly evidence: IngredientEvidence },
  b: { readonly evidence: IngredientEvidence },
): number {
  const keys = (evidence: IngredientEvidence): readonly number[] => [
    isProven(evidence) ? 1 : 0,
    evidence.channels ?? -1,
    evidence.videos ?? -1,
    evidence.score ?? -1,
  ];
  const left = keys(a.evidence);
  const right = keys(b.evidence);
  const index = left.findIndex((value, at) => value !== right[at]);
  return index === -1 ? 0 : (right[index] ?? 0) - (left[index] ?? 0);
}

const isCount = (value: number | null): boolean =>
  value === null || (Number.isInteger(value) && value >= 0);

function evidenceIsSound(evidence: IngredientEvidence): boolean {
  const score = evidence.score;
  return (
    isCount(evidence.videos) &&
    isCount(evidence.channels) &&
    isCount(evidence.scoredVideos) &&
    (score === null || (Number.isFinite(score) && score >= 0)) &&
    evidence.measured.every((number) => Number.isFinite(number.value))
  );
}

/** Why a draft cannot be stored, in plain words, or null when it can. */
export function draftProblem(draft: IngredientDraft): string | null {
  const name = draft.name.trim();
  if (name === '' || name.length > MAX_INGREDIENT_NAME) {
    return `An ingredient needs a name of 1 to ${MAX_INGREDIENT_NAME} characters.`;
  }
  if (!(INGREDIENT_LAYERS as readonly string[]).includes(draft.layer)) return 'Not a layer.';
  if (!(INGREDIENT_SOURCES as readonly string[]).includes(draft.source)) return 'Not a source.';
  if (draft.sourceKey === '' || draft.sourceKey.length > MAX_SOURCE_KEY) {
    return 'An ingredient needs the key of its source.';
  }
  const channels = [...draft.channelIds, ...(draft.centerChannelId ? [draft.centerChannelId] : [])];
  if (channels.some((id) => !CHANNEL_ID_PATTERN.test(id))) return 'Not a channel id.';
  return evidenceIsSound(draft.evidence) ? null : 'Its evidence holds a number that is not one.';
}
