/**
 * The owner's own videos against the active format, counted in code: which
 * slots each video followed (its title fits a title formula; its cuts or
 * words a minute are near the planned pace; its main colour is in the
 * planned palette) and how the videos that followed a slot did against those
 * that did not, by their outlier scores. A slot code cannot check for a
 * video (it was never measured) is counted as unknown, never as followed.
 */
import type { FormatPlan } from './plan';
import { titleFits } from './titleFit';
import type { IngredientLayer } from './types';
import { median } from '../teardown/shots';

/** Within this share of the planned pace counts as following it. */
export const CUTS_TOLERANCE = 0.25;
export const WORDS_TOLERANCE = 0.15;
/** Colours closer than this (RGB distance) count as the same colour. */
export const COLOUR_DISTANCE = 48;

export interface OwnVideoInput {
  readonly videoId: string;
  readonly title: string;
  readonly score: number | null;
  /** What a teardown measured of it; null when it was never measured. */
  readonly measured: {
    readonly cutsPerMinute: number | null;
    readonly wordsPerMinute: number | null;
    /** Its palette, the main colour first. */
    readonly palette: readonly string[];
  } | null;
}

type Verdict = 'followed' | 'not' | 'unknown';

interface SlotCheck {
  readonly layer: IngredientLayer;
  readonly check: string;
  readonly judge: (video: OwnVideoInput) => Verdict;
}

export interface FollowedSlot {
  readonly layer: IngredientLayer;
  /** What code checked, in a few words. */
  readonly check: string;
  readonly followed: number;
  readonly not: number;
  readonly unknown: number;
  readonly medianScoreFollowed: number | null;
  readonly medianScoreNot: number | null;
}

export interface FollowedRow {
  readonly videoId: string;
  readonly title: string;
  readonly score: number | null;
  readonly followed: readonly IngredientLayer[];
  readonly not: readonly IngredientLayer[];
}

export interface FollowedReport {
  readonly videos: number;
  readonly slots: readonly FollowedSlot[];
  readonly rows: readonly FollowedRow[];
}

const near = (value: number, target: number, share: number): boolean =>
  Math.abs(value - target) <= target * share;

const rgb = (hex: string): readonly number[] | null => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const close = (a: string, b: string): boolean => {
  const [x, y] = [rgb(a), rgb(b)];
  if (x === null || y === null) return false;
  return Math.hypot(...x.map((value, index) => value - (y[index] ?? 0))) <= COLOUR_DISTANCE;
};

const verdict = (fits: boolean | null): Verdict =>
  fits === null ? 'unknown' : fits ? 'followed' : 'not';

function checksFor(plan: FormatPlan): readonly SlotCheck[] {
  const formulas = plan.titleFormulas.map((one) => one.formula);
  const { cutsPerMinute: cuts, wordsPerMinute: words } = plan;
  const palette = plan.palette.map((colour) => colour.hex);
  return [
    ...(formulas.length === 0
      ? []
      : [
          {
            layer: 'title' as const,
            check: 'title fits one of its formulas',
            judge: (video: OwnVideoInput) =>
              verdict(formulas.some((formula) => titleFits(formula, video.title))),
          },
        ]),
    ...(cuts === null && words === null
      ? []
      : [
          {
            layer: 'pacing' as const,
            check: `cuts a minute within ${CUTS_TOLERANCE * 100}%, else words a minute within ${WORDS_TOLERANCE * 100}%`,
            judge: (video: OwnVideoInput) => {
              const m = video.measured;
              if (cuts !== null && m?.cutsPerMinute != null) {
                return verdict(near(m.cutsPerMinute, cuts, CUTS_TOLERANCE));
              }
              if (words !== null && m?.wordsPerMinute != null) {
                return verdict(near(m.wordsPerMinute, words, WORDS_TOLERANCE));
              }
              return 'unknown';
            },
          },
        ]),
    ...(palette.length === 0
      ? []
      : [
          {
            layer: 'visual' as const,
            check: 'its main colour is in the measured palette',
            judge: (video: OwnVideoInput) => {
              const main = video.measured?.palette[0];
              return main === undefined
                ? 'unknown'
                : verdict(palette.some((hex) => close(hex, main)));
            },
          },
        ]),
  ];
}

const medianOf = (scores: readonly (number | null)[]): number | null => {
  const known = scores.filter((score): score is number => score !== null);
  return known.length === 0 ? null : median(known);
};

export function followedSlots(plan: FormatPlan, videos: readonly OwnVideoInput[]): FollowedReport {
  const checks = checksFor(plan);
  const judged = videos.map((video) => ({
    video,
    verdicts: checks.map((check) => [check.layer, check.judge(video)] as const),
  }));
  return {
    videos: videos.length,
    slots: checks.map((check, index) => {
      const of = (wanted: Verdict) =>
        judged.filter((one) => one.verdicts[index]?.[1] === wanted).map((one) => one.video);
      return {
        layer: check.layer,
        check: check.check,
        followed: of('followed').length,
        not: of('not').length,
        unknown: of('unknown').length,
        medianScoreFollowed: medianOf(of('followed').map((video) => video.score)),
        medianScoreNot: medianOf(of('not').map((video) => video.score)),
      };
    }),
    rows: judged.map(({ video, verdicts }) => ({
      videoId: video.videoId,
      title: video.title,
      score: video.score,
      followed: verdicts.filter(([, v]) => v === 'followed').map(([layer]) => layer),
      not: verdicts.filter(([, v]) => v === 'not').map(([layer]) => layer),
    })),
  };
}
