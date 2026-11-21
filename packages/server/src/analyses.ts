/**
 * The questions the app can put to an AI engine with one press: what the
 * winning thumbnails do, which videos to make next, and which rejected
 * channels cover the same ground in other words.
 *
 * Each is a fixed question plus the tools it may use, and is one entry in
 * `ANALYSES`. The engine is asked to cite numbers the tools return, never to
 * produce its own: forecasts belong to code that can show its working, and
 * there is none yet. The tools only read: an analysis never changes the
 * owner's stored choices and never starts a crawl. The only thing taken from
 * the outside is the channel, and it goes into the question in a fixed form
 * after validation, never as the text that was typed.
 */
import { join } from 'node:path';
import {
  BREAKDOWN_PART_TITLES,
  BREAKDOWN_WRITTEN_PARTS,
  THUMBNAIL_PROMPT_MARKER,
  VIDEO_REF_RULE,
  markerLines,
  parseChannelRef,
  type BreakdownWrittenPart,
} from '@jgtube/core';
import {
  BREAKDOWN_ANALYSIS_IDS,
  BREAKDOWN_PART_SPECS,
  breakdownAnalysisId,
  partAnalysisTitle,
  type BreakdownAnalysisId,
} from './breakdownParts';
import {
  FRAME_STUDY_MAX_TURNS,
  FRAME_STUDY_TIMEOUT_MS,
  FRAME_STUDY_TOOLS,
  frameStudyQuestion,
} from './breakdownQuestions';
import { toolsOf } from './engines/failure';
import type { EngineId, EngineRunRequest, McpServerSpec } from './engines/types';
import { LAB_ANALYSIS_IDS, LAB_SPECS, type LabAnalysisId } from './labAnalyses';
import { breakdownFocusOf, type QuestionFocus } from './questionFocus';

/** The analyses answered in one press, while the page waits. */
export const QUICK_ANALYSIS_IDS = ['thumbnails', 'topics', 'near-misses'] as const;
export type QuickAnalysisId = (typeof QUICK_ANALYSIS_IDS)[number];
export type AnalysisId = QuickAnalysisId | BreakdownAnalysisId | LabAnalysisId;
/**
 * Every analysis. The seven parts of a channel breakdown are each one of
 * them, written in turn by a longer job and started only through it; the
 * idea lab's and the script writer's are started through their own routes.
 */
export const ANALYSIS_IDS: readonly AnalysisId[] = [
  ...QUICK_ANALYSIS_IDS,
  ...BREAKDOWN_ANALYSIS_IDS,
  ...LAB_ANALYSIS_IDS,
];

export interface AnalysisSpec {
  readonly title: string;
  /** One sentence for the screen, saying what pressing it gives. */
  readonly description: string;
  readonly allowedTools: readonly string[];
  readonly maxTurns: number;
  /** How long one run may take, when the usual limit is not enough. */
  readonly timeoutMs?: number;
  /** Who the engine is for this question, when it is not the usual analyst. */
  readonly systemPrompt?: string;
  /**
   * The question, for a channel already put into its fixed form. `focus` is
   * what else it is told, chosen or checked in code: the videos a breakdown
   * studies, or what an idea-lab question is about.
   */
  readonly question: (channel: string, focus?: QuestionFocus) => string;
  /**
   * The engines that may answer, when the analysis cannot be left to every
   * engine. They are tried in the owner's order, and an engine the owner's
   * settings leave out is still never used.
   */
  readonly engines?: readonly EngineId[];
}

export interface AnalysisSettings {
  /** The Jgtube folder, where the connector and its runner live. */
  readonly projectRoot: string;
  /** The store, as a full path: the connector starts in another folder. */
  readonly dbPath: string;
  /** An empty folder for the run to start in, so no project settings are picked up. */
  readonly workDir: string;
  /**
   * The downloads folder as a full path, when there is one: the connector
   * looks there for frames cut from a video file.
   */
  readonly downloadsPath?: string | undefined;
}

/** The connector's name as every engine knows it. */
export const SERVER_NAME = 'jgtube';
const tool = (name: string): string => `mcp__${SERVER_NAME}__${name}`;
/** Long enough for several tool calls and a considered answer; short enough to notice a hang. */
const TIMEOUT_MS = 5 * 60 * 1000;

/** One tool call is enough to prove an engine can reach the connector. */
const CHECK_TIMEOUT_MS = 2 * 60 * 1000;
const CHECK_MAX_TURNS = 4;

