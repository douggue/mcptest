/**
 * The idea lab's questions as analyses: each a fixed question, the read-only
 * tools it may use and its limits. None is offered on `POST /api/analyses`;
 * each is started through the lab's own routes, as a job.
 */
import {
  FORMULA_MAX_TURNS,
  FORMULA_TIMEOUT_MS,
  FORMULA_TOOLS,
  formulasQuestion,
} from './formulaQuestions';
import {
  HOOK_STYLE_MAX_TURNS,
  HOOK_STYLE_TIMEOUT_MS,
  HOOK_STYLE_TOOLS,
  hookStylesQuestion,
} from './hookQuestions';
import {
  CONCEPT_MAX_TURNS,
  CONCEPT_TIMEOUT_MS,
  CONCEPT_TOOLS,
  GROW_TOOLS,
  WHERE_ELSE_MAX_TURNS,
  WHERE_ELSE_TIMEOUT_MS,
  WHERE_ELSE_TOOLS,
  conceptsQuestion,
  moreQuestion,
  twistQuestion,
  whereElseQuestion,
} from './ideaQuestions';
import {
  CONCEPT_THUMBNAIL_MAX_TURNS,
  CONCEPT_THUMBNAIL_TIMEOUT_MS,
  CONCEPT_THUMBNAIL_FILE_TOOLS,
  CONCEPT_THUMBNAIL_TOOLS,
  conceptThumbnailFilesQuestion,
  conceptThumbnailQuestion,
} from './conceptThumbQuestion';
import type { FilesRoute } from './thumbnailFiles';
import { labFocusOf, type QuestionFocus } from './questionFocus';
import {
  SCRIPT_DRAFT_TOOLS,
  SCRIPT_HOOK_TOOLS,
  SCRIPT_LENGTHEN_TOOLS,
  SCRIPT_MAX_TURNS,
  SCRIPT_SYSTEM_PROMPT,
  SCRIPT_TIGHTEN_TOOLS,
  SCRIPT_TIMEOUT_MS,
  scriptDraftQuestion,
  scriptHooksQuestion,
  scriptLengthenQuestion,
  scriptTightenQuestion,
} from './scriptQuestions';

export const LAB_ANALYSIS_IDS = [
  'concepts',
  'concept-twist',
  'concept-more',
  'where-else',
  'title-formulas',
  'hook-styles',
  'script-hooks',
  'script-draft',
  'script-tighten',
  'script-lengthen',
  'concept-thumbnail',
] as const;
export type LabAnalysisId = (typeof LAB_ANALYSIS_IDS)[number];

export interface LabSpec {
  readonly title: string;
  readonly description: string;
  /** The tools it may use, by their bare names. */
  readonly tools: readonly string[];
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** Who the engine is for this question, when it is not the usual analyst. */
  readonly systemPrompt?: string;
  /** Whether it looks at pictures, and so may only be asked of an engine that sees them. */
  readonly pictures?: boolean;
  /** The question for an engine shown the pictures as files, with its tools by their bare names. */
  readonly filesRoute?: FilesRoute;
  readonly question: (channel: string, focus?: QuestionFocus) => string;
}

