/**
 * One video's page: its tabs, the line that says how far above its channel's
 * usual it is, and the numbers of its Summary: what is stored about it and,
 * once it has been taken apart, what was measured in its file.
 */
import type { BankVideo } from '@jgtube/core';
import { formatAge, formatCount, formatDuration, formatScore } from './format';
import { VIDEO_TABS, videoHref, type VideoTab } from './routes';
import { clock, type TeardownView } from './teardown';

export const VIDEO_TAB_LABELS: Readonly<Record<VideoTab, string>> = {
  summary: 'Summary',
  teardown: 'Teardown',
  thumbnail: 'Thumbnail',
  hook: 'Hook and script',
};

export interface PageTab {
  readonly key: string;
  readonly label: string;
  readonly href: string;
}

/** The tabs of a video's page, each at its own address. */
export const videoTabs = (videoId: string): readonly PageTab[] =>
  VIDEO_TABS.map((tab) => ({
    key: tab,
    label: VIDEO_TAB_LABELS[tab],
    href: videoHref(videoId, tab),
  }));

/** One number of a page: its label, the number as it reads, and what it rests on. */
export interface Fact {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  /** A breakout score: drawn in amber. */
  readonly score?: boolean;
}

/** The score beside the title, such as "269× its channel's usual"; null when the video has none. */
export const scoreLine = (video: Pick<BankVideo, 'score'>): string | null =>
  video.score === null ? null : `${formatScore(video.score)} its channel’s usual`;

/** Views and age under the title. */
export const viewsLine = (video: Pick<BankVideo, 'views' | 'ageDays'>): string =>
  `${formatCount(video.views)} views · ${formatAge(video.ageDays)} ago`;

/** What a score rests on, in one line: the usual it divides by and how many videos that came from. */
export function scoreBasis(
  video: Pick<BankVideo, 'score' | 'baseline' | 'sampleSize' | 'caution'>,
): string {
  if (video.score === null || video.baseline === null) {
    return 'Not scored: its channel has too few stored videos to compare against.';
  }
  const usual = formatCount(Math.round(video.baseline));
  const from = video.sampleSize ?? 0;
  const care = video.caution === null ? '' : ' Read it with care: the comparison rests on little.';
  return `Its views over its channel’s usual ${usual} views at the same age, from ${from} other video${from === 1 ? '' : 's'}.${care}`;
}

/** A minute or less is a Short; anything else is told in minutes. */
function lengthNote(video: Pick<BankVideo, 'durationSeconds' | 'isShort'>): string {
  if (video.durationSeconds === null) return 'Not read';
  if (video.isShort) return `${video.durationSeconds} seconds`;
  const minutes = Math.round(video.durationSeconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** What is stored about the video, as the Summary's first strip of numbers. */
export function storedFacts(video: BankVideo): readonly Fact[] {
  const usual = video.baseline === null ? null : formatCount(Math.round(video.baseline));
  return [
    {
      label: 'Score',
      value: video.score === null ? '—' : formatScore(video.score),
      note: usual === null ? 'Too few videos to compare' : `Usual: ${usual} views`,
      score: video.score !== null,
    },
    {
      label: 'Views',
      value: formatCount(video.views),
      note: `${formatCount(Math.round(video.viewsPerDay))} a day on average`,
    },
    {
      label: 'Uploaded',
      value: `${formatAge(video.ageDays)} ago`,
      note: 'Dated by YouTube',
    },
    {
      label: 'Length',
      value: video.isShort ? 'Short' : formatDuration(video.durationSeconds) || '—',
      note: lengthNote(video),
    },
  ];
}

/** How many colours of the measured palette the Summary shows. */
export const PALETTE_SHOWN = 5;

/** The main colours measured in the video's frames, most used first. */
export function paletteOf(teardown: TeardownView): readonly string[] {
  const items = teardown.measured?.palette.items ?? [];
  return [...items]
    .sort((a, b) => b.share - a.share)
    .slice(0, PALETTE_SHOWN)
    .map((item) => item.hex);
}

/** What was measured in the video's file, as the Summary's strip of numbers; none before it is measured. */
export function measuredFacts(teardown: TeardownView): readonly Fact[] {
  const measured = teardown.measured;
  if (measured === null) return [];
  const words = teardown.transcript.words;
  return [
    {
      label: 'Cuts',
      value: String(measured.shots.cutCount),
      note: `one every ${measured.shots.averageSeconds} s`,
    },
    {
      label: 'Words a minute',
      value: words === null ? '—' : String(words.wordsPerMinute),
      note: words === null ? 'No words were read' : `${formatCount(words.wordCount)} words in all`,
    },
    {
      label: 'Runtime',
      value: clock(measured.video.durationSeconds),
      note: 'measured from the file',
    },
  ];
}

/** One chapter of the video on its timeline. */
export interface TimelinePart {
  readonly title: string;
  readonly role: string;
  /** When it starts, as a clock time. */
  readonly at: string;
  /** Its share of the runtime, 0 to 1. */
  readonly share: number;
}

export interface Timeline {
  readonly parts: readonly TimelinePart[];
  /** The runtime as a clock time. */
  readonly end: string;
  /** Whether an AI named the chapters, or the video was cut evenly in code. */
  readonly named: boolean;
}

/** How the video is built: its chapters in order, each as wide as its share of the runtime. */
export function timelineOf(teardown: TeardownView): Timeline | null {
  const items = teardown.chapters.items;
  const last = items.at(-1);
  if (!last || last.end <= 0) return null;
  return {
    parts: items.map((row) => ({
      title: row.title,
      role: row.role,
      at: clock(row.start),
      share: Math.max(0, row.end - row.start) / last.end,
    })),
    end: clock(last.end),
    named: teardown.chapters.from === 'engine',
  };
}

/** The eight parts of a full teardown, as the page lists them. */
export const TEARDOWN_PARTS: readonly string[] = [
  'Metrics',
  'Visual system',
  'Component library',
  'The hook, frame by frame',
  'Structure',
  'Motion and transitions',
  'Sound',
  'How to replicate it',
];