/** The engines known to see the pictures a tool returns; see the thumbnail review. */
export const PICTURE_ENGINES: readonly EngineId[] = ['claude', 'codex'];

const SYSTEM_PROMPT = [
  'You are an analyst working for the owner of a small faceless YouTube channel.',
  'Use only the Jgtube tools you are given; they hold what has been read about the channel and the channels around it.',
  'Say only what the tool results or the images support, and name the video or channel each point rests on.',
  'When a score carries a caution (few videos to compare, or a very low usual view count), say so instead of leaning on it.',
  'Write for a creator, not an engineer: short sentences, no jargon, no preamble.',
  'Answer in plain text. Put section titles in CAPITALS on their own line and start list items with "- ". Do not use markdown symbols such as #, * or backticks.',
].join(' ');

/** Who the engine is when it watches a video: there are no tools, only what is seen and heard. */
export const VIDEO_SYSTEM_PROMPT = [
  'You are an analyst working for the owner of a small faceless YouTube channel.',
  'Say only what you see and hear in the video, and give the time in the video for each point.',
  'If you could not watch the video itself, say so in the first line instead of guessing from its title or page.',
  'Write for a creator, not an engineer: short sentences, no jargon, no preamble.',
  'Answer in plain text. Put section titles in CAPITALS on their own line and start list items with "- ". Do not use markdown symbols such as #, * or backticks.',
].join(' ');

/**
 * How a question asks for a ready thumbnail prompt: between two fixed lines,
 * so code can lift it out as it stands, and with slots where a subject and
 * the words go. It names no country, flag or channel, so it serves any video.
 */
export function thumbnailPromptRule(lead: string): string {
  const { start, end } = markerLines(THUMBNAIL_PROMPT_MARKER);
  return [
    lead,
    `Put it between these two lines, each on a line of its own, written exactly so and used nowhere else in your answer: ${start} and ${end}.`,
    'The prompt must stand on its own for someone who has seen none of these thumbnails, and be detailed enough to paste into an image tool as it is, 150 to 300 words: the frame (16:9, 1280 by 720 pixels); the composition, saying what sits left, right, centre, in front and behind, and how much of the frame the subject fills; how the subject is shown; the background; the lighting; the colour palette, with each colour named; the overlay words: how many at most, how tall against the frame, the weight of the letters, their colour, their outline or box, and where they sit; the mood; and last a line of what must not appear.',
    'It has two slots, written exactly as [SUBJECT] and [OVERLAY TEXT]. It names no channel, no video, no video id, no real person, no logo, no country and no flag: where the thumbnails show a mark of one country, write “a national flag” and name neither the country nor its colours.',
  ].join(' ');
}

/** One of the idea lab's questions, with its tools under the names an engine knows them by. */
function lab(id: LabAnalysisId): AnalysisSpec {
  const { tools, pictures, ...spec } = LAB_SPECS[id];
  return {
    ...spec,
    allowedTools: tools.map(tool),
    ...(pictures ? { engines: PICTURE_ENGINES } : {}),
  };
}

