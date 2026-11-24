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
import {
  DEPTH_RULE,
  MISSING_EVIDENCE,
  OWNER,
  PLAIN_TEXT_FORM,
  SPECIFICITY,
  TEXT_IN_EDITOR,
  TAGS_NOTE,
  THUMBNAIL_CRAFT,
  titleCraft,
  buildPrompt,
  bullets,
  numbered,
} from './promptParts';
import { EXTRA_ANALYSIS_IDS, extraAnalyses, type ExtrasAnalysisId } from './extrasAnalyses';
import type { EngineId, EngineRunRequest, McpServerSpec } from './engines/types';
import { LAB_ANALYSIS_IDS, LAB_SPECS, type LabAnalysisId } from './labAnalyses';
import { breakdownFocusOf, type QuestionFocus } from './questionFocus';
import {
  filesLook,
  type FilesRoute,
  type PictureFileSet,
  type PictureLook,
} from './thumbnailFiles';

/** The analyses answered in one press, while the page waits. */
export const QUICK_ANALYSIS_IDS = ['thumbnails', 'topics', 'near-misses'] as const;
export type QuickAnalysisId = (typeof QUICK_ANALYSIS_IDS)[number];
export type AnalysisId = QuickAnalysisId | BreakdownAnalysisId | LabAnalysisId | ExtrasAnalysisId;
/**
 * Every analysis. The seven parts of a channel breakdown are each one of
 * them, written in turn by a longer job and started only through it; the
 * idea lab's and the script writer's are started through their own routes.
 */
