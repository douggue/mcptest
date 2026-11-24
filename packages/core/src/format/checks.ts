/**
 * The fit and originality checks of a format, worked out in code from the
 * ingredients in its slots. They flag only: a clash names what does not fit
 * and the numbers it rests on; nothing is changed or judged for the owner.
 */
import { LONG_HOOK_SECONDS, SHORTS_HOOK_SECONDS } from '../script/types';
import type { FormatSlots } from './formats';
import type { Ingredient, IngredientLayer } from './types';

/** A Short is a minute or less. */
export const SHORT_MAX_SECONDS = 60;
/** A long video's hook may run to a tenth of it before it is called long, never under a minute. */
export const HOOK_MAX_SHARE = 0.1;
/** Two paces further apart than this many times do not sit in one video without a reason. */
export const PACE_CLASH_RATIO = 2;
/** More than this share of the filled slots from one channel copies that channel. */
export const ONE_CHANNEL_MAX_SHARE = 0.6;
/** Fewer filled slots than this say nothing about where a format comes from. */
export const ORIGINALITY_MIN_SLOTS = 2;
export const CUTS_LABEL = 'Cuts a minute';

export type ClashKind = 'hook-length' | 'pace-motion' | 'thumbnail-hook';

export interface Clash {
  readonly kind: ClashKind;
  readonly layers: readonly IngredientLayer[];
  /** One plain sentence with the numbers it rests on. */
  readonly says: string;
}

export interface Originality {
  readonly filled: number;
  /** The channel most slots come from; null with too few slots or none from a channel. */
  readonly channelId: string | null;
  readonly fromChannel: number;
  readonly share: number;
  /** The names of the slots it fills. */
  readonly layers: readonly IngredientLayer[];
  readonly copiesOneChannel: boolean;
}

export interface FormatChecks {
  readonly clashes: readonly Clash[];
  readonly originality: Originality;
  /** Filled slots whose ingredient is not proven (fewer than two videos from two channels). */
  readonly unproven: readonly IngredientLayer[];
}

type Filled = Partial<Record<IngredientLayer, Ingredient>>;

const measured = (item: Ingredient | undefined, label: string): number | null =>
  item?.evidence.measured.find((number) => number.label.startsWith(label))?.value ?? null;

/** How long an opening runs, from what was counted: its words and pace, or its beats' times. */
export function hookSeconds(hook: Ingredient): number | null {
  const words = measured(hook, 'Words in the first minute');
  const pace = measured(hook, 'Pace of the opening');
  if (words !== null && pace !== null && pace > 0) return Math.round((words / pace) * 60);
  const rows = hook.details['rows'];
  if (!Array.isArray(rows)) return null;
  const ends = rows.flatMap((row: unknown) => {
    const end = typeof row === 'object' && row !== null ? (row as { end?: unknown }).end : null;
    return typeof end === 'number' && Number.isFinite(end) ? [end] : [];
  });
  return ends.length === 0 ? null : Math.round(Math.max(...ends));
}

/** The longest hook that fits a video of this length. */
export const hookLimit = (targetSeconds: number): number =>
  targetSeconds <= SHORT_MAX_SECONDS
    ? SHORTS_HOOK_SECONDS
    : Math.max(LONG_HOOK_SECONDS, Math.round(targetSeconds * HOOK_MAX_SHARE));

function hookClash(filled: Filled, targetSeconds: number | null): Clash | null {
  if (!filled.hook || targetSeconds === null) return null;
  const seconds = hookSeconds(filled.hook);
  const limit = hookLimit(targetSeconds);
  if (seconds === null || seconds <= limit) return null;
  return {
    kind: 'hook-length',
    layers: ['hook'],
    says: `The hook runs about ${seconds} s, longer than the ${limit} s that fits a ${targetSeconds} s video.`,
  };
}

function paceClash(filled: Filled): Clash | null {
  const pace = measured(filled.pacing, CUTS_LABEL);
  const motionLayer = filled.motion ? 'motion' : filled.visual ? 'visual' : null;
  const motion = motionLayer === null ? null : measured(filled[motionLayer], CUTS_LABEL);
  if (pace === null || motion === null || motionLayer === null || pace <= 0 || motion <= 0) {
    return null;
  }
  if (Math.max(pace, motion) / Math.min(pace, motion) <= PACE_CLASH_RATIO) return null;
  return {
    kind: 'pace-motion',
    layers: ['pacing', motionLayer],
    says: `The pacing comes from a video with ${pace} cuts a minute, the ${motionLayer === 'motion' ? 'motion' : 'visual style'} from one with ${motion}.`,
  };
}

/** The videos an ingredient comes from, as far as it names them. */
export function videosOf(item: Ingredient): ReadonlySet<string> {
  const named = item.details['videoId'];
  return new Set([
    ...(typeof named === 'string' ? [named] : []),
    ...item.media.flatMap((media) => ('videoId' in media && media.videoId ? [media.videoId] : [])),
  ]);
}

function promiseClash(filled: Filled): Clash | null {
  const { thumbnail, hook } = filled;
  if (!thumbnail || !hook) return null;
  const thumbVideos = videosOf(thumbnail);
  const hookVideos = [...videosOf(hook)];
  if (thumbVideos.size === 0 || hookVideos.length === 0) return null;
  if (hookVideos.some((id) => thumbVideos.has(id))) return null;
  return {
    kind: 'thumbnail-hook',
    layers: ['thumbnail', 'hook'],
    says: 'The thumbnail and the hook come from different videos: check that the opening pays off what the thumbnail promises.',
  };
}

function originality(filled: Filled): Originality {
  const entries = Object.entries(filled) as [IngredientLayer, Ingredient][];
  const counts = new Map<string, IngredientLayer[]>();
  for (const [layer, item] of entries) {
    for (const id of new Set(item.channelIds)) counts.set(id, [...(counts.get(id) ?? []), layer]);
  }
  const top = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const filledCount = entries.length;
  if (!top || filledCount < ORIGINALITY_MIN_SLOTS) {
    return {
      filled: filledCount,
      channelId: null,
      fromChannel: 0,
      share: 0,
      layers: [],
      copiesOneChannel: false,
    };
  }
  const share = top[1].length / filledCount;
  return {
    filled: filledCount,
    channelId: top[0],
    fromChannel: top[1].length,
    share,
    layers: top[1],
    copiesOneChannel: share > ONE_CHANNEL_MAX_SHARE,
  };
}

/** The ingredient in each filled slot; a slot naming one not on the shelf counts as empty. */
export function filledSlots(slots: FormatSlots, shelf: readonly Ingredient[]): Filled {
  const byId = new Map(shelf.map((item) => [item.id, item]));
  return Object.fromEntries(
    Object.entries(slots).flatMap(([layer, slot]) => {
      const item = slot ? byId.get(slot.ingredientId) : undefined;
      return item ? [[layer, item]] : [];
    }),
  ) as Filled;
}

export function formatChecks(
  format: { readonly slots: FormatSlots; readonly targetSeconds: number | null },
  shelf: readonly Ingredient[],
): FormatChecks {
  const filled = filledSlots(format.slots, shelf);
  const clashes = [
    hookClash(filled, format.targetSeconds),
    paceClash(filled),
    promiseClash(filled),
  ];
  return {
    clashes: clashes.filter((clash): clash is Clash => clash !== null),
    originality: originality(filled),
    unproven: (Object.entries(filled) as [IngredientLayer, Ingredient][])
      .filter(([, item]) => !item.proven)
      .map(([layer]) => layer),
  };
}
