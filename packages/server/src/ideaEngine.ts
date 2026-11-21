/**
 * Packaging concepts for one channel: checking what the owner chose, asking
 * an engine, reading its answer strictly and storing what could be read.
 *
 * The rule for concepts that were not kept: a new batch replaces them. When a
 * batch is stored, every concept of that channel that was not kept, from any
 * earlier batch, is removed in the same step; a twist or a more-like-this
 * adds to its concept's batch and removes nothing; "Clear the ones not kept"
 * removes them on request. A batch whose run fails stores nothing and
 * removes nothing.
 */
import {
  CONCEPTS_PER_BATCH,
  MORE_CONCEPTS,
  NO_MAP,
  TWIST_CONCEPTS,
  batchNote,
  mapChannelIds,
  namedVideoIds,
  parseConcepts,
  pickedVideos,
  type ConceptFormat,
  type NewBatch,
  type PickedVideo,
  type StoredBatch,
  type StoredConcept,
} from '@jgtube/core';
import type { AnalysisId } from './analyses';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import { angleProblem } from './ideaQuestions';
import { storedChannel, type LabDeps } from './labDeps';
import type {
  ConceptOutcome,
  ConceptRequest,
  ConceptView,
  FormatChoice,
  LabEngine,
  Report,
} from './labTypes';
import type { QuestionFocus } from './questionFocus';

type IdeaParts = Pick<
  LabEngine,
  | 'listConcepts'
  | 'setConceptKept'
  | 'clearConcepts'
  | 'conceptProblem'
  | 'makeConcepts'
  | 'growConcept'
  | 'whereElse'
  | 'findIdeaBrief'
  | 'findConcept'
>;

const NOT_A_FORMAT = 'That title format is not one of this channel’s formats.';
const NO_SUCH_CONCEPT = 'That concept is not one of this channel’s concepts.';

/** The picked videos that are still stored, in the order picked. */
function stillStored(deps: LabDeps, videoIds: readonly string[]): readonly PickedVideo[] {
  return videoIds.flatMap((id) => {
    const video = deps.repos.videos.findById(id);
    if (!video) return [];
    const channelTitle = deps.repos.channels.findById(video.channelId)?.title ?? '';
    return [{ videoId: id, title: video.title, channelId: video.channelId, channelTitle }];
  });
}

/** The format the owner chose, checked to belong to this channel; a problem when it does not. */
function formatOf(
  deps: LabDeps,
  centerChannelId: string,
  choice: FormatChoice | null,
): ConceptFormat | null | { readonly problem: string } {
  if (choice === null) return null;
  if (choice.source === 'formula') {
    const formula = deps.repos.formulas.find(centerChannelId, choice.id);
    return formula
      ? { source: 'formula', ref: String(formula.id), template: formula.formula }
      : { problem: NOT_A_FORMAT };
  }
  const format = deps
    .listTransfers({ channel: centerChannelId })
    .formats.find((one) => one.key === choice.key);
  return format
    ? { source: 'transfer', ref: format.key, template: format.template }
    : { problem: NOT_A_FORMAT };
}

/** The batch a request asks for, with every part checked against the store, or why not. */
function batchOf(deps: LabDeps, request: ConceptRequest): NewBatch | { readonly problem: string } {
  const { centerChannelId, inspiration, hookModels, angle, length } = request;
  const picked = pickedVideos(deps.repos, centerChannelId, inspiration);
  if ('problem' in picked) return picked;
  if (hookModels.some((id) => !inspiration.includes(id))) {
    return { problem: 'A video whose opening is to be modelled must be one of the picked videos.' };
  }
  const wording = angle === null ? null : angleProblem(angle);
  if (wording) return { problem: wording };
  const format = formatOf(deps, centerChannelId, request.format);
  if (format !== null && 'problem' in format) return format;
  return { centerChannelId, inspiration, hookModels, format, angle, length };
}

