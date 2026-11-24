/**
 * Ingredients from what the research views already worked out in code: a
 * title formula, a transfer-list title format or idea, and a hook's way of
 * opening. Every count and score is taken from the store's numbers as they
 * were read; nothing an engine wrote is counted.
 */
import type { LibraryHook } from '../hooks/library';
import type { VerifiedFormula } from '../formulas/formulas';
import type { TransferFormat, TransferIdea } from '../transfer/types';
import { MAX_INGREDIENT_NAME, meanScore } from './evidence';
import type { IngredientDraft, IngredientMedia } from './types';

/** How many example thumbnails an ingredient keeps. */
export const MEDIA_EXAMPLES = 3;
/** The most characters of an opening kept as its quote. */
export const QUOTE_CHARS = 280;

/** A name cut to fit, on a word where it can be. */
export function shortName(text: string, max = MAX_INGREDIENT_NAME): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const unique = (ids: readonly string[]): readonly string[] => [...new Set(ids)];
const thumbnails = (videoIds: readonly string[]): readonly IngredientMedia[] =>
  unique(videoIds)
    .slice(0, MEDIA_EXAMPLES)
    .map((videoId) => ({ kind: 'thumbnail', videoId }));

export function ingredientFromFormula(
  centerChannelId: string,
  windowDays: number,
  formula: VerifiedFormula & { readonly id: number },
): IngredientDraft {
  const videos = formula.videos;
  return {
    layer: 'title',
    name: shortName(formula.formula),
    source: 'formula',
    sourceKey: `${centerChannelId}:${windowDays}:${formula.id}`,
    sourceLabel: `Title formula, last ${windowDays} days`,
    centerChannelId,
    channelIds: unique(videos.map((video) => video.channelId)),
    details: {
      formula: formula.formula,
      examples: videos.slice(0, MEDIA_EXAMPLES).map((video) => video.title),
      windowDays,
    },
    evidence: {
      score: formula.averageScore,
      scoredVideos: formula.scoredCount,
      videos: formula.videoCount,
      channels: formula.channelCount,
      measured: [],
    },
    media: thumbnails(videos.map((video) => video.videoId)),
  };
}

export function ingredientFromTransferFormat(format: TransferFormat): IngredientDraft {
  return {
    layer: 'title',
    name: shortName(format.template),
    source: 'transfer-format',
    sourceKey: format.key,
    sourceLabel: 'Title format used for several subjects',
    centerChannelId: null,
    channelIds: [],
    details: {
      template: format.template,
      subjects: format.subjects.slice(0, MEDIA_EXAMPLES).map((subject) => subject.subject),
    },
    evidence: {
      score: null,
      scoredVideos: 0,
      videos: format.videoCount,
      channels: format.channelCount,
      measured: [
        {
          label: 'Median views',
          value: format.medianViews,
          unit: 'views',
          method: 'median of its stored videos',
        },
        { label: 'Subjects', value: format.subjectCount, unit: '', method: 'counted' },
      ],
    },
    media: thumbnails(format.subjects.map((subject) => subject.videoId)),
  };
}

export function ingredientFromTransferIdea(idea: TransferIdea): IngredientDraft {
  const versions = idea.versions;
  return {
    layer: 'title',
    name: shortName(idea.template),
    source: 'transfer-idea',
    sourceKey: idea.key,
    sourceLabel: 'Idea made in several places',
    centerChannelId: null,
    channelIds: unique(versions.map((version) => version.channelId)),
    details: {
      template: idea.template,
      status: idea.verdict.status,
      places: idea.places.map((place) => place.name),
    },
    evidence: {
      ...meanScore(versions.map((version) => version.score)),
      videos: idea.versionCount,
      channels: idea.channelCount,
      measured:
        idea.best === null
          ? []
          : [
              {
                label: 'Best views',
                value: idea.best.views,
                unit: 'views',
                method: 'stored views',
              },
            ],
    },
    media: thumbnails(versions.map((version) => version.videoId)),
  };
}

/** The hooks that open the same way as this one: the library hooks an engine named alike. */
function sameStyle(hook: LibraryHook, library: readonly LibraryHook[]): readonly LibraryHook[] {
  if (hook.style === null) return [hook];
  const style = hook.style.toLowerCase();
  return library.filter((other) => other.style?.toLowerCase() === style);
}

/**
 * A hook's way of opening. With a style name, the evidence is every library
 * hook given the same name; without one, it is this one video.
 */
export function ingredientFromHook(
  centerChannelId: string,
  hook: LibraryHook,
  library: readonly LibraryHook[],
): IngredientDraft {
  const alike = sameStyle(hook, library);
  const wordsAMinute =
    hook.words !== null && hook.lastLineAtSeconds !== null && hook.lastLineAtSeconds > 0
      ? (hook.words / hook.lastLineAtSeconds) * 60
      : null;
  const quote: readonly IngredientMedia[] =
    hook.text === null
      ? []
      : [{ kind: 'quote', text: shortName(hook.text, QUOTE_CHARS), videoId: hook.videoId }];
  return {
    layer: 'hook',
    name: shortName(hook.style ?? `Opening of “${hook.title}”`),
    source: 'hook',
    sourceKey: `${centerChannelId}:${hook.videoId}`,
    sourceLabel: hook.channelTitle,
    centerChannelId,
    channelIds: unique(alike.map((other) => other.channelId)),
    details: {
      style: hook.style,
      how: hook.how,
      videoTitle: hook.title,
      autoCaptions: hook.autoGenerated,
    },
    evidence: {
      ...meanScore(alike.map((other) => other.score)),
      videos: alike.length,
      channels: unique(alike.map((other) => other.channelId)).length,
      measured: [
        ...(hook.words === null
          ? []
          : [
              {
                label: 'Words in the first minute',
                value: hook.words,
                unit: 'words',
                method: 'counted in its captions',
              },
            ]),
        ...(wordsAMinute === null
          ? []
          : [
              {
                label: 'Pace of the opening',
                value: Math.round(wordsAMinute),
                unit: 'words a minute',
                method: 'words over the time of its last line',
              },
            ]),
      ],
    },
    media: [...thumbnails(alike.map((other) => other.videoId)), ...quote],
  };
}
