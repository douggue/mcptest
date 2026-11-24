/**
 * Every question the app can put to an AI engine, built with fixed stand-in
 * values: a made-up channel id, made-up video ids and whole numbers. The
 * prompt tests read it: one snapshot per question, so a change of wording
 * shows up in review, and the structural checks every question must pass.
 *
 * Nothing here calls an engine. A question is only text.
 */
import {
  ANALYSIS_IDS,
  VIDEO_SYSTEM_PROMPT,
  analysisRequest,
  connectionCheck,
  frameStudyRequest,
  type AnalysisId,
  type AnalysisSettings,
} from '../src/analyses';
import { WATCH_QUESTION } from '../src/breakdownQuestions';
import { BIBLE_SYSTEM_PROMPT, bibleQuestion } from '../src/formatBibleQuestions';
import { MIX_SYSTEM_PROMPT, mixQuestion, toolLook, type MixAsk } from '../src/formatMixRequests';
import { DEEP_WATCH_QUESTION } from '../src/oneVideoQuestions';
import type { PictureFileSet } from '../src/pictureFiles';
import type { QuestionFocus } from '../src/questionFocus';
import { RESEARCH_SYSTEM_PROMPT, claimsQuestion, researchQuestion } from '../src/researchQuestions';
import {
  PICTURE_STAGES,
  TEARDOWN_SYSTEM_PROMPT,
  stageQuestion,
  watchQuestion,
  type JudgedStage,
} from '../src/teardownQuestions';

export const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_CHANNEL = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const V = (n: number): string => `video${String(n).padStart(6, '0')}`;

const settings: AnalysisSettings = {
  projectRoot: '/app/jgtube',
  dbPath: '/data/jgtube.db',
  workDir: '/tmp/jgtube-run',
};

const FILES: PictureFileSet = { files: [], listing: `@thumb-${V(1)}.jpg, @thumb-${V(2)}.jpg` };

const BREAKDOWN = {
  top: [V(1), V(2), V(3), V(4), V(5)],
  deep: [V(1), V(2), V(3)],
  titles: [V(1), V(2), V(3), V(4), V(5), V(6), V(7), V(8), V(9)],
  ordinary: [V(8), V(9)],
  storedVideos: 40,
};

const CONCEPTS = {
  kind: 'concepts',
  batchId: 7,
  inspiration: [V(1), V(2)],
  hookModels: [],
  hasFormat: false,
  angle: null,
  length: 'long',
} as const;

/** What each question is told besides the channel. */
const FOCUS: Partial<Record<AnalysisId, QuestionFocus>> = {
  'breakdown-titles': BREAKDOWN,
  'breakdown-thumbnails': BREAKDOWN,
  'breakdown-scripts': BREAKDOWN,
  'breakdown-picture': BREAKDOWN,
  'breakdown-strategy': BREAKDOWN,
  'breakdown-plan': BREAKDOWN,
  'breakdown-master': BREAKDOWN,
  concepts: CONCEPTS,
  'concept-twist': { kind: 'concept', conceptId: 42 },
  'concept-more': { kind: 'concept', conceptId: 42 },
  'title-formulas': { kind: 'window', windowDays: 90 },
  'script-hooks': { kind: 'script', conceptId: 42 },
  'script-draft': { kind: 'script', conceptId: 42 },
  'script-tighten': { kind: 'script', conceptId: 42 },
  'concept-thumbnail': { kind: 'concept', conceptId: 42 },
  'viewer-requests': { kind: 'comments', videoIds: [V(1), V(2)] },
  'risk-check': { kind: 'risk', conceptId: 42 },
  'thumbnail-tags': { kind: 'thumb-tags', videoIds: [V(1), V(2)] },
  'thumbnail-advice': { kind: 'thumb-advice', videoId: V(1) },
  'own-question': { kind: 'own-question', text: 'Which topic worked best?' },
  'one-video': { kind: 'one-video', videoId: V(1), watched: true, frames: true, captions: true },
  'one-video-file': {
    kind: 'one-video',
    videoId: V(1),
    watched: false,
    frames: true,
    captions: false,
  },
};

/** The same question asked another way: the owner's choices that change its wording. */
const VARIANTS: readonly {
  readonly name: string;
  readonly id: AnalysisId;
  focus: QuestionFocus;
}[] = [
  {
    name: 'concepts (shorts, an angle, a format, formulas, a hook model)',
    id: 'concepts',
    focus: {
      ...CONCEPTS,
      hookModels: [V(2)],
      hasFormat: true,
      angle: 'the owner’s one line',
      length: 'shorts',
      formulasFrom: OTHER_CHANNEL,
    },
  },
  {
    name: 'script-hooks (facts not marked)',
    id: 'script-hooks',
    focus: { kind: 'script', conceptId: 42, markFacts: false },
  },
  {
    name: 'script-draft (facts not marked)',
    id: 'script-draft',
    focus: { kind: 'script', conceptId: 42, markFacts: false },
  },
  {
    name: 'script-tighten (facts not marked)',
    id: 'script-tighten',
    focus: { kind: 'script', conceptId: 42, markFacts: false },
  },
];

