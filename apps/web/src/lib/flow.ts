import type { Pick } from './ideaLab';

/**
 * The path from research to a finished script, as the page shows it: a strip
 * of steps that jump to their sections with what is stored at each, and the
 * links that say where a thing in the idea lab or the script writer came from.
 */

/** How many of each thing are stored for the channel on screen; the server's shape. */
export interface FlowCounts {
  readonly breakouts: number;
  readonly formulas: number;
  readonly hooks: number;
  readonly concepts: number;
  readonly scripts: number;
  readonly breakdowns: number;
  readonly thumbnailReview: boolean;
  readonly styleLock: boolean;
}

export interface FlowStep {
  readonly id: 'research' | 'formats' | 'ideas' | 'script' | 'breakdown';
  readonly label: string;
  /** The id of the section it jumps to. */
  readonly target: string;
  /** What is stored, in a few words; empty before the counts are read. */
  readonly count: string;
  readonly done: boolean;
}

const counted = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;
const orNone = (count: number, word: string): string =>
  count === 0 ? `No ${word}s yet` : counted(count, word);

/** The five steps, in order, with what is stored at each. */
export function flowSteps(counts: FlowCounts | null): readonly FlowStep[] {
  const c = counts;
  const step = (
    id: FlowStep['id'],
    label: string,
    target: string,
    count: (k: FlowCounts) => string,
    done: (k: FlowCounts) => boolean,
  ): FlowStep => ({
    id,
    label,
    target,
    count: c ? count(c) : '',
    done: c ? done(c) : false,
  });
  return [
    step(
      'research',
      'Research',
      'breakouts-title',
      (k) => orNone(k.breakouts, 'breakout'),
      (k) => k.breakouts > 0,
    ),
    step(
      'formats',
      'Formats and hooks',
      'formulas',
      (k) => `${counted(k.formulas, 'format')} · ${counted(k.hooks, 'hook')}`,
      (k) => k.formulas + k.hooks > 0,
    ),
    step(
      'ideas',
      'Ideas',
      'idea-lab',
      (k) => orNone(k.concepts, 'concept'),
      (k) => k.concepts > 0,
    ),
    step(
      'script',
      'Script',
      'script-writer',
      (k) => orNone(k.scripts, 'script'),
      (k) => k.scripts > 0,
    ),
    step(
      'breakdown',
      'Breakdown',
      'ask-claude',
      (k) => orNone(k.breakdowns, 'breakdown'),
      (k) => k.breakdowns > 0,
    ),
  ];
}

/** Where a thing came from, as the destination names it. */
export type Origin = 'breakout' | 'hook' | 'transfer' | 'formula' | 'breakdown' | 'review';

const ORIGINS: Readonly<Record<Origin, { readonly label: string; readonly href: string }>> = {
  breakout: { label: 'Breaking out right now', href: '#breakouts-title' },
  hook: { label: 'the hook library', href: '#hook-library' },
  transfer: { label: 'the transfer list', href: '#transfers-title' },
  formula: { label: 'Trending formats', href: '#formulas' },
  breakdown: { label: 'the channel breakdown', href: '#ask-claude' },
  review: { label: 'the thumbnail review', href: '#ask-claude' },
};

/** The words and the link back to where a thing came from. */
export const originLink = (origin: Origin): { readonly label: string; readonly href: string } =>
  ORIGINS[origin];

interface TransferVersionLike {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly views: number;
}

/** What "Make concepts from this idea" puts into the idea lab. */
export interface FromTransfer {
  /** Its most viewed version on a channel of this map, as inspiration; null when none is on it. */
  readonly pick: Pick | null;
  /** The format option for its template. */
  readonly format: string;
  readonly idea: { readonly key: string; readonly template: string };
}

/** An idea of the transfer list as inspiration and a format for a batch of concepts. */
export function ideaFromTransfer(
  idea: {
    readonly key: string;
    readonly template: string;
    readonly versions: readonly TransferVersionLike[];
  },
  onMap: ReadonlySet<string>,
): FromTransfer {
  const best = [...idea.versions]
    .filter((version) => onMap.has(version.channelId))
    .sort((a, b) => b.views - a.views)[0];
  return {
    pick: best
      ? {
          videoId: best.videoId,
          title: best.title,
          channelTitle: best.channelTitle,
          modelOpening: false,
          from: 'transfer',
        }
      : null,
    format: `transfer:${idea.key}`,
    idea: { key: idea.key, template: idea.template },
  };
}
