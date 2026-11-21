/**
 * A concept's thumbnail prompt: asking an engine that sees pictures for a
 * detailed prompt in the style winning on the map, reading the answer
 * strictly, and storing it with the thumbnails it says it learned from. An id
 * that is not a stored video of this map is dropped and never shown.
 */
import {
  mapChannelIds,
  parseThumbnailPrompt,
  videosNamed,
  type ConceptRepo,
  type ConceptThumbnailRepo,
  type MapVideoDeps,
  type NamedVideo,
  type StoredConceptThumbnail,
} from '@jgtube/core';
import type { Engine } from './app';
import type { EngineId } from './engines/types';
import type { Report } from './labTypes';

/** A concept's thumbnail prompt as the page shows it. */
export interface ConceptThumbnailView {
  readonly conceptId: number;
  readonly prompt: string;
  readonly why: string;
  /** The stored videos of this map whose thumbnails it was learned from. */
  readonly learnedFrom: readonly NamedVideo[];
  readonly engine: string;
  /** When it was written, as an ISO-8601 string. */
  readonly writtenAt: string;
}

export interface ConceptThumbnailOutcome {
  readonly kind: 'concept-thumbnail';
  readonly thumbnail: ConceptThumbnailView;
  readonly engine: EngineId;
  readonly skipped: Awaited<ReturnType<Engine['analyse']>>['skipped'];
}

export interface ConceptThumbEngine {
  /** The thumbnail prompts of a channel's concepts; null when the channel has no map. */
  listConceptThumbnails(centerChannelId: string): readonly ConceptThumbnailView[] | null;
  /** Asks for, reads and stores one concept's thumbnail prompt, replacing an earlier one. */
  writeConceptThumbnail(
    centerChannelId: string,
    conceptId: number,
    only: EngineId | undefined,
    onProgress: Report,
  ): Promise<ConceptThumbnailOutcome>;
}

export interface ConceptThumbDeps {
  readonly now: () => Date;
  readonly repos: MapVideoDeps & {
    readonly concepts: Pick<ConceptRepo, 'find' | 'listForCenter'>;
    readonly conceptThumbnails: ConceptThumbnailRepo;
  };
  readonly analyse: Engine['analyse'];
}

const NO_SUCH_CONCEPT = 'That concept is not one of this channel’s concepts.';

export function conceptThumbEngine(deps: ConceptThumbDeps): ConceptThumbEngine {
  const { repos } = deps;
  const viewOf = (centerId: string, stored: StoredConceptThumbnail): ConceptThumbnailView => ({
    conceptId: stored.conceptId,
    prompt: stored.prompt,
    why: stored.why,
    learnedFrom: videosNamed(repos, centerId, stored.learnedFrom),
    engine: stored.engine,
    writtenAt: stored.writtenAt.toISOString(),
  });
  const find = (centerId: string, conceptId: number): ConceptThumbnailView | null => {
    const stored = repos.conceptThumbnails.find(centerId, conceptId);
    return stored ? viewOf(centerId, stored) : null;
  };
  return {
    listConceptThumbnails(centerChannelId) {
      if (mapChannelIds(repos.maps, centerChannelId) === null) return null;
      return repos.concepts
        .listForCenter(centerChannelId)
        .flatMap((concept) => find(centerChannelId, concept.id) ?? []);
    },

    async writeConceptThumbnail(centerChannelId, conceptId, only, onProgress) {
      if (repos.concepts.find(centerChannelId, conceptId) === null) {
        throw new Error(NO_SUCH_CONCEPT);
      }
      onProgress({
        step: 'asking',
        text: 'Asking the AI to look at the winning thumbnails and write this concept’s prompt',
      });
      const answer = await deps.analyse('concept-thumbnail', centerChannelId, only, {
        kind: 'concept',
        conceptId,
      });
      onProgress({ step: 'reading', text: 'Reading the prompt the AI wrote' });
      const parsed = parseThumbnailPrompt(answer.text);
      if ('problem' in parsed) {
        throw new Error(`The AI answered, but ${parsed.problem}. Nothing was changed. Try again.`);
      }
      const learnedFrom = videosNamed(repos, centerChannelId, parsed.learnedFrom).map(
        (video) => video.videoId,
      );
      repos.conceptThumbnails.save(
        conceptId,
        { prompt: parsed.prompt, why: parsed.why, learnedFrom, engine: answer.engine },
        deps.now(),
      );
      const thumbnail = find(centerChannelId, conceptId);
      if (thumbnail === null) throw new Error('The prompt could not be stored');
      return {
        kind: 'concept-thumbnail',
        thumbnail,
        engine: answer.engine,
        skipped: answer.skipped,
      };
    },
  };
}
