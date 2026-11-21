/**
 * The per-video thumbnail review as the page shows it: the videos to pick
 * from, the counted comparison and the advice. Every number here was counted
 * by the server; this only words it.
 */

/** A video the owner can pick, as the server lists it. */
export interface PickableVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly score: number | null;
  readonly ageDays: number;
}

export interface PickableVideos {
  readonly own: readonly PickableVideo[];
  readonly map: readonly PickableVideo[];
  readonly reviewed: readonly string[];
}

export interface CompareThumb {
  readonly videoId: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly title: string;
  readonly score: number;
  readonly sameSubject: boolean;
  readonly pairedWith: string | null;
}

export interface CountRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly winners: number;
  readonly winnersTagged: number;
  readonly winnerShare: number;
  readonly channels: number;
  readonly ordinary: number;
  readonly ordinaryTagged: number;
  readonly ordinaryShare: number | null;
  readonly lift: number | null;
  readonly yours: boolean;
  readonly flag: 'branding' | 'topic' | null;
  readonly winning: boolean;
  readonly examples: readonly string[];
}

export interface ThumbReviewView {
  readonly target: PickableVideo & { readonly tags: { readonly description: string } | null };
  readonly winners: readonly CompareThumb[];
  readonly ordinary: readonly CompareThumb[];
  readonly rows: readonly CountRow[];
  readonly winnersTagged: number;
  readonly ordinaryTagged: number;
  readonly channels: number;
  readonly rejected: readonly { readonly videoId: string; readonly reason: string }[];
  readonly comparedAt: string;
  readonly answer: {
    readonly text: string;
    readonly prompt: string | null;
    readonly engine: string;
    readonly writtenAt: string;
  } | null;
}

/** How many flagged rows to show: enough to see why a common value is not advice. */
const FLAGGED_SHOWN = 4;

const percent = (share: number): string => `${Math.round(share * 100)}%`;

/** "×12.4", or a dash when a score cannot be judged yet. */
export const scoreText = (score: number | null): string =>
  score === null ? '–' : `×${score.toFixed(1)}`;

/** The attribute and its value as one readable phrase, such as "Face or person: large". */
export const valueText = (row: Pick<CountRow, 'label' | 'value'>): string =>
  `${row.label}: ${row.value}`;

/** Who shows it among the winners, such as "6 of 8 winners (75%) · 3 channels". */
export const winnersText = (row: CountRow): string =>
  `${row.winners} of ${row.winnersTagged} winners (${percent(row.winnerShare)}) · ${row.channels} ${
    row.channels === 1 ? 'channel' : 'channels'
  }`;

/** How it compares with ordinary videos, such as "2.5× as common as on ordinary videos". */
export function liftText(row: CountRow): string {
  if (row.ordinaryShare === null || row.lift === null) return 'no ordinary videos to compare';
  return `${row.lift}× as common as on ordinary videos (${percent(row.ordinaryShare)})`;
}

/** Why a common value is not advice. */
export const flagText = (flag: CountRow['flag']): string => {
  if (flag === 'branding') return 'One channel’s branding, not a winning style';
  if (flag === 'topic') return 'As common on ordinary videos: the topic, not the thumbnail';
  return '';
};

/** The rows the page shows: winning values first, then a few flagged ones. */
export function shownRows(view: ThumbReviewView): readonly CountRow[] {
  const winning = view.rows.filter((row) => row.winning);
  const flagged = view.rows.filter((row) => row.flag !== null && row.winners > 1);
  return [...winning, ...flagged.slice(0, FLAGGED_SHOWN)];
}

/** The winning values this thumbnail lacks. */
export const missingRows = (view: ThumbReviewView): readonly CountRow[] =>
  view.rows.filter((row) => row.winning && !row.yours);

/** One line saying what was compared. */
export function comparedLine(view: ThumbReviewView): string {
  const base = `Set against ${view.winnersTagged} winning thumbnails from ${view.channels} ${
    view.channels === 1 ? 'channel' : 'channels'
  }, each beside an ordinary video of the same channel (${view.ordinaryTagged} in all).`;
  const missed = view.rejected.length;
  return missed === 0
    ? base
    : `${base} ${missed} could not be looked at and ${missed === 1 ? 'is' : 'are'} not counted.`;
}

/** The videos to offer: the owner's first, then the map's, each video once. */
export function pickList(videos: PickableVideos | null): readonly PickableVideo[] {
  if (videos === null) return [];
  const seen = new Set(videos.own.map((video) => video.videoId));
  return [...videos.own, ...videos.map.filter((video) => !seen.has(video.videoId))];
}

const REVIEW_ANCHOR = 'thumbnail-review';
const REVIEW_HASH = /^#thumbnail-review-([\w-]{11})$/;

/** The address that opens the review of one video, as a link from anywhere in the app. */
export const reviewHref = (videoId: string): string => `#${REVIEW_ANCHOR}-${videoId}`;

/** The element id the review carries while a video is picked, so a link can scroll to it. */
export const reviewAnchor = (videoId: string | null): string =>
  videoId === null ? REVIEW_ANCHOR : `${REVIEW_ANCHOR}-${videoId}`;

/** The video an address asks to review; null when it asks for none. */
export const reviewVideoOf = (hash: string): string | null => REVIEW_HASH.exec(hash)?.[1] ?? null;

/** The video shown first: the last one reviewed, else the owner's newest. */
export function firstPick(videos: PickableVideos | null): string | null {
  if (videos === null) return null;
  return videos.reviewed[0] ?? videos.own[0]?.videoId ?? videos.map[0]?.videoId ?? null;
}