export const ANALYSIS_IDS: readonly AnalysisId[] = [
  ...QUICK_ANALYSIS_IDS,
  ...BREAKDOWN_ANALYSIS_IDS,
  ...LAB_ANALYSIS_IDS,
  ...EXTRA_ANALYSIS_IDS,
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
   * Whether it looks at pictures. Then the engines that see pictures answer:
   * Claude Code and Codex through a tool's results, Antigravity through the
   * files route below, unless its last picture check failed. They are tried
   * in the owner's order, and an engine the settings leave out is never used.
   */
  readonly pictures?: boolean;
  /**
   * The question for an engine shown the pictures as files in its folder
   * (`files.listing` names them), with the tools it may use then. Every
   * picture question has one.
   */
  readonly filesRoute?: FilesRoute;
  /**
   * The question is about something other than a channel (one video), so
   * no channel is put into it and none need be given.
   */
  readonly channelFree?: boolean;
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
export const tool = (name: string): string => `mcp__${SERVER_NAME}__${name}`;
/** Long enough for several tool calls and a considered answer; short enough to notice a hang. */
const TIMEOUT_MS = 5 * 60 * 1000;

/** One tool call is enough to prove an engine can reach the connector. */
const CHECK_TIMEOUT_MS = 2 * 60 * 1000;
const CHECK_MAX_TURNS = 4;

/** The engines that see the pictures a tool returns: Claude Code and Codex. */
export const TOOL_PICTURE_ENGINES: readonly EngineId[] = ['claude', 'codex'];
/**
 * The engines shown a question's pictures as files in their run folder,
 * named in the question with `@`: Antigravity, whose CLI passes on only the
 * text of a tool's results.
 */
export const FILE_PICTURE_ENGINES: readonly EngineId[] = ['agy'];
/** Every engine that sees pictures, by default: the picture check is an optional diagnostic. */
export const PICTURE_ENGINES: readonly EngineId[] = [
  ...TOOL_PICTURE_ENGINES,
  ...FILE_PICTURE_ENGINES,
];

/**
 * The engines that see pictures: all of them, less an engine shown pictures
 * as files whose last picture check failed (`failed`). A check never run
 * changes nothing.
 */
export const pictureEngines = (failed: readonly EngineId[]): readonly EngineId[] =>
  PICTURE_ENGINES.filter(
    (engine) => !(FILE_PICTURE_ENGINES.includes(engine) && failed.includes(engine)),
  );

/** Whether an engine is shown a question's pictures as files rather than as a tool's results. */
export const seesFiles = (engine: EngineId): boolean => FILE_PICTURE_ENGINES.includes(engine);

const SYSTEM_PROMPT = [
  'You are a YouTube strategist and video director working for the owner of a small faceless YouTube channel. You judge titles, thumbnails, hooks and scripts the way a director with a record of high-retention videos would, and you back every judgement with evidence.',
  'Use only the Jgtube tools you are given; they hold what has been read about the channel and the channels around it.',
  'Say only what the tool results or the images support, and name the video or channel each point rests on.',
  MISSING_EVIDENCE,
  'When a score carries a caution (few videos to compare, or a very low usual view count), say so instead of leaning on it.',
  DEPTH_RULE,
  'Write for a creator, not an engineer: short sentences, no jargon, no preamble.',
  PLAIN_TEXT_FORM,
  TAGS_NOTE,
].join('\n');

/** Who the engine is when it watches a video: there are no tools, only what is seen and heard. */
export const VIDEO_SYSTEM_PROMPT = [
  'You are a video director and editor working for the owner of a small faceless YouTube channel. You watch one video the way an editor studies a cut they must match: shot by shot, line by line, sound by sound.',
  'Say only what you see and hear in the video, and give the time in the video for each point.',
  'If you could not watch the video itself, say so in the first line instead of guessing from its title or page.',
  'Where you could not tell something (a voice that may be synthetic, a sound under the music, words too small to read), say that you could not tell. Never fill it in.',
  'Be exact: quote on-screen words and spoken lines as they are, count where you can count, and name each technique in plain words with the time it is used.',
  'Write for a creator, not an engineer: short sentences, no jargon, no preamble.',
  `When the question asks for JSON, answer with that JSON alone. Otherwise: ${PLAIN_TEXT_FORM}`,
  TAGS_NOTE,
].join('\n');

/** What a ready thumbnail prompt must set out, in the order an image tool reads it best. */
export const THUMBNAIL_PROMPT_CONTENTS = [
  'the frame (16:9, 1280 by 720 pixels)',
  'the composition, saying what sits left, right, centre, in front and behind, and how much of the frame the subject fills',
  'the one focal point the eye lands on first, and what was left out to keep it alone',
  'the background',
  'the lighting',
  'the colour palette, with each colour named, and where the strongest contrast sits',
] as const;

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
    `The prompt must stand on its own for someone who has seen none of these thumbnails, and be detailed enough to paste into an image tool as it is, 150 to 300 words: ${THUMBNAIL_PROMPT_CONTENTS.join('; ')}; how the subject is shown; the overlay words: how many at most, how tall against the frame, the weight of the letters, their colour, their outline or box, and where they sit; the mood; and last a line of what must not appear.`,
    'It must read at phone size: one subject, large, and letters tall enough to read on a small screen, with nothing that matters in the bottom-right corner, where YouTube sets the video’s length.',
    TEXT_IN_EDITOR,
    'It has two slots, written exactly as [SUBJECT] and [OVERLAY TEXT]. It names no channel, no video, no video id, no real person, no logo, no country and no flag: where the thumbnails show a mark of one country, write “a national flag” and name neither the country nor its colours.',
  ].join(' ');
}

const TOOL_LOOK: PictureLook = {
  look: "Look at the pictures with view_thumbnails, in at most three calls: the owner's own videos; two winners and two ordinary thumbnails from the model channel and from each of the three closest look-alikes; and winners from up to four other look-alike channels, choosing ones whose winners might look different.",
  ids: 'The id of each thumbnail is the one view_thumbnails names above its picture.',
};

/** The most words of a thumbnail review, its ready prompt not counted. */
const THUMBNAIL_REVIEW_WORDS = 700;

