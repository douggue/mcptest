import type { PacingView, Spread } from '@jgtube/core';
import { formatDuration } from './format';
import type { Tile } from './tiles';

export type Measure = 'length' | 'pace';

const valueText = (value: number, measure: Measure): string =>
  measure === 'length' ? formatDuration(Math.round(value)) : String(Math.round(value));

/** A median and middle half, in minutes and seconds or in words a minute. */
export function spreadText(spread: Spread, measure: Measure): string {
  const { median, lower, upper } = spread;
  if (median === null || lower === null || upper === null) return 'Nothing to measure';
  const unit = measure === 'pace' ? ' words a minute' : '';
  return `${valueText(median, measure)}${unit} median · middle half ${valueText(lower, measure)} to ${valueText(upper, measure)}`;
}

/** How many videos a figure rests on. */
export function restsOn(spread: Spread, measure: Measure): string {
  const noun = spread.count === 1 ? 'video' : 'videos';
  if (measure === 'length') return `from ${spread.count} ${noun}`;
  return spread.count === 0
    ? 'no video with captions stored'
    : `from ${spread.count} ${noun} with captions stored`;
}

/** A median alone, as a tile shows it; a dash when there is nothing to measure. */
function medianText(spread: Spread, measure: Measure): string {
  return spread.median === null ? '–' : valueText(spread.median, measure);
}

/** The four medians, yours beside the winners', each with what it rests on. */
export function pacingTiles(
  pacing: Pick<PacingView, 'lengths' | 'wordsPerMinute'>,
): readonly Tile[] {
  const tile = (label: string, spread: Spread, measure: Measure): Tile => ({
    label,
    value: medianText(spread, measure),
    note: `Median, ${restsOn(spread, measure)}`,
  });
  return [
    tile('Your length', pacing.lengths.own, 'length'),
    tile('Winners’ length', pacing.lengths.winners, 'length'),
    tile('Your words a minute', pacing.wordsPerMinute.own, 'pace'),
    tile('Winners’ words a minute', pacing.wordsPerMinute.winners, 'pace'),
  ];
}

export function winnersRule(rule: PacingView['rule'], lookalikes: number): string {
  return `Winners are the breakouts of the ${lookalikes} look-alike${lookalikes === 1 ? '' : 's'} on this map: videos of the last ${rule.windowDays} days at ${rule.minScore}× their channel's usual views or more, at most ${rule.perChannel} from one channel.`;
}

/** Which Shorts were left out of the lengths; null when none were. */
export function shortsNote(left: PacingView['shortsLeftOut']): string | null {
  if (left.own + left.winners === 0) return null;
  return `Shorts (a minute or less) are left out: ${left.own} of yours and ${left.winners} of the winners’.`;
}

export interface ChartRow {
  readonly label: string;
  /** The middle half and the median, in percent of the chart's width; null with nothing to show. */
  readonly from: number | null;
  readonly to: number | null;
  readonly at: number | null;
  readonly count: number;
}

/** The scale runs to this much past the highest value, leaving room for the labels. */
const HEADROOM = 4 / 3;

/** Each spread's middle half and median on one shared scale from zero. */
export function chartRows(
  rows: readonly { readonly label: string; readonly spread: Spread }[],
): readonly ChartRow[] {
  const highest = Math.max(0, ...rows.map(({ spread }) => spread.upper ?? spread.median ?? 0));
  const top = highest * HEADROOM;
  const place = (value: number | null): number | null =>
    value === null || top === 0 ? null : Math.round((value / top) * 1000) / 10;
  return rows.map(({ label, spread }) => ({
    label,
    from: place(spread.lower),
    to: place(spread.upper),
    at: place(spread.median),
    count: spread.count,
  }));
}
