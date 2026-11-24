/**
 * The seven parts of a channel breakdown that an engine writes, as specs: the
 * fixed question, the read-only tools it may use, its limits, whether it
 * looks at pictures, and the earlier parts it reads. Each is one run of an
 * engine; `analyses.ts` turns each spec into an analysis.
 *
 * A later part never has an earlier part's text in its question. It reads it
 * as the result of `get_breakdown_part`, under a line saying it is a study.
 */
import {
  BREAKDOWN_PART_TITLES,
  BREAKDOWN_WRITTEN_PARTS,
  type BreakdownWrittenPart,
} from '@jgtube/core';
import {
  masterQuestion,
  pictureQuestion,
  planQuestion,
  scriptsQuestion,
  strategyQuestion,
  thumbnailsQuestion,
  titlesQuestion,
  type BreakdownFocus,
} from './breakdownPartQuestions';

import type { PictureFileSet, PictureNeed } from './pictureFiles';

export { NO_FOCUS, type BreakdownFocus } from './breakdownPartQuestions';

const MINUTE_MS = 60 * 1000;

export interface BreakdownPartSpec {
  /** The tools the run may use, by their bare names. All of them only read. */
  readonly tools: readonly string[];
  /**
   * The limits of one run, set from a real run (see "Limits of the runs" in
   * the system design). The time is five to eight times what the part took,
   * so a slow day or a slower engine still fits; the turns are at least twice
   * the tool calls its question asks for.
   */
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** Whether the run looks at pictures, and so needs an engine that sees a tool's pictures. */
  readonly pictures: boolean;
  /** The earlier parts it reads through `get_breakdown_part`. */
  readonly builtOn: readonly BreakdownWrittenPart[];
  readonly question: (channel: string, focus?: BreakdownFocus) => string;
  /**
   * For a part that looks at pictures: how it is asked of an engine shown
   * them as files (Antigravity): the tools then (the same, less the picture
   * tool), the pictures that tool would have shown, and the question.
   */
  readonly files?: PartFilesRoute;
}

export interface PartFilesRoute {
  readonly tools: readonly string[];
  readonly pictures: (focus: BreakdownFocus) => PictureNeed;
  readonly question: (channel: string, files: PictureFileSet, focus?: BreakdownFocus) => string;
}

const without = (tools: readonly string[], tool: string): readonly string[] =>
  tools.filter((name) => name !== tool);

const THUMBNAIL_TOOLS = [
  'get_channel_brand',
  'get_channel_videos',
  'view_thumbnails',
  'get_channel_measurements',
];
const PICTURE_TOOLS = [
  'get_frame_study',
  'get_video_watch',
  'get_channel_videos',
  'get_channel_measurements',
  'view_teardown_images',
];