export const LAB_SPECS: Readonly<Record<LabAnalysisId, LabSpec>> = {
  concepts: {
    title: 'Packaging concepts',
    description:
      'Writes ten titles, each with two alternates, a thumbnail brief and an opening sentence, from videos picked on this map.',
    tools: CONCEPT_TOOLS,
    maxTurns: CONCEPT_MAX_TURNS,
    timeoutMs: CONCEPT_TIMEOUT_MS,
    question: (channel, focus) => conceptsQuestion(channel, labFocusOf(focus, 'concepts')),
  },
  'concept-twist': {
    title: 'Twist angle',
    description: 'Takes one concept’s subject and writes other angles on it.',
    tools: GROW_TOOLS,
    maxTurns: CONCEPT_MAX_TURNS,
    timeoutMs: CONCEPT_TIMEOUT_MS,
    question: (channel, focus) => twistQuestion(channel, labFocusOf(focus, 'concept')),
  },
  'concept-more': {
    title: 'More like this',
    description: 'Writes concepts on other subjects in the same vein as one concept.',
    tools: GROW_TOOLS,
    maxTurns: CONCEPT_MAX_TURNS,
    timeoutMs: CONCEPT_TIMEOUT_MS,
    question: (channel, focus) => moreQuestion(channel, labFocusOf(focus, 'concept')),
  },
  'where-else': {
    title: 'Where else this could work',
    description:
      'Suggests other languages and other categories the formats and ideas winning on this map could be made for, each with the search to check it.',
    tools: WHERE_ELSE_TOOLS,
    maxTurns: WHERE_ELSE_MAX_TURNS,
    timeoutMs: WHERE_ELSE_TIMEOUT_MS,
    question: (channel) => whereElseQuestion(channel),
  },
  'title-formulas': {
    title: 'Trending formats',
    description:
      'Groups the titles doing unusually well on this map into formulas with named slots.',
    tools: FORMULA_TOOLS,
    maxTurns: FORMULA_MAX_TURNS,
    timeoutMs: FORMULA_TIMEOUT_MS,
    question: (channel, focus) => formulasQuestion(channel, labFocusOf(focus, 'window')),
  },
  'hook-styles': {
    title: 'Hook styles',
    description: 'Names the way each opening in the hook library works.',
    tools: HOOK_STYLE_TOOLS,
    maxTurns: HOOK_STYLE_MAX_TURNS,
    timeoutMs: HOOK_STYLE_TIMEOUT_MS,
    question: (channel) => hookStylesQuestion(channel),
  },
  'script-hooks': {
    title: 'Hooks and beat sheet',
    description: 'Writes three hooks that open in different ways, and a beat sheet for the rest.',
    tools: SCRIPT_HOOK_TOOLS,
    maxTurns: SCRIPT_MAX_TURNS,
    timeoutMs: SCRIPT_TIMEOUT_MS,
    systemPrompt: SCRIPT_SYSTEM_PROMPT,
    question: (channel, focus) => scriptHooksQuestion(channel, labFocusOf(focus, 'script')),
  },
  'script-draft': {
    title: 'Script draft',
    description: 'Writes the full script for the chosen hook and beats, with picture cues.',
    tools: SCRIPT_DRAFT_TOOLS,
    maxTurns: SCRIPT_MAX_TURNS,
    timeoutMs: SCRIPT_TIMEOUT_MS,
    systemPrompt: SCRIPT_SYSTEM_PROMPT,
    question: (channel, focus) => scriptDraftQuestion(channel, labFocusOf(focus, 'script')),
  },
  'script-tighten': {
    title: 'Tighten pass',
    description: 'Makes the draft easier to say and to follow, without adding facts.',
    tools: SCRIPT_TIGHTEN_TOOLS,
    maxTurns: SCRIPT_MAX_TURNS,
    timeoutMs: SCRIPT_TIMEOUT_MS,
    systemPrompt: SCRIPT_SYSTEM_PROMPT,
    question: (channel, focus) => scriptTightenQuestion(channel, labFocusOf(focus, 'script')),
  },
  'script-lengthen': {
    title: 'Short sections again',
    description:
      'Writes again, at their full length, the sections of the draft that came out short of their share.',
    tools: SCRIPT_LENGTHEN_TOOLS,
    maxTurns: SCRIPT_MAX_TURNS,
    timeoutMs: SCRIPT_TIMEOUT_MS,
    systemPrompt: SCRIPT_SYSTEM_PROMPT,
    question: (channel, focus) => scriptLengthenQuestion(channel, labFocusOf(focus, 'script')),
  },
  'concept-thumbnail': {
    title: 'Thumbnail prompt',
    description:
      'Looks at the winning thumbnails on this map and writes a detailed prompt for one concept’s thumbnail in that style.',
    tools: CONCEPT_THUMBNAIL_TOOLS,
    maxTurns: CONCEPT_THUMBNAIL_MAX_TURNS,
    timeoutMs: CONCEPT_THUMBNAIL_TIMEOUT_MS,
    pictures: true,
    filesRoute: {
      tools: CONCEPT_THUMBNAIL_FILE_TOOLS,
      question: (channel, files, focus) =>
        conceptThumbnailFilesQuestion(channel, files, labFocusOf(focus, 'concept')),
    },
    question: (channel, focus) => conceptThumbnailQuestion(channel, labFocusOf(focus, 'concept')),
  },
};
