import { formatScore } from './format';

/**
 * A trending format as Formats shows it in brief: its numbers in one
 * labelled line, its reason cut to one sentence, and dates as day and month.
 */

interface FormulaNumbers {
  readonly averageScore: number | null;
  readonly scoredCount: number;
  readonly videoCount: number;
  readonly channelCount: number;
}

const counted = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/** "30× average · 15 videos in 90 days · 7 channels", saying when only some videos are scored. */
export function formulaLine(formula: FormulaNumbers, windowDays: number): string {
  const { averageScore, scoredCount, videoCount, channelCount } = formula;
  const average =
    averageScore === null
      ? null
      : `${formatScore(averageScore)} average${scoredCount < videoCount ? ` of ${scoredCount} scored` : ''}`;
  return [
    average,
    `${counted(videoCount, 'video')} in ${windowDays} days`,
    counted(channelCount, 'channel'),
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** The first sentence of a text, and what follows it. */
export function firstSentence(text: string): { readonly lead: string; readonly rest: string } {
  const match = /^(.+?[.!?])\s+(.+)$/s.exec(text.trim());
  return match ? { lead: match[1] ?? '', rest: match[2] ?? '' } : { lead: text.trim(), rest: '' };
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** "21 Nov" for an ISO date. */
export const dayMonth = (iso: string): string => DAY_MONTH.format(new Date(iso));
