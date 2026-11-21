/**
 * The first part of a breakdown, worked out in code: what the breakdown
 * rests on. Which videos were chosen and by what rule, what the store holds
 * of each, and how each deep video was studied. Every number in it is one
 * Jgtube counted or worked out; no engine writes any of it.
 *
 * It is also how a later run tells whether anything has changed: the same
 * facts give the same text, word for word, so it says nothing that differs
 * from one run to the next without the facts differing (no dates, and no
 * reasons a download failed).
 */
import {
  BREAKDOWN_TITLES,
  clock,
  type BreakdownPicks,
  type BreakdownVideo,
  type FrameStudyNumbers,
} from '@jgtube/core';
import type { StudiedVideo, TopVideo } from './breakdownTypes';

const SECOND_MS = 1000;
const ONE_DECIMAL = 10;

/** The names a creator knows the engines by. */
export const ENGINE_NAMES: Readonly<Record<string, string>> = {
  agy: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  'gemini-api': 'The Gemini API',
};

const SOURCE_WORDS = {
  file: 'cut from the video file, one a second',
  preview:
    'YouTube’s own preview frames (small pictures several seconds apart, not every frame of the video)',
} as const;

export interface BasisInput {
  readonly channel: { readonly id: string; readonly title: string };
  readonly picks: BreakdownPicks;
  /** The top videos with what their captions come to. */
  readonly top: readonly TopVideo[];
  /** How each deep video was studied. */
  readonly deep: readonly StudiedVideo[];
  /** What code works out from a deep video's stored frame study; null when it has none. */
  frameNumbers(videoId: string): FrameStudyNumbers | null;
}

const count = (value: number): string => value.toLocaleString('en-US');
const nameOf = (engine: string): string => ENGINE_NAMES[engine] ?? engine;

function scoreOf(video: BreakdownVideo): string {
  return video.score === null
    ? 'too new or too alone to score'
    : `score ${Math.round(video.score * ONE_DECIMAL) / ONE_DECIMAL}`;
}

const named = (video: { readonly videoId: string; readonly title: string }): string =>
  `${video.videoId}, “${video.title}”`;

function captionsOf(video: TopVideo | undefined): string {
  if (video === undefined || video.captions === 'failed') return 'Captions: could not be read.';
  if (video.captions === 'none') return 'Captions: none.';
  const pace =
    video.wordsPerMinute === null ? '' : `, ${video.wordsPerMinute} words a minute (counted)`;
  return `Captions: ${count(video.words ?? 0)} words${pace}.`;
}

function titlesLine({ titles, storedVideos }: BreakdownPicks): string {
  const how =
    titles.length >= storedVideos
      ? `all ${storedVideos} stored`
      : `the ${BREAKDOWN_TITLES} most viewed and the ${titles.length - BREAKDOWN_TITLES} least viewed of the ${storedVideos} stored`;
  const few =
    titles.length < BREAKDOWN_TITLES
      ? ` That is fewer than the ${BREAKDOWN_TITLES} a title study wants.`
      : '';
  return `- ${titles.length} titles, most viewed first: ${how}.${few}`;
}

function topLine(video: BreakdownVideo, read: TopVideo | undefined): string {
  const length =
    video.durationSeconds === null
      ? ''
      : `, ${clock(video.durationSeconds * SECOND_MS)} long (${count(video.durationSeconds)} seconds)`;
  return `- ${named(video)}: ${count(video.views)} views, ${scoreOf(video)}${length}. ${captionsOf(read)}`;
}

function framesLine(video: StudiedVideo, numbers: FrameStudyNumbers | null): string {
  const { frames } = video;
  if (!frames.done) return '- Frames: NO FRAME STUDY.';
  const from = frames.source === null ? '' : `, ${SOURCE_WORDS[frames.source]}`;
  const many = frames.available === null ? 'Its frames' : `${count(frames.available)} frames`;
  const perFrame = numbers?.secondsPerFrame ?? null;
  const perChange = numbers?.secondsPerChange ?? null;
  const gap = perFrame === null ? '' : ` One frame every ${perFrame} seconds (worked out).`;
  const changes =
    perChange === null
      ? ' The study did not count its picture changes, so their pace is the study’s own estimate.'
      : ` ${count(numbers?.changesSeen ?? 0)} picture changes seen: one every ${perChange} seconds on average (worked out), so the picture changes at least this often.`;
  return `- Frames: ${many}${from}, studied by ${nameOf(frames.by)}.${gap}${changes}`;
}

const watchLine = ({ watch }: StudiedVideo): string =>
  watch.done
    ? `- Sound and editing: watched by ${nameOf(watch.by)}.`
    : '- Sound and editing: NOT WATCHED. The voice, music, sound effects and transitions are unknown.';

/** What the breakdown rests on, as plain text set out like the parts an engine writes. */
export function basisText(input: BasisInput): string {
  const { channel, picks, top, deep } = input;
  const read = (videoId: string): TopVideo | undefined =>
    top.find((video) => video.videoId === videoId);
  return [
    'THE CHANNEL',
    `- ${channel.title} (${channel.id}). Jgtube has ${picks.storedVideos} of its videos stored.`,
    '- Every number below was counted or worked out by Jgtube from what it has stored.',
    '',
    'TITLES STUDIED',
    titlesLine(picks),
    '',
    'TOP VIDEOS',
    `- The ${picks.top.length} videos furthest above the channel’s usual views, best first. The score is a video’s views as a multiple of the channel’s usual views at that age.`,
    ...picks.top.map((video) => topLine(video, read(video.videoId))),
    '',
    'ORDINARY VIDEOS SET BESIDE THEM',
    ...(picks.ordinary.length === 0
      ? ['- None: no video old enough to judge scores at or under the channel’s usual views.']
      : picks.ordinary.map(
          (video) => `- ${named(video)}: ${count(video.views)} views, ${scoreOf(video)}.`,
        )),
    '',
    'STUDIED IN DEPTH',
    ...deep.flatMap((video) => [
      `- ${named(video)}.`,
      framesLine(video, input.frameNumbers(video.videoId)),
      watchLine(video),
    ]),
  ].join('\n');
}
