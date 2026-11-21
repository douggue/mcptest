import type { InspirationAtAge, LinkedVideo, PlanTableKind, PlanTableRow } from '@jgtube/core';
import { formatCount, formatScore } from './format';

/** An age in whole days. */
export function daysText(days: number): string {
  const whole = Math.round(days);
  if (days < 1) return 'under a day';
  return `${whole} day${whole === 1 ? '' : 's'}`;
}

/** A linked video's views and score, said against the channel's usual at the same age. */
export function scoreLine(video: LinkedVideo): string {
  const views = `${formatCount(video.views)} views at ${daysText(video.ageDays)} old`;
  if (video.score === null || video.usualViews === null) {
    return `${views}. Not scored: the channel has too few other videos to compare with.`;
  }
  return `${views}: ${formatScore(video.score)} what this channel's videos usually have at that age (about ${formatCount(video.usualViews)}).`;
}

const NOT_COMPARABLE: Readonly<Record<string, string>> = {
  'no-reading-near-age': 'Not comparable: it was not read at about the same age.',
  'date-too-rough': 'Not comparable: an upload date is known only roughly.',
  'not-stored': 'Not comparable: this video is no longer stored.',
};

/** How an inspiration video stood at the age the owner's video is now. */
export function inspirationLine(inspiration: InspirationAtAge, ownViews: number): string {
  const { match } = inspiration;
  if (match.status === 'comparable') {
    return `At ${daysText(match.ageDays)} old it had ${formatCount(match.views)} views (read then); yours has ${formatCount(ownViews)} at the same age.`;
  }
  return NOT_COMPARABLE[match.reason] ?? 'Not comparable.';
}

export const KIND_LABELS: Readonly<Record<PlanTableKind, string>> = {
  format: 'Title format',
  hook: 'Hook style',
  length: 'Length',
};

/** How a group did: the median score of its scored videos. */
export function medianText(row: PlanTableRow): string {
  return row.medianScore === null
    ? 'No score yet'
    : `${formatScore(row.medianScore)} (median of ${row.scored} scored)`;
}

/** The plain caution under the table, with how many videos it rests on. */
export function tableCaution(videos: number): string {
  return `This rests on ${videos} linked video${videos === 1 ? '' : 's'}. A handful of videos proves little: one topic, one week or one thumbnail can explain a difference, so read this as a record, not a rule.`;
}