function viewOf(deps: LabDeps, concept: StoredConcept, batch: StoredBatch): ConceptView {
  return {
    ...concept,
    length: batch.length,
    angle: batch.angle,
    formatTemplate: batch.format?.template ?? null,
    restsOnVideos: stillStored(deps, namedVideoIds(concept.restsOn, batch.inspiration)),
    pickedCount: batch.inspiration.length,
  };
}

/** One concept with its batch, as the page shows it and as a tool hands it over. */
export interface FoundConcept {
  readonly concept: StoredConcept;
  readonly batch: StoredBatch;
  readonly view: ConceptView;
  /** The videos picked for its batch that are still stored. */
  readonly picked: readonly PickedVideo[];
}

/** A concept through the channel it belongs to; null when it is not that channel's. */
export function findConceptOf(
  deps: LabDeps,
  centerChannelId: string,
  conceptId: number,
): FoundConcept | null {
  const concept = deps.repos.concepts.find(centerChannelId, conceptId);
  const batch = concept ? deps.repos.concepts.findBatch(centerChannelId, concept.batchId) : null;
  if (!concept || !batch) return null;
  return {
    concept,
    batch,
    view: viewOf(deps, concept, batch),
    picked: stillStored(deps, batch.inspiration),
  };
}

/** A channel's concepts as the page shows them, each with what its batch rested on. */
function viewsOf(deps: LabDeps, concepts: readonly StoredConcept[]): readonly ConceptView[] {
  const [first] = concepts;
  if (!first) return [];
  const batches = new Map(
    deps.repos.concepts.listBatches(first.centerChannelId).map((batch) => [batch.id, batch]),
  );
  return concepts.flatMap((concept) => {
    const batch = batches.get(concept.batchId);
    return batch ? [viewOf(deps, concept, batch)] : [];
  });
}

interface Asked {
  readonly analysis: AnalysisId;
  readonly focus: QuestionFocus;
  /** How many concepts the question asks for. */
  readonly count: number;
  readonly origin: StoredConcept['origin'];
  readonly parentId: number | null;
  /** Whether storing them replaces the channel's concepts that were not kept. */
  readonly replaceUnkept: boolean;
}

/** Asks, reads the answer strictly and stores what could be read into the batch. */
async function askAndStore(
  deps: LabDeps,
  batch: StoredBatch,
  asked: Asked,
  only: EngineId | undefined,
  report: Report,
): Promise<ConceptOutcome> {
  const answer: EngineAnswer<EngineId> = await deps.analyse(
    asked.analysis,
    batch.centerChannelId,
    only,
    asked.focus,
  );
  report({ step: 'reading', text: 'Reading the concepts the AI wrote' });
  const { concepts, unread, problems } = parseConcepts(answer.text, asked.count);
  if (concepts.length === 0) {
    throw new Error(
      unread > 0
        ? `The AI answered, but none of its ${unread} concepts could be read. For the first, ${problems[0]}. Nothing was changed. Try again.`
        : 'The AI answered, but not with concepts in the form asked for. Nothing was changed. Try again.',
    );
  }
  const stored = deps.repos.concepts.addConcepts(
    batch.id,
    concepts.map((concept) => ({
      ...concept,
      origin: asked.origin,
      parentId: asked.parentId,
      engine: answer.engine,
    })),
    deps.now(),
    { replaceUnkept: asked.replaceUnkept },
  );
  return {
    kind: 'concepts',
    batchId: batch.id,
    added: stored.map((concept) => viewOf(deps, concept, batch)),
    asked: asked.count,
    unread,
    note: batchNote(asked.count, stored.length, unread),
    engine: answer.engine,
    skipped: answer.skipped,
  };
}