function thumbnailReviewQuestion(channel: string, { look, ids }: PictureLook): string {
  return buildPrompt({
    task: [
      `For the channel ${channel}: review its thumbnails against the thumbnails that took off on channels like it, name every thumbnail style that is winning there, and say exactly what the owner should test next.`,
    ],
    owner: [
      OWNER,
      'The owner briefs their next thumbnails from this review, so a style they cannot rebuild from your words is of no use to them.',
      "The owner is open to a new style when it wins on channels in the same niche or format, so do not assume that the owner's style or the model's is the right one.",
    ],
    gather: numbered([
      `Call get_map to learn which channel is the owner's model, if there is one, and which look-alikes match most closely.`,
      'Call get_thumbnail_board.',
      look,
    ]),
    craft: [
      'Judge every thumbnail as a director would, on what a viewer takes in at phone size in under a second:',
      ...bullets(THUMBNAIL_CRAFT),
      ...bullets([
        'A style is winning only when winners show it and the same channels’ ordinary thumbnails do not. When a channel’s winners and ordinary thumbnails look the same, the topic, not the thumbnail, made the difference there: say so.',
        'Describe a style so it can be rebuilt: the layout (what sits where, and how large), the colours by name, the overlay words (how many, how tall against the frame, their colour and outline), and the one device that makes it stand out.',
      ]),
    ],
    rules: bullets([
      'Describe only what you can see, and do not generalise beyond the thumbnails you looked at.',
      'A thumbnail that could not be loaded is named as not seen and never described.',
      VIDEO_REF_RULE,
      `Write each style, each difference and each thing to test as a list item of its own, with the markers of the thumbnails it rests on at its end: the winners that show it, an ordinary thumbnail it is set against, and the owner's own where the point is about theirs. ${ids}`,
      ...SPECIFICITY,
    ]),
    output_format: [
      'Write five sections, in this order:',
      'HOW MANY I LOOKED AT: the number of thumbnails and the channels they came from.',
      "WINNING STYLES: for each style, a short name, what it looks like in the terms above, the channels and videos it is seen in, and whether those channels' ordinary thumbnails look different.",
      'WHAT YOURS DO DIFFERENTLY: each difference between the owner’s thumbnails and the winners, most costly first, with the thumbnail of theirs that shows it.',
      'THREE THINGS TO TEST NEXT: each a full brief: example overlay wording of four words or fewer, what to show and how large, the colours by name and the layout; at least one must be a style the owner does not use yet.',
      'ONE THUMBNAIL TO MODEL: which video, and the two or three things about it to take.',
      `At most ${THUMBNAIL_REVIEW_WORDS} words, the prompt not counted.`,
      thumbnailPromptRule(
        'After the five sections, end with one ready prompt for an image tool: a thumbnail in the winning style you would have the owner test first, with the improvements for the owner built in.',
      ),
    ],
  });
}

/** One of the idea lab's questions, with its tools under the names an engine knows them by. */
function lab(id: LabAnalysisId): AnalysisSpec {
  const { tools, filesRoute, ...spec } = LAB_SPECS[id];
  return {
    ...spec,
    allowedTools: tools.map(tool),
    ...(filesRoute ? { filesRoute: { ...filesRoute, tools: filesRoute.tools.map(tool) } } : {}),
  };
}

/** How many videos "Video ideas" proposes, and the most words it may take to do so. */
const IDEAS_ASKED = 8;
const IDEAS_WORDS = 1000;
const NEAR_MISS_WORDS = 400;