const QUICK_ANALYSES: Readonly<Record<QuickAnalysisId, AnalysisSpec>> = {
  thumbnails: {
    title: 'Thumbnail review',
    description:
      'Looks at the thumbnails that took off on channels like yours, and at yours, names the styles that are winning and says what to test.',
    allowedTools: [tool('get_map'), tool('get_thumbnail_board'), tool('view_thumbnails')],
    maxTurns: 12,
    // The pictures reach the engine as tool results. Claude Code is known to see
    // them and Codex documents that it does; nothing says Antigravity passes a
    // tool's pictures on, and a review written without seeing them would be invented.
    engines: PICTURE_ENGINES,
    question: (channel) =>
      [
        `For the channel ${channel}: call get_map to learn which channel is the owner's model, if there is one, and which look-alikes match most closely. Then call get_thumbnail_board.`,
        "Look at the pictures with view_thumbnails, in at most three calls: the owner's own videos; two winners and two ordinary thumbnails from the model channel and from each of the three closest look-alikes; and winners from up to four other look-alike channels, choosing ones whose winners might look different.",
        "Find every thumbnail style that is winning on these channels. The owner is open to a new style when it wins on channels in the same niche or format, so do not assume that the owner's style or the model's is the right one.",
        "Write five sections: HOW MANY I LOOKED AT (the number of thumbnails and the channels they came from), WINNING STYLES (for each style: what it looks like, the channels and videos it is seen in, and whether those channels' ordinary thumbnails look different; when a channel's winners and ordinary thumbnails look the same, say that the topic, not the thumbnail, made the difference there), WHAT YOURS DO DIFFERENTLY, THREE THINGS TO TEST NEXT (specific: example wording of four words or fewer, what to show, colours, layout; at least one must be a style the owner does not use yet), and ONE THUMBNAIL TO MODEL (which video and why).",
        VIDEO_REF_RULE,
        "Write each style, each difference and each thing to test as a list item of its own, with the markers of the thumbnails it rests on at its end: the winners that show it, an ordinary thumbnail it is set against, and the owner's own where the point is about theirs. The id of each thumbnail is the one view_thumbnails names above its picture.",
        'Describe only what you can see, and do not generalise beyond the thumbnails you looked at. At most 450 words, the prompt not counted.',
        thumbnailPromptRule(
          'After the five sections, end with one ready prompt for an image tool: a thumbnail in the winning style you would have the owner test first, with the improvements for the owner built in.',
        ),
      ].join(' '),
  },
  topics: {
    title: 'Video ideas',
    description:
      'Reads the breakouts around your channel and proposes videos to make next, with the evidence for each.',
    allowedTools: [
      tool('get_map'),
      tool('get_breakouts'),
      tool('list_transfer_opportunities'),
      tool('get_channel_videos'),
    ],
    maxTurns: 14,
    question: (channel) =>
      [
        `For the channel ${channel}: call get_map, then get_breakouts for the look-alike channels, then list_transfer_opportunities for this channel. Call get_channel_videos on this channel to see what it has already made.`,
        "Every idea must belong to this channel's own niche: the subjects this channel and its look-alikes on this map make videos about. The store may hold other channels the owner has looked up, in other niches; nothing from them is an idea for this channel, so use only what these calls return for this channel and never carry a subject, a country or a title format over from anywhere else.",
        'Propose eight videos to make next, best first. Prefer subjects where a small channel got large views, and skip anything this channel has already made. If the tools support fewer than eight ideas in this niche, give fewer and say so.',
        "When list_transfer_opportunities returns ideas that are open or weak for the owner's place, at least three of the eight should come from them: an idea that took off for another place and has not been made, or did poorly, for the owner's. Where it lists a title for the owner's place that differs by one word, judge by meaning whether that is the same idea already made, and skip it if so.",
        `For each give: SOURCE (TRANSFER, naming where the idea worked and its views there, or BREAKOUT), TITLE (two options in the title format the owner and the look-alikes use), WHY (one or two breakout videos that prove demand, with channel, views and score, and any caution on that score; ${VIDEO_REF_RULE}), CROWDING (how many look-alike channels already covered the subject and how those versions did, or 'fresh'), PROOF AT YOUR SIZE (the smallest channel in the tool results that got large views on this subject, with its subscriber count and that video's views, or 'none yet' when only larger channels did), and THUMBNAIL (one line on what to show).`,
        'Every number you give must be one a tool returned. Do not estimate, forecast or predict views for the owner.',
        "Write each title yourself in the niche's format: never reuse a competitor's title word for word, or with only the country or one word changed. If the tool results do not show which real invention, product or event an idea is about, mark it NEEDS A REAL STORY and say what to look up before making it.",
        'At most 650 words.',
      ].join(' '),
  },
  'near-misses': {
    title: 'Same topic, different words',
    description:
      'Reads the titles of channels the filter rejected for their wording and says which really make your kind of video.',
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

/** One part of a channel breakdown as an analysis: its spec with the tools under their full names. */
function partAnalysis(part: BreakdownWrittenPart): AnalysisSpec {
  const spec = BREAKDOWN_PART_SPECS[part];
  return {
    title: partAnalysisTitle(part),
    description: `One part of a channel breakdown: ${BREAKDOWN_PART_TITLES[part].toLowerCase()}.`,
    allowedTools: spec.tools.map(tool),
    maxTurns: spec.maxTurns,
    timeoutMs: spec.timeoutMs,
    // Pictures reach an engine as a tool's results; see the thumbnail review.
    ...(spec.pictures ? { engines: PICTURE_ENGINES } : {}),
    question: (channel, focus) => spec.question(channel, breakdownFocusOf(focus)),
  };
}

export const ANALYSES: Readonly<Record<AnalysisId, AnalysisSpec>> = {
  ...QUICK_ANALYSES,
  ...(Object.fromEntries(
    BREAKDOWN_WRITTEN_PARTS.map((part) => [breakdownAnalysisId(part), partAnalysis(part)]),
  ) as Record<BreakdownAnalysisId, AnalysisSpec>),
  concepts: lab('concepts'),
  'concept-twist': lab('concept-twist'),
  'concept-more': lab('concept-more'),
  'where-else': lab('where-else'),
  'title-formulas': lab('title-formulas'),
  'hook-styles': lab('hook-styles'),
  'script-hooks': lab('script-hooks'),
  'script-draft': lab('script-draft'),
  'script-tighten': lab('script-tighten'),
  'concept-thumbnail': lab('concept-thumbnail'),
};

/** The channel as the question names it: a handle or an id, never free text. */
function fixedForm(channel: string): string {
  const ref = parseChannelRef(channel);
  return ref.kind === 'id' ? ref.id : `@${ref.handle}`;
}

/**
 * How an engine starts the connector on the owner's store. The connector is
 * told which tools the run may use and offers no others, so the limit holds
 * whatever the engine itself does with its own settings.
 */
function connectorServer(
  settings: AnalysisSettings,
  allowedTools: readonly string[],
): McpServerSpec {
  return {
    command: 'node',
    args: [
      join(settings.projectRoot, 'node_modules/tsx/dist/cli.mjs'),
      join(settings.projectRoot, 'packages/mcp/src/main.ts'),
    ],
    env: {
      JGTUBE_DB_PATH: settings.dbPath,
      JGTUBE_TOOLS: toolsOf(SERVER_NAME, allowedTools).join(','),
      ...(settings.downloadsPath === undefined
        ? {}
        : { JGTUBE_DOWNLOADS_PATH: settings.downloadsPath }),
    },
  };
}

function specOf(id: AnalysisId): AnalysisSpec {
  const spec = ANALYSES[id] as AnalysisSpec | undefined;
  if (!spec) throw new Error('There is no such analysis');
  return spec;
}

/** One analysis for one channel, as a boxed-in run of an engine with the connector. */
export function analysisRequest(
  id: AnalysisId,
  channel: string,
  settings: AnalysisSettings,
  focus?: QuestionFocus,
): EngineRunRequest {
  const spec = specOf(id);
  return {
    prompt: spec.question(fixedForm(channel), focus),
    systemPrompt: spec.systemPrompt ?? SYSTEM_PROMPT,
    mcpServers: { [SERVER_NAME]: connectorServer(settings, spec.allowedTools) },
    allowedTools: spec.allowedTools,
    maxTurns: spec.maxTurns,
    timeoutMs: spec.timeoutMs ?? TIMEOUT_MS,
    cwd: settings.workDir,
  };
}

/** What a frame study is called when it is named to the owner. */
export const FRAME_STUDY_TITLE = 'A frame study';

/**
 * A study of one video's frames, start to end, as a boxed-in run of an engine
 * with the one tool that shows them. The video is named by its id alone.
 */
export function frameStudyRequest(videoId: string, settings: AnalysisSettings): EngineRunRequest {
  const allowedTools = FRAME_STUDY_TOOLS.map(tool);
  return {
    prompt: frameStudyQuestion(videoId),
    systemPrompt: SYSTEM_PROMPT,
    mcpServers: { [SERVER_NAME]: connectorServer(settings, allowedTools) },
    allowedTools,
    maxTurns: FRAME_STUDY_MAX_TURNS,
    timeoutMs: FRAME_STUDY_TIMEOUT_MS,
    cwd: settings.workDir,
  };
}

/**
 * The engines to try for an analysis, in the owner's order: all of them, or
 * only those the analysis names when it cannot be left to every engine.
 */
export function enginesFor(id: AnalysisId, allowed: readonly EngineId[]): readonly EngineId[] {
  const { engines } = specOf(id);
  return engines ? allowed.filter((engine) => engines.includes(engine)) : allowed;
}

/**
 * A one-line question that needs one read-only tool: enough to prove on the
 * owner's computer that an engine starts, is signed in and can reach the
 * connector, at the cost of a few words of allowance.
 */
export function connectionCheck(settings: AnalysisSettings): EngineRunRequest {
  return {
    prompt:
      'Call the list_niches tool once. Then answer in one short line: how many channels did it list?',
    systemPrompt: 'You are checking that a tool works. Answer in one short line of plain text.',
    mcpServers: { [SERVER_NAME]: connectorServer(settings, [tool('list_niches')]) },
    allowedTools: [tool('list_niches')],
    maxTurns: CHECK_MAX_TURNS,
    timeoutMs: CHECK_TIMEOUT_MS,
    cwd: settings.workDir,
  };
}