export const BREAKDOWN_PART_SPECS: Readonly<Record<BreakdownWrittenPart, BreakdownPartSpec>> = {
  titles: {
    tools: ['get_channel_videos', 'get_video_details', 'get_channel_measurements'],
    // Measured: 113 seconds, about 2 tool calls.
    maxTurns: 12,
    timeoutMs: 10 * MINUTE_MS,
    pictures: false,
    builtOn: [],
    question: titlesQuestion,
  },
  thumbnails: {
    tools: THUMBNAIL_TOOLS,
    // Measured: 43 seconds, about 4 tool calls.
    maxTurns: 16,
    timeoutMs: 6 * MINUTE_MS,
    pictures: true,
    builtOn: [],
    question: thumbnailsQuestion,
    files: {
      tools: without(THUMBNAIL_TOOLS, 'view_thumbnails'),
      pictures: (focus) => ({
        kind: 'thumbnails',
        groups: [
          { label: 'top videos', videoIds: focus.top },
          { label: 'ordinary videos', videoIds: focus.ordinary },
        ],
      }),
      question: (channel, files, focus) => thumbnailsQuestion(channel, focus, files),
    },
  },
  scripts: {
    tools: [
      'get_transcript',
      'get_transcript_pace',
      'get_channel_videos',
      'get_channel_measurements',
    ],
    // Measured: 111 seconds, about 13 tool calls.
    maxTurns: 40,
    timeoutMs: 12 * MINUTE_MS,
    pictures: false,
    builtOn: [],
    question: scriptsQuestion,
  },
  picture: {
    tools: PICTURE_TOOLS,
    // Measured: 46 seconds, about 7 tool calls, before the measured layer added up to 7 more.
    maxTurns: 30,
    timeoutMs: 10 * MINUTE_MS,
    // It looks at the frame strips and keyframes measured in code.
    pictures: true,
    builtOn: [],
    question: pictureQuestion,
    files: {
      tools: without(PICTURE_TOOLS, 'view_teardown_images'),
      // The strips and keyframes of the videos measured in code: the deep ones and the ordinary ones.
      pictures: (focus) => ({ kind: 'teardown', videoIds: [...focus.deep, ...focus.ordinary] }),
      question: (channel, files, focus) => pictureQuestion(channel, focus, files),
    },
  },
  strategy: {
    tools: ['get_breakdown_part', 'get_channel_videos', 'get_channel_measurements'],
    // Measured: 57 seconds, about 6 tool calls.
    maxTurns: 20,
    timeoutMs: 6 * MINUTE_MS,
    pictures: false,
    builtOn: ['titles', 'thumbnails', 'scripts', 'picture'],
    question: strategyQuestion,
  },
  plan: {
    tools: [
      'get_breakdown_part',
      'get_transcript_pace',
      'get_frame_study',
      'get_video_watch',
      'get_channel_measurements',
    ],
    // Measured: 66 seconds, about 15 tool calls.
    maxTurns: 40,
    // Twelve minutes: it reads six parts and three studies of each deep video, then writes the longest answer.
    timeoutMs: 12 * MINUTE_MS,
    pictures: false,
    builtOn: ['titles', 'thumbnails', 'scripts', 'picture', 'strategy'],
    question: planQuestion,
  },
  master: {
    tools: ['get_breakdown_part', 'get_channel_measurements'],
    // Measured: 61 seconds, about 5 tool calls.
    maxTurns: 16,
    timeoutMs: 6 * MINUTE_MS,
    pictures: false,
    builtOn: ['titles', 'thumbnails', 'scripts', 'strategy'],
    question: masterQuestion,
  },
};

/** The earlier parts a part reads; none for the parts that study the channel itself. */
export const partsBuiltOn = (part: BreakdownWrittenPart): readonly BreakdownWrittenPart[] =>
  BREAKDOWN_PART_SPECS[part].builtOn;

/** What a part is called in the middle of a sentence. */
const PART_WORDS: Readonly<Record<BreakdownWrittenPart, string>> = {
  titles: 'the titles',
  thumbnails: 'the thumbnails',
  scripts: 'the scripts',
  picture: 'the picture and sound',
  strategy: 'the strengths, weaknesses and strategy',
  plan: 'the production plan',
  master: 'the master prompt',
};

/** The step shown while a part is written, in plain words. */
export function partProgress(part: BreakdownWrittenPart): string {
  const number = BREAKDOWN_WRITTEN_PARTS.indexOf(part) + 1;
  return `Writing part ${number} of ${BREAKDOWN_WRITTEN_PARTS.length}: ${PART_WORDS[part]}`;
}

/** The id each part is known by as an analysis. */
export type BreakdownAnalysisId = `breakdown-${BreakdownWrittenPart}`;
export const breakdownAnalysisId = (part: BreakdownWrittenPart): BreakdownAnalysisId =>
  `breakdown-${part}`;
export const BREAKDOWN_ANALYSIS_IDS = BREAKDOWN_WRITTEN_PARTS.map(breakdownAnalysisId);

/** What a part is called when it is named to the owner as work that could not be done. */
export const partAnalysisTitle = (part: BreakdownWrittenPart): string =>
  `The breakdown’s part on ${BREAKDOWN_PART_TITLES[part].toLowerCase()}`;
