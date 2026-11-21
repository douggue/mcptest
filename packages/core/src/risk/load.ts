import { lookalikeHistories, type HistoryDeps } from '../changes/load';
import type { ConceptRepo } from '../concepts/types';
import type { TranscriptRepo } from '../repos/types';
import { checkMarkers, type CheckMarker } from '../script/measure';
import type { ScriptRepo } from '../script/types';
import type { Packaging } from './claims';
import { scriptOverlaps, type Overlap, type StoredText } from './overlap';

/**
 * What a risk check rests on that code works out, for one kept concept with a
 * script: the text checked, its packaging, the sentences that share a long
 * run of words with a stored transcript of a look-alike on the map, and the
 * facts still marked to check. Nothing here is a verdict.
 */

export type RiskDeps = HistoryDeps & {
  readonly concepts: Pick<ConceptRepo, 'find' | 'listForCenter'>;
  readonly scripts: Pick<ScriptRepo, 'find' | 'list'>;
  readonly transcripts: Pick<TranscriptRepo, 'find'>;
};

export interface RiskFacts {
  readonly status: 'ready';
  readonly conceptId: number;
  readonly title: string;
  readonly packaging: Packaging;
  /** The tightened script when there is one, else the draft. */
  readonly stage: 'tightened' | 'draft';
  readonly script: string;
  readonly scriptUpdatedAt: Date;
  readonly overlaps: readonly Overlap[];
  /** The look-alikes' stored transcripts the script was compared with. */
  readonly transcriptsCompared: number;
  readonly unchecked: readonly CheckMarker[];
}

export type RiskLookup =
  RiskFacts | { readonly status: 'no-concept' } | { readonly status: 'no-script' };

/** The stored transcripts of the look-alikes' videos on the map, as plain text. */
function lookalikeTexts(
  deps: RiskDeps,
  histories: ReturnType<typeof lookalikeHistories>,
): readonly StoredText[] {
  return (histories?.histories ?? []).flatMap(({ videos }) =>
    videos.flatMap((video) => {
      const stored = deps.transcripts.find(video.id)?.transcript;
      return stored
        ? [{ videoId: video.id, text: stored.segments.map((segment) => segment.text).join(' ') }]
        : [];
    }),
  );
}

/** What code works out for a concept's script; null when the channel has no map. */
export function riskFacts(
  deps: RiskDeps,
  centerChannelId: string,
  conceptId: number,
  now: Date,
): RiskLookup | null {
  const found = lookalikeHistories(deps, centerChannelId, now);
  if (!found) return null;
  const concept = deps.concepts.find(centerChannelId, conceptId);
  if (!concept?.kept) return { status: 'no-concept' };
  const stored = deps.scripts.find(centerChannelId, conceptId);
  const stage = stored?.tightened.trim() ? 'tightened' : 'draft';
  const script = stored ? (stage === 'tightened' ? stored.tightened : stored.draft) : '';
  if (!stored || script.trim() === '') return { status: 'no-script' };
  const texts = lookalikeTexts(deps, found);
  return {
    status: 'ready',
    conceptId,
    title: concept.title,
    packaging: {
      title: concept.title,
      altTitles: concept.altTitles,
      thumbnail: concept.thumbnail,
      overlay: concept.overlay,
    },
    stage,
    script,
    scriptUpdatedAt: stored.updatedAt,
    overlaps: scriptOverlaps(script, texts),
    transcriptsCompared: texts.length,
    unchecked: checkMarkers(script),
  };
}

/** The channel's kept concepts that have a script, to choose one to check. */
export function scriptedConcepts(
  deps: Pick<RiskDeps, 'concepts' | 'scripts'>,
  centerChannelId: string,
): readonly { readonly conceptId: number; readonly title: string }[] {
  const scripted = new Set(deps.scripts.list(centerChannelId).map((script) => script.conceptId));
  return deps.concepts
    .listForCenter(centerChannelId)
    .filter((concept) => concept.kept && scripted.has(concept.id))
    .map((concept) => ({ conceptId: concept.id, title: concept.title }));
}