function topicsQuestion(channel: string): string {
  return buildPrompt({
    task: [
      `For the channel ${channel}: propose ${IDEAS_ASKED} videos to make next, best first, each with the evidence that viewers want it.`,
    ],
    owner: [
      OWNER,
      'The owner picks their next videos from this list. An idea is worth their week only when the tools show demand for it and they can see how to package it.',
    ],
    gather: numbered([
      'Call get_map.',
      'Call get_breakouts for the look-alike channels.',
      'Call list_transfer_opportunities for this channel.',
      'Call get_channel_videos on this channel to see what it has already made.',
    ]),
    craft: [
      'Choose and rank the ideas as a director choosing what to greenlight:',
      ...bullets([
        'Demand first: prefer subjects where a small channel got large views, and where more than one channel did. One hit on one large channel is weak proof.',
        'Skip anything this channel has already made.',
        "When list_transfer_opportunities returns ideas that are open or weak for the owner's place, at least three of the ideas should come from them: an idea that took off for another place and has not been made, or did poorly, for the owner's. Where it lists a title for the owner's place that differs by one word, judge by meaning whether that is the same idea already made, and skip it if so.",
        'Each idea is one specific video, not a theme: a viewer could tell from the title what happens in it.',
      ]),
      'Each title must pass these:',
      ...bullets(titleCraft('marked NEEDS A REAL STORY to be checked unless a tool returned it')),
      ...bullets([
        'The two title options differ in how they pull (one may ask, the other state or contrast): two rewordings of one title are one option.',
        'The thumbnail line names the single thing shown and the overlay words, four or fewer, that add what the title does not say.',
      ]),
    ],
    rules: bullets([
      "Every idea must belong to this channel's own niche: the subjects this channel and its look-alikes on this map make videos about. The store may hold other channels the owner has looked up, in other niches; nothing from them is an idea for this channel, so use only what these calls return for this channel and never carry a subject, a country or a title format over from anywhere else.",
      'Every number you give must be one a tool returned. Do not estimate, forecast or predict views for the owner.',
      "Write each title yourself in the niche's format: never reuse a competitor's title word for word, or with only the country or one word changed.",
      'If the tool results do not show which real thing, person, product or event an idea is about, mark it NEEDS A REAL STORY and say what to look up before making it.',
      `If the tools support fewer than ${IDEAS_ASKED} ideas in this niche, give fewer and say so. A weak idea added to reach ${IDEAS_ASKED} costs the owner a video.`,
      VIDEO_REF_RULE,
    ]),
    output_format: [
      `Number the ideas 1 to ${IDEAS_ASKED}, best first. Under each number write these lines, each starting with its label:`,
      'SOURCE: TRANSFER, naming where the idea worked and its views there, or BREAKOUT.',
      'TITLE: two options in the title format the owner and the look-alikes use.',
      'WHY: one or two breakout videos that prove demand, with channel, views and score, and any caution on that score.',
      "CROWDING: how many look-alike channels already covered the subject and how those versions did, or 'fresh'.",
      "PROOF AT YOUR SIZE: the smallest channel in the tool results that got large views on this subject, with its subscriber count and that video's views, or 'none yet' when only larger channels did.",
      'THUMBNAIL: one line on what to show, and the overlay words.',
      'ANGLE: one line on what this video does that the versions already made did not.',
      `At most ${IDEAS_WORDS} words.`,
    ],
  });
}

function nearMissesQuestion(channel: string): string {
  return buildPrompt({
    task: [
      `For the channel ${channel}: read the channels the filter rejected for their wording, and judge which of them really make this channel's kind of video.`,
    ],
    owner: [
      OWNER,
      'The owner decides which of these channels to keep on their map. A channel kept wrongly skews every later comparison, so say UNSURE rather than guess.',
    ],
    gather: numbered(['Call get_map to see the look-alike channels.', 'Call get_near_misses.']),
    craft: bullets([
      'The near misses fit on size and pace but word their titles differently. Read their recent titles and judge, for each, whether it makes the same kind of video for the same viewers as the look-alikes.',
      'The same kind of video means the same promise to the same viewer: the same sort of subject, told in the same format. A shared word in a title is not enough, and different words for the same subject do not rule a channel out.',
    ]),
    rules: bullets([
      'Judge from the titles the tools return and nothing else: you have not seen these channels’ videos.',
      'Do not change anything; the owner decides.',
    ]),
    output_format: [
      'Write three sections:',
      'KEEP: channel name, then one line of reason quoting one of its titles.',
      'NOT THE SAME: grouped by what they really are, briefly.',
      'UNSURE: each channel with the one thing that would settle it.',
      `At most ${NEAR_MISS_WORDS} words.`,
    ],
  });
}

