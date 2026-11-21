/**
 * Counting, in code, what the winning thumbnails share that ordinary ones
 * and the owner's do not. Each channel counts once: a value's share among
 * winners is the average of its share within each channel's winners, so a
 * channel with many winners cannot carry a value alone. A value that only
 * one channel's winners show is that channel's branding; a value ordinary
 * videos show about as often is the topic, not the thumbnail.
 */
import type { CompareThumb, ComparisonSet } from './compare';
import { TAG_ATTRIBUTES, tagValues, type TagKey, type ThumbTags } from './tags';

/** At least this share of winners, channel by channel, for a value to count as winning. */
export const WINNING_SHARE = 0.4;
/** Winners in at least this many channels must show it. */
export const WINNING_CHANNELS = 2;
/** And it must be this many times as common among winners as among ordinary videos. */
export const WINNING_LIFT = 1.25;
/** Shares this close mean the thumbnail made no difference. */
export const SAME_SHARE = 0.15;
/** Keeps a share of nothing from making a lift endless. */
const SMOOTHING = 0.05;
const MAX_EXAMPLES = 3;

export type CountFlag = 'branding' | 'topic';

export interface CountRow {
  readonly key: TagKey;
  readonly label: string;
  readonly value: string;
  /** Winners showing it, of the winners tagged. */
  readonly winners: number;
  readonly winnersTagged: number;
  /** Its share among winners, each channel counted once. */
  readonly winnerShare: number;
  /** How many channels' winners show it. */
  readonly channels: number;
  readonly ordinary: number;
  readonly ordinaryTagged: number;
  /** Its share among ordinary videos, each channel counted once; null when none was tagged. */
  readonly ordinaryShare: number | null;
  /** How many times as common among winners; null without ordinary videos to compare. */
  readonly lift: number | null;
  /** Whether the thumbnail under review shows it. */
  readonly yours: boolean;
  readonly flag: CountFlag | null;
  readonly winning: boolean;
  /** Winners that show it, by video id. */
  readonly examples: readonly string[];
}

export interface Counted {
  readonly rows: readonly CountRow[];
  readonly winnersTagged: number;
  readonly ordinaryTagged: number;
  /** Channels with at least one tagged winner. */
  readonly channels: number;
  readonly targetTagged: boolean;
}

interface Tagged {
  readonly thumb: CompareThumb;
  readonly tags: ThumbTags;
}

const has = (tags: ThumbTags, key: TagKey, value: string): boolean =>
  tagValues(tags, key).includes(value);

/** The average, over channels, of the share of each channel's thumbnails that show it. */
function channelShare(tagged: readonly Tagged[], key: TagKey, value: string): number | null {
  const channels = [...new Set(tagged.map((entry) => entry.thumb.channelId))];
  if (channels.length === 0) return null;
  const shares = channels.map((channel) => {
    const own = tagged.filter((entry) => entry.thumb.channelId === channel);
    return own.filter((entry) => has(entry.tags, key, value)).length / own.length;
  });
  return shares.reduce((sum, share) => sum + share, 0) / shares.length;
}

const round = (value: number): number => Math.round(value * 10) / 10;

function flagOf(row: Omit<CountRow, 'flag' | 'winning'>, channelsTagged: number): CountFlag | null {
  if (row.winners >= 2 && row.channels === 1 && channelsTagged >= 2) return 'branding';
  if (row.ordinaryShare !== null && Math.abs(row.winnerShare - row.ordinaryShare) <= SAME_SHARE) {
    return 'topic';
  }
  return null;
}

const isWinning = (row: Omit<CountRow, 'winning'>): boolean =>
  row.flag === null &&
  row.winnerShare >= WINNING_SHARE &&
  row.channels >= WINNING_CHANNELS &&
  (row.lift === null || row.lift >= WINNING_LIFT);

function rowFor(
  key: TagKey,
  label: string,
  value: string,
  sides: { readonly winners: readonly Tagged[]; readonly ordinary: readonly Tagged[] },
  target: ThumbTags | null,
): CountRow {
  const showing = sides.winners.filter((entry) => has(entry.tags, key, value));
  const winnerShare = channelShare(sides.winners, key, value) ?? 0;
  const ordinaryShare = channelShare(sides.ordinary, key, value);
  const base = {
    key,
    label,
    value,
    winners: showing.length,
    winnersTagged: sides.winners.length,
    winnerShare,
    channels: new Set(showing.map((entry) => entry.thumb.channelId)).size,
    ordinary: sides.ordinary.filter((entry) => has(entry.tags, key, value)).length,
    ordinaryTagged: sides.ordinary.length,
    ordinaryShare,
    lift:
      ordinaryShare === null
        ? null
        : round((winnerShare + SMOOTHING) / (ordinaryShare + SMOOTHING)),
    yours: target !== null && has(target, key, value),
    examples: showing.slice(0, MAX_EXAMPLES).map((entry) => entry.thumb.videoId),
  };
  const flagged = {
    ...base,
    flag: flagOf(base, new Set(sides.winners.map((e) => e.thumb.channelId)).size),
  };
  return { ...flagged, winning: isWinning(flagged) };
}

const taggedOf = (
  thumbs: readonly CompareThumb[],
  tags: ReadonlyMap<string, ThumbTags>,
): readonly Tagged[] =>
  thumbs.flatMap((thumb) => {
    const found = tags.get(thumb.videoId);
    return found ? [{ thumb, tags: found }] : [];
  });

/** Every value a winner or the thumbnail under review shows, counted; winning values first. */
export function countComparison(
  set: ComparisonSet,
  tags: ReadonlyMap<string, ThumbTags>,
  targetId: string,
): Counted {
  const sides = { winners: taggedOf(set.winners, tags), ordinary: taggedOf(set.ordinary, tags) };
  const target = tags.get(targetId) ?? null;
  const rows = TAG_ATTRIBUTES.flatMap(({ key, label }) => {
    const seen = [...sides.winners.map((entry) => entry.tags), ...(target ? [target] : [])];
    const values = [...new Set(seen.flatMap((entry) => tagValues(entry, key)))];
    return values.map((value) => rowFor(key, label, value, sides, target));
  });
  return {
    rows: [...rows].sort(
      (a, b) => Number(b.winning) - Number(a.winning) || b.winnerShare - a.winnerShare,
    ),
    winnersTagged: sides.winners.length,
    ordinaryTagged: sides.ordinary.length,
    channels: new Set(sides.winners.map((entry) => entry.thumb.channelId)).size,
    targetTagged: target !== null,
  };
}

/** The winning values the thumbnail under review does not show. */
export const missingValues = (counted: Counted): readonly CountRow[] =>
  counted.rows.filter((row) => row.winning && !row.yours);
