/**
 * An ingredient from one written part of a channel's breakdown. The part is
 * an engine's reading, kept as it was written and marked as such; its
 * evidence counts one channel, so it is never proven on its own.
 */
import { BREAKDOWN_PART_TITLES, type BreakdownPartId } from '../breakdown/parts';
import type { ChannelFacts } from '../teardown/channelFacts';
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
  /** The palette measured across the channel's videos, for a part on the visual layer. */
  readonly palette?: readonly { readonly hex: string; readonly share: number }[];
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
      ...(source.palette && source.palette.length > 0 ? { palette: source.palette } : {}),
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

/** What a breakdown part's layer takes from the channel's measured layer. */
export interface PartMeasured {
  readonly measured: readonly MeasuredNumber[];
  /** The palette shared across the channel's measured videos; empty off the visual layer. */
  readonly palette: readonly { readonly hex: string; readonly share: number }[];
}

type Group = ChannelFacts['winners'];
type Median = Exclude<
  {
    [K in keyof Group]: Group[K] extends number | null ? K : never;
  }[keyof Group],
  'videos' | 'measured'
>;
interface Row {
  readonly label: string;
  readonly key: Median;
  readonly unit: string;
  readonly method: 'pace' | 'words' | 'loudness' | 'transitions';
}

const ROW = {
  cuts: { label: 'Cuts a minute', key: 'medianCutsPerMinute', unit: 'a minute', method: 'pace' },
  shot: { label: 'Median shot', key: 'medianShotSeconds', unit: 'seconds', method: 'pace' },
  words: {
    label: 'Words a minute',
    key: 'medianWordsPerMinute',
    unit: 'words a minute',
    method: 'words',
  },
  sentence: {
    label: 'Words in a sentence',
    key: 'medianSentenceWords',
    unit: 'words',
    method: 'words',
  },
  hook: {
    label: 'Pace of the opening',
    key: 'medianHookWordsPerMinute',
    unit: 'words a minute',
    method: 'words',
  },
  lufs: {
    label: 'Integrated loudness',
    key: 'medianIntegratedLufs',
    unit: 'LUFS',
    method: 'loudness',
  },
  lra: { label: 'Loudness range', key: 'medianLoudnessRangeLu', unit: 'LU', method: 'loudness' },
  transitions: {
    label: 'Transitions a minute',
    key: 'medianTransitionsPerMinute',
    unit: 'a minute',
    method: 'transitions',
  },
  animations: {
    label: 'Animations a minute',
    key: 'medianAnimationsPerMinute',
    unit: 'a minute',
    method: 'transitions',
  },
} as const satisfies Record<string, Row>;

const ROWS: Readonly<Record<IngredientLayer, readonly Row[]>> = {
  title: [],
  thumbnail: [],
  other: [],
  hook: [ROW.hook],
  structure: [ROW.words, ROW.sentence],
  pacing: [ROW.cuts, ROW.shot, ROW.words],
  visual: [ROW.animations],
  motion: [ROW.transitions, ROW.animations, ROW.cuts],
  sound: [ROW.lufs, ROW.lra],
};

const PERCENT = 100;

/**
 * The winners' medians that bear on a layer, each with how it was counted;
 * on the visual layer also the palette shared across the measured videos.
 * A median code could not take is left out.
 */
export function measuredForLayer(layer: IngredientLayer, facts: ChannelFacts): PartMeasured {
  const { winners, methods } = facts;
  const counted = (row: Row): string =>
    row.method === 'words'
      ? `median of ${winners.videos} winners; ${methods[row.method] ?? ''}`
      : `median of ${winners.measured} measured winners; ${methods[row.method] ?? ''}`;
  const medians = ROWS[layer].flatMap((row): MeasuredNumber[] => {
    const value = winners[row.key];
    return value === null || value === undefined
      ? []
      : [{ label: row.label, value, unit: row.unit, method: counted(row) }];
  });
  if (layer !== 'visual') return { measured: medians, palette: [] };
  const palette = facts.palette.items.map((item) => ({ hex: item.hex, share: item.share }));
  return {
    measured: [
      ...palette.map((colour) => ({
        label: colour.hex,
        value: Math.round(colour.share * PERCENT * 10) / 10,
        unit: '% of runtime',
        method: facts.palette.method,
      })),
      ...medians,
    ],
    palette,
  };
}