export interface CatalogEntry {
  readonly name: string;
  readonly systemPrompt: string;
  readonly prompt: string;
  /** A one-line check that an engine works: it is not held to the structure of a real question. */
  readonly check?: boolean;
  /** The answer is one JSON value, checked in code. */
  readonly json?: boolean;
}

const MIX: MixAsk = {
  formatId: 3,
  formatName: 'My format',
  channel: CHANNEL,
  pictures: [{ name: 'i12-1.jpg', path: '/tmp/i12-1.jpg' }],
  thumbnails: [V(1)],
};

const TEARDOWN_STAGES: readonly JudgedStage[] = [
  'structure',
  'hook',
  'design',
  'archetypes',
  'motion',
  'techniques',
  'sound',
  'plan',
];

const JSON_ANALYSES: readonly AnalysisId[] = ['thumbnail-tags'];

function analysisEntries(): readonly CatalogEntry[] {
  const entry = (name: string, id: AnalysisId, focus: QuestionFocus | undefined, files?: true) => {
    const request = analysisRequest(id, CHANNEL, settings, focus, files ? FILES : undefined);
    return {
      name,
      systemPrompt: request.systemPrompt ?? '',
      prompt: request.prompt,
      ...(JSON_ANALYSES.includes(id) ? { json: true } : {}),
    };
  };
  const asked = ANALYSIS_IDS.flatMap((id) => {
    const tools = entry(id, id, FOCUS[id]);
    try {
      return [tools, entry(`${id} (pictures as files)`, id, FOCUS[id], true)];
    } catch {
      return [tools];
    }
  });
  return [...asked, ...VARIANTS.map(({ name, id, focus }) => entry(name, id, focus))];
}

/** Every question, by name. */
export function promptCatalog(): readonly CatalogEntry[] {
  const frames = frameStudyRequest(V(1), settings);
  const frameFiles = frameStudyRequest(V(1), settings, FILES);
  const check = connectionCheck(settings);
  return [
    ...analysisEntries(),
    { name: 'frame-study', systemPrompt: frames.systemPrompt ?? '', prompt: frames.prompt },
    {
      name: 'frame-study (pictures as files)',
      systemPrompt: frameFiles.systemPrompt ?? '',
      prompt: frameFiles.prompt,
    },
    { name: 'watch (breakdown)', systemPrompt: VIDEO_SYSTEM_PROMPT, prompt: WATCH_QUESTION },
    { name: 'watch (one video)', systemPrompt: VIDEO_SYSTEM_PROMPT, prompt: DEEP_WATCH_QUESTION },
    ...TEARDOWN_STAGES.map((stage) => ({
      name: `teardown-${stage}`,
      systemPrompt: TEARDOWN_SYSTEM_PROMPT,
      json: true,
      prompt: stageQuestion(stage, {
        videoId: V(1),
        look: PICTURE_STAGES.includes(stage) ? 'Look at the pictures of this stage.' : '',
        heard: true,
        chapterCount: 4,
      }),
    })),
    {
      name: 'teardown-watch',
      systemPrompt: VIDEO_SYSTEM_PROMPT,
      json: true,
      prompt: watchQuestion(
        [
          { start: 0, end: 30 },
          { start: 30, end: 240 },
        ],
        true,
      ),
    },
    {
      name: 'format-mix',
      systemPrompt: MIX_SYSTEM_PROMPT,
      json: true,
      prompt: mixQuestion(MIX, toolLook(MIX)),
    },
    {
      name: 'format-bible',
      systemPrompt: BIBLE_SYSTEM_PROMPT,
      json: true,
      prompt: bibleQuestion({ ...MIX, purpose: 'bible' }, toolLook(MIX)),
    },
    {
      name: 'research',
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      prompt: researchQuestion({
        title: 'A working title',
        needs: 'what must be looked up',
        angle: 'the owner’s one line',
      }),
    },
    {
      name: 'research-claims',
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      prompt: claimsQuestion([
        { sentence: 'A statement from a draft.', what: 'what its writer doubted' },
        { sentence: 'A second statement.', what: 'a second doubt' },
      ]),
    },
    {
      name: 'connection-check',
      check: true,
      systemPrompt: check.systemPrompt ?? '',
      prompt: check.prompt,
    },
  ];
}