/** A first batch: the batch is stored first, so the engine can read what the owner chose. */
async function makeBatch(
  deps: LabDeps,
  request: ConceptRequest,
  report: Report,
): Promise<ConceptOutcome> {
  const checked = batchOf(deps, request);
  if ('problem' in checked) throw new Error(checked.problem);
  const batchId = deps.repos.concepts.createBatch(checked, deps.now());
  const batch = deps.repos.concepts.findBatch(checked.centerChannelId, batchId);
  if (!batch) throw new Error('The batch could not be stored');
  const picked = checked.inspiration.length;
  report({
    step: 'asking',
    text: `Asking the AI for ${CONCEPTS_PER_BATCH} concepts from the ${picked} ${picked === 1 ? 'video' : 'videos'} you picked`,
  });
  const focus: QuestionFocus = {
    kind: 'concepts',
    batchId,
    inspiration: checked.inspiration,
    hookModels: checked.hookModels,
    hasFormat: checked.format !== null,
    angle: checked.angle,
    length: checked.length,
  };
  const asked: Asked = {
    analysis: 'concepts',
    focus,
    count: CONCEPTS_PER_BATCH,
    origin: 'batch',
    parentId: null,
    replaceUnkept: true,
  };
  try {
    return await askAndStore(deps, batch, asked, request.only, report);
  } catch (error) {
    // A run that stored nothing leaves no empty batch behind.
    deps.repos.concepts.removeBatchIfEmpty(batchId);
    throw error;
  }
}

/** The concepts side of the idea lab, on this engine's store and engines. */
export function ideaEngine(deps: LabDeps): IdeaParts {
  const { concepts } = deps.repos;
  /** A concept with its batch, through the channel it belongs to. */
  const withBatch = (centerChannelId: string, conceptId: number) => {
    const concept = concepts.find(centerChannelId, conceptId);
    const batch = concept ? concepts.findBatch(centerChannelId, concept.batchId) : null;
    return concept && batch ? { concept, batch } : null;
  };
  return {
    listConcepts(centerChannelId) {
      if (mapChannelIds(deps.repos.maps, centerChannelId) === null) return null;
      return { concepts: viewsOf(deps, concepts.listForCenter(centerChannelId)) };
    },

    setConceptKept: (centerChannelId, conceptId, kept) =>
      concepts.setKept(centerChannelId, conceptId, kept),

    clearConcepts: (centerChannelId) => concepts.clearUnkept(centerChannelId),

    conceptProblem(request) {
      const checked = batchOf(deps, request);
      return 'problem' in checked ? checked.problem : null;
    },

    makeConcepts: (request, onProgress) => makeBatch(deps, request, onProgress),

    async growConcept(kind, centerChannelId, conceptId, only, onProgress) {
      const found = withBatch(centerChannelId, conceptId);
      if (!found) throw new Error(NO_SUCH_CONCEPT);
      const twist = kind === 'twist';
      onProgress({
        step: 'asking',
        text: twist
          ? `Asking the AI for ${TWIST_CONCEPTS} other angles on this concept’s subject`
          : `Asking the AI for ${MORE_CONCEPTS} concepts on other subjects in the same vein`,
      });
      const asked: Asked = {
        analysis: twist ? 'concept-twist' : 'concept-more',
        focus: { kind: 'concept', conceptId },
        count: twist ? TWIST_CONCEPTS : MORE_CONCEPTS,
        origin: kind,
        parentId: conceptId,
        replaceUnkept: false,
      };
      return askAndStore(deps, found.batch, asked, only, onProgress);
    },

    async whereElse(centerChannelId, only, onProgress) {
      if (mapChannelIds(deps.repos.maps, centerChannelId) === null) throw new Error(NO_MAP);
      onProgress({
        step: 'asking',
        text: 'Asking the AI where else the formats and ideas on this map could be made',
      });
      const { text, engine, skipped } = await deps.analyse('where-else', centerChannelId, only);
      return { kind: 'answer', text, engine, skipped };
    },

    findIdeaBrief(channel, batchId) {
      const stored = storedChannel(deps, channel);
      const batch = stored ? concepts.findBatch(stored.id, batchId) : null;
      return batch ? { batch, picked: stillStored(deps, batch.inspiration) } : null;
    },

    findConcept(channel, conceptId) {
      const stored = storedChannel(deps, channel);
      const found = stored ? withBatch(stored.id, conceptId) : null;
      return found ? { ...found, picked: stillStored(deps, found.batch.inspiration) } : null;
    },
  };
}
