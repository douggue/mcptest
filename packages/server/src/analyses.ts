/**
 * The questions the app can put to Claude with one press: what the winning
 * thumbnails do, which videos to make next, and which rejected channels cover
 * the same ground in other words.
 *
 * Each is a fixed question plus the tools it may use. Claude is asked to cite
 * numbers the tools return, never to produce its own: forecasts belong to code
 * that can show its working, and there is none yet. The tools only read: an
 * analysis never changes the owner's stored choices and never starts a crawl.
 * The only thing taken from the outside is the channel, and it goes into the
 * question in a fixed form after validation, never as the text that was typed.
 */
import { join } from 'node:path';
import { parseChannelRef } from '@jgtube/core';
import type { ClaudeRunRequest } from './claudeRunner';

export const ANALYSIS_IDS = ['thumbnails', 'topics', 'near-misses'] as const;
export type AnalysisId = (typeof ANALYSIS_IDS)[number];

export interface AnalysisSpec {
  readonly title: string;
  /** One sentence for the screen, saying what pressing it gives. */
  readonly description: string;
  readonly allowedTools: readonly string[];
  readonly maxTurns: number;
  /** The question, for a channel already put into its fixed form. */
  readonly question: (channel: string) => string;
}

export interface AnalysisSettings {
  /** The Jgtube folder, where the connector and its runner live. */
  readonly projectRoot: string;
  /** The store, as a full path: the connector starts in another folder. */
  readonly dbPath: string;
  /** An empty folder for the run to start in, so no project settings are picked up. */
  readonly workDir: string;
}

const SERVER_NAME = 'jgtube';
const tool = (name: string): string => `mcp__${SERVER_NAME}__${name}`;
/** Long enough for several tool calls and a considered answer; short enough to notice a hang. */
const TIMEOUT_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = [
  'You are an analyst working for the owner of a small faceless YouTube channel.',
  'Use only the Jgtube tools you are given; they hold what has been read about the channel and the channels around it.',
  'Say only what the tool results or the images support, and name the video or channel each point rests on.',
  'When a score carries a caution (few videos to compare, or a very low usual view count), say so instead of leaning on it.',
  'Write for a creator, not an engineer: short sentences, no jargon, no preamble.',
  'Answer in plain text. Put section titles in CAPITALS on their own line and start list items with "- ". Do not use markdown symbols such as #, * or backticks.',
].join(' ');

export const ANALYSES: Readonly<Record<AnalysisId, AnalysisSpec>> = {
  thumbnails: {
    title: 'Thumbnail review',
    description:
      'Claude looks at the thumbnails that took off on channels like yours, and at yours, and says what to change.',
    allowedTools: [tool('get_thumbnail_board'), tool('view_thumbnails')],
    maxTurns: 10,
    question: (channel) =>
      [
        `For the channel ${channel}: call get_thumbnail_board.`,
        "Then look at the pictures with view_thumbnails: the owner's own videos, the strongest winner from each of the five look-alike channels that hit most often, and three ordinary thumbnails from those same channels for contrast. Use at most two calls.",
        'Write four sections: WHAT THE WINNERS DO (three to five points, each naming the video it is seen in), WHAT YOURS DO DIFFERENTLY, THREE CHANGES TO TRY NEXT (specific: example wording of four words or fewer, what to show, colours, layout), and ONE THUMBNAIL TO MODEL (which video and why).',
        'Describe only what you can see. At most 350 words.',
      ].join(' '),
  },
  topics: {
    title: 'Video ideas',
    description:
      'Claude reads the breakouts around your channel and proposes videos to make next, with the evidence for each.',
    allowedTools: [
      tool('get_map'),
      tool('get_breakouts'),
      tool('list_niches'),
      tool('get_channel_videos'),
    ],
    maxTurns: 12,
    question: (channel) =>
      [
        `For the channel ${channel}: call get_map, then get_breakouts for the look-alike channels, then list_niches. Call get_channel_videos on the owner's channel to see what they have already made.`,
        'Propose eight videos to make next, best first. Prefer subjects where a small channel got large views, and skip anything the owner has already made.',
        "For each give: TITLE (two options in the title format the owner and the look-alikes use), WHY (one or two breakout videos that prove demand, with channel, views and score, and any caution on that score), CROWDING (how many look-alike channels already covered the subject and how those versions did, or 'fresh'), PROOF AT YOUR SIZE (the smallest channel in the tool results that got large views on this subject, with its subscriber count and that video's views, or 'none yet' when only larger channels did), and THUMBNAIL (one line on what to show).",
        'Every number you give must be one a tool returned. Do not estimate, forecast or predict views for the owner.',
        'At most 650 words.',
      ].join(' '),
  },
  'near-misses': {
    title: 'Same topic, different words',
    description:
      'Claude reads the titles of channels the filter rejected for their wording and says which really make your kind of video.',
    allowedTools: [tool('get_near_misses'), tool('get_map')],
    maxTurns: 8,
    question: (channel) =>
      [
        `For the channel ${channel}: call get_map to see the look-alike channels, then get_near_misses.`,
        'The near misses fit on size and pace but word their titles differently. Read their recent titles and judge, for each, whether it makes the same kind of video for the same viewers as the look-alikes.',
        'Write three sections: KEEP (channel name, then one line of reason quoting one of its titles), NOT THE SAME (grouped by what they really are, briefly), and UNSURE.',
        'Do not change anything; the owner decides. At most 400 words.',
      ].join(' '),
  },
};

/** The channel as the question names it: a handle or an id, never free text. */
function fixedForm(channel: string): string {
  const ref = parseChannelRef(channel);
  return ref.kind === 'id' ? ref.id : `@${ref.handle}`;
}

/** One analysis for one channel, as a boxed-in run of Claude Code with the connector. */
export function analysisRequest(
  id: AnalysisId,
  channel: string,
  settings: AnalysisSettings,
): ClaudeRunRequest {
  const spec = ANALYSES[id] as AnalysisSpec | undefined;
  if (!spec) throw new Error('There is no such analysis');
  return {
    prompt: spec.question(fixedForm(channel)),
    systemPrompt: SYSTEM_PROMPT,
    mcpServers: {
      [SERVER_NAME]: {
        command: 'node',
        args: [
          join(settings.projectRoot, 'node_modules/tsx/dist/cli.mjs'),
          join(settings.projectRoot, 'packages/mcp/src/main.ts'),
        ],
        env: { JGTUBE_DB_PATH: settings.dbPath },
      },
    },
    allowedTools: spec.allowedTools,
    maxTurns: spec.maxTurns,
    timeoutMs: TIMEOUT_MS,
    cwd: settings.workDir,
  };
}
