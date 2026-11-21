import { median } from '../scoring/outlier';

/**
 * The owner's linked videos counted by the title format, hook style and
 * length they used, with how they did: the median outlier score of those
 * that have one. Counts are always given; a handful of videos proves little.
 */

/** Length bands in seconds, the same for every channel: a Short, then common video lengths. */
export const PLAN_LENGTH_BANDS: readonly { readonly upTo: number; readonly label: string }[] = [
  { upTo: 60, label: 'Under 1 minute' },
  { upTo: 8 * 60, label: '1 to 8 minutes' },
  { upTo: 15 * 60, label: '8 to 15 minutes' },
  { upTo: 25 * 60, label: '15 to 25 minutes' },
  { upTo: Number.POSITIVE_INFINITY, label: '25 minutes or more' },
];

export const NO_FORMAT = 'No title format picked';
export const NO_HOOK = 'No hook style named';
export const NO_LENGTH = 'Length not known';

export function lengthBand(seconds: number | null): string {
  if (seconds === null) return NO_LENGTH;
  return PLAN_LENGTH_BANDS.find((band) => seconds < band.upTo)?.label ?? NO_LENGTH;
}

/** What the table needs of one linked video. */
export interface TableVideo {
  readonly format: string | null;
  readonly hookStyle: string | null;
  readonly durationSeconds: number | null;
  /** Its outlier score now; null when it has none yet. */
  readonly score: number | null;
}

export type PlanTableKind = 'format' | 'hook' | 'length';

export interface PlanTableRow {
  readonly kind: PlanTableKind;
  readonly label: string;
  readonly videos: number;
  /** How many of them have a score, and the median of those scores. */
  readonly scored: number;
  readonly medianScore: number | null;
}

/** The engine writes a hook style as "videoId: style"; the style is its name. */
const LEADING_VIDEO_ID = /^[\w-]{11}:\s*/;

/** A hook style's name, so the same style from two model videos counts once. */
export function hookStyleName(style: string | null): string {
  if (style === null) return NO_HOOK;
  const name = style.replace(LEADING_VIDEO_ID, '').trim();
  return name === '' ? NO_HOOK : name.charAt(0).toLowerCase() + name.slice(1);
}

const LABELS: readonly [PlanTableKind, (video: TableVideo) => string][] = [
  ['format', (video) => video.format ?? NO_FORMAT],
  ['hook', (video) => hookStyleName(video.hookStyle)],
  ['length', (video) => lengthBand(video.durationSeconds)],
];

function rowsOf(
  kind: PlanTableKind,
  label: (video: TableVideo) => string,
  videos: readonly TableVideo[],
) {
  const groups = new Map<string, TableVideo[]>();
  videos.forEach((video) => groups.set(label(video), [...(groups.get(label(video)) ?? []), video]));
  return [...groups.entries()]
    .map(([name, members]): PlanTableRow => {
      const scores = members.flatMap((member) => (member.score === null ? [] : [member.score]));
      return {
        kind,
        label: name,
        videos: members.length,
        scored: scores.length,
        medianScore: median(scores),
      };
    })
    .sort((a, b) => b.videos - a.videos || a.label.localeCompare(b.label));
}

export function planTable(videos: readonly TableVideo[]): readonly PlanTableRow[] {
  return LABELS.flatMap(([kind, label]) => rowsOf(kind, label, videos));
}
