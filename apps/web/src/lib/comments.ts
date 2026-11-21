import type { FindingKind, MineOutcome } from '@jgtube/core';
import { since, span } from './changes';
import { formatCount } from './format';

/** Comment mining for one channel, as the server answers it. Times are ISO-8601. */
export interface CommentReadView {
  readonly status: 'read' | 'disabled';
  readonly count: number;
  readonly readAt: string;
}

export interface CandidateView {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  readonly score: number;
  readonly views: number;
  readonly read: CommentReadView | null;
}

export interface FindingView {
  readonly kind: FindingKind;
  readonly says: string;
  readonly comments: readonly {
    readonly commentId: string;
    readonly videoId: string;
    readonly text: string;
    readonly likes: number;
  }[];
}

export interface AnswerView {
  readonly videoIds: readonly string[];
  readonly findings: readonly FindingView[];
  readonly engine: string;
  readonly askedAt: string;
}

export interface CommentsView {
  readonly centerChannelId: string;
  readonly keySet: boolean;
  readonly unitsPerVideo: number;
  readonly maxVideos: number;
  readonly dailyUnits: number;
  readonly candidates: readonly CandidateView[];
  readonly answer: AnswerView | null;
}

export const FINDING_LABELS: Readonly<Record<FindingKind, string>> = {
  request: 'Request',
  question: 'Question',
  objection: 'Objection',
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What reading the chosen videos costs, said before it is done. */
export function quotaLine(view: CommentsView, chosen: number): string {
  const units = chosen * view.unitsPerVideo;
  return `Reading ${plural(chosen, 'video')} uses ${plural(units, 'unit')} of your YouTube API key’s daily allowance (${formatCount(view.dailyUnits).replace('K', ',000')} units a day by default). At most ${view.maxVideos} videos at once.`;
}

/** What is known of one video's comments. */
export function readLine(read: CommentReadView | null, now: Date): string {
  if (read === null) return 'Comments not read yet';
  if (read.status === 'disabled') return 'Comments are turned off for this video';
  return `${plural(read.count, 'comment')} read ${span(since(read.readAt, now))} ago`;
}

const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

/** How a read went, in a few sentences. */
export function readOutcomeLine(outcomes: readonly MineOutcome[]): string {
  const of = (status: MineOutcome['status']) =>
    outcomes.filter((outcome) => outcome.status === status);
  const read = of('read');
  const comments = read.reduce((total, outcome) => total + outcome.count, 0);
  const failed = of('failed');
  return [
    `Read ${plural(comments, 'comment')} from ${plural(read.length, 'video')}.`,
    of('disabled').length > 0 ? `${of('disabled').length} had comments turned off.` : '',
    failed.length > 0
      ? `${failed.length} could not be read: ${sentence(failed[0]?.problem ?? 'no reason given')}`
      : '',
    of('skipped').length > 0
      ? `${of('skipped').length} was not tried: the key’s daily allowance ran out.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** What a kept answer rests on, and that its findings were checked in code. */
export function askedLine(answer: AnswerView, now: Date): string {
  return `From the stored comments of ${plural(answer.videoIds.length, 'video')}, ${span(since(answer.askedAt, now))} ago, by ${answer.engine}. Only findings resting on two or more of the comments handed out are kept.`;
}