const QUICK_ANALYSES: Readonly<Record<QuickAnalysisId, AnalysisSpec>> = {
  thumbnails: {
    title: 'Thumbnail review',
    description:
      'Looks at the thumbnails that took off on channels like yours, and at yours, names the styles that are winning and says what to test.',
    allowedTools: [tool('get_map'), tool('get_thumbnail_board'), tool('view_thumbnails')],
    maxTurns: 12,
    // The pictures reach Claude Code and Codex as tool results, and Antigravity
    // as files: its CLI passes on only a tool's text. A review written without
    // seeing them would be invented.
    pictures: true,
    filesRoute: {
      tools: [tool('get_map'), tool('get_thumbnail_board')],
      question: (channel, files) => thumbnailReviewQuestion(channel, filesLook(files)),
    },
    question: (channel) => thumbnailReviewQuestion(channel, TOOL_LOOK),
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
    question: topicsQuestion,
  },
  'near-misses': {
    title: 'Same topic, different words',
    description:
      'Reads the titles of channels the filter rejected for their wording and says which really make your kind of video.',
    allowedTools: [tool('get_near_misses'), tool('get_map')],
    maxTurns: 8,
    question: nearMissesQuestion,
  },
};
/** One part of a channel breakdown as an analysis: its spec with the tools under their full names. */
function partAnalysis(part: BreakdownWrittenPart): AnalysisSpec {
  const spec = BREAKDOWN_PART_SPECS[part];
  const { files } = spec;
  return {
    title: partAnalysisTitle(part),
    description: `One part of a channel breakdown: ${BREAKDOWN_PART_TITLES[part].toLowerCase()}.`,
    allowedTools: spec.tools.map(tool),
    maxTurns: spec.maxTurns,
    timeoutMs: spec.timeoutMs,
    // Pictures reach an engine as a tool's results or as files; see the thumbnail review.
    ...(spec.pictures ? { pictures: true } : {}),
    ...(files
      ? {
          filesRoute: {
            tools: files.tools.map(tool),
            pictures: (focus) => files.pictures(breakdownFocusOf(focus)),
            question: (channel, set, focus) =>
              files.question(channel, set, breakdownFocusOf(focus)),
          },
        }
      : {}),
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
  'script-lengthen': lab('script-lengthen'),
  'concept-thumbnail': lab('concept-thumbnail'),
  ...extraAnalyses(tool),
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
export function connectorServer(
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
  /** The pictures as files, for an engine shown them that way; the question's files route is then used. */
  files?: PictureFileSet,
): EngineRunRequest {
  const spec = specOf(id);
  const route = files === undefined ? undefined : spec.filesRoute;
  if (files !== undefined && route === undefined) {
    throw new Error(`${spec.title} cannot be shown its pictures as files`);
  }
  const allowedTools = route?.tools ?? spec.allowedTools;
  const fixed = spec.channelFree ? '' : fixedForm(channel);
  return {
    prompt: route && files ? route.question(fixed, files, focus) : spec.question(fixed, focus),
    systemPrompt: spec.systemPrompt ?? SYSTEM_PROMPT,
    // A run with no tools starts no connector: it would have nothing to offer.
    mcpServers:
      allowedTools.length === 0 ? {} : { [SERVER_NAME]: connectorServer(settings, allowedTools) },
    allowedTools,
    maxTurns: spec.maxTurns,
    timeoutMs: spec.timeoutMs ?? TIMEOUT_MS,
    cwd: settings.workDir,
    ...(files ? { files: files.files } : {}),
  };
}

/** What a frame study is called when it is named to the owner. */
export const FRAME_STUDY_TITLE = 'A frame study';

/**
 * A study of one video's frames, start to end, as a boxed-in run of an engine
 * with the one tool that shows them, or, for an engine shown pictures as
 * files, with the sheets in its folder and no tool. The video is named by its id alone.
 */
export function frameStudyRequest(
  videoId: string,
  settings: AnalysisSettings,
  files?: PictureFileSet,
): EngineRunRequest {
  const allowedTools = files === undefined ? FRAME_STUDY_TOOLS.map(tool) : [];
  return {
    prompt: frameStudyQuestion(videoId, files),
    systemPrompt: SYSTEM_PROMPT,
    mcpServers:
      allowedTools.length === 0 ? {} : { [SERVER_NAME]: connectorServer(settings, allowedTools) },
    allowedTools,
    maxTurns: FRAME_STUDY_MAX_TURNS,
    timeoutMs: FRAME_STUDY_TIMEOUT_MS,
    cwd: settings.workDir,
    ...(files ? { files: files.files } : {}),
  };
}

/**
 * The engines to try for an analysis, in the owner's order: all of them, or,
 * for a picture question, those that see pictures: all, less an engine in
 * `failed` (its last picture check failed).
 */
export function enginesFor(
  id: AnalysisId,
  allowed: readonly EngineId[],
  failed: readonly EngineId[] = [],
): readonly EngineId[] {
  const seeing = picturesNeeded(id, failed);
  return seeing === null ? allowed : allowed.filter((engine) => seeing.includes(engine));
}

/** The engines a picture question may go to; null for a question without pictures. */
export function picturesNeeded(
  id: AnalysisId,
  failed: readonly EngineId[],
): readonly EngineId[] | null {
  return specOf(id).pictures ? pictureEngines(failed) : null;
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
