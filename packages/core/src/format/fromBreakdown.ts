/**
 * An ingredient from one written part of a channel's breakdown. The part is
 * an engine's reading, kept as it was written and marked as such; its
 * evidence counts one channel, so it is never proven on its own.
 */
import { BREAKDOWN_PART_TITLES, type BreakdownPartId } from '../breakdown/parts';
import { shortName } from './fromLab';
import type { IngredientDraft, IngredientLayer, MeasuredNumber } from './types';

/** The most characters of a part's text kept on the shelf; the whole part stays in its breakdown. */
export const PART_EXCERPT_CHARS = 4_000;

/** The layer a part fills unless the owner picks another. */
export const PART_LAYERS: Readonly<Record<BreakdownPartId, IngredientLayer>> = {
  basis: 'other',
  titles: 'title',
  thumbnails: 'thumbnail',
  scripts: 'structure',
  picture: 'visual',
  strategy: 'other',
  plan: 'other',
  master: 'other',
};

export interface BreakdownPartSource {
  readonly channelId: string;
  readonly channelTitle: string;
  readonly part: BreakdownPartId;
  readonly engine: string;
  readonly text: string;
  /** Numbers code measured across the channel's videos that bear on this layer. */
  readonly measured: readonly MeasuredNumber[];
}

export function ingredientFromBreakdownPart(
  source: BreakdownPartSource,
  layer: IngredientLayer = PART_LAYERS[source.part],
): IngredientDraft {
  const title = BREAKDOWN_PART_TITLES[source.part];
  return {
    layer,
    name: shortName(`${title} of ${source.channelTitle}`),
    source: 'breakdown-part',
    sourceKey: `${source.channelId}:${source.part}`,
    sourceLabel: `Breakdown of ${source.channelTitle}`,
    centerChannelId: null,
    channelIds: [source.channelId],
    details: {
      part: source.part,
      partTitle: title,
      engine: source.engine,
      // An engine's reading of the channel, never a measurement.
      reading: source.text.slice(0, PART_EXCERPT_CHARS),
      cut: source.text.length > PART_EXCERPT_CHARS,
    },
    evidence: {
      score: null,
      scoredVideos: 0,
      videos: null,
      channels: 1,
      measured: source.measured,
    },
    media: [],
  };
}
