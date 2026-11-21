import type { ConceptRepo, StoredConcept } from '../concepts/types';
import { buildVideoReport } from '../report';
import type { ChannelRepo, StoredVideo, VideoRepo } from '../repos/types';
import { ageRamp } from '../scoring/outlier';
import type { ScriptRepo } from '../script/types';
import { dateTooRough, viewsAtAge, type AgeViews } from './sameAge';
import type { VideoLinkRepo } from './store';
import { planTable, type PlanTableRow } from './table';

/**
 * The owner's own published videos against the concepts they came from, read
 * from the store only: each video's views and outlier score against the
 * channel's usual, how its concept's inspiration videos stood at the same age
 * where readings allow, and a count of formats, hook styles and lengths used.
 * Nothing here forecasts views or gives advice.
 */

const DAY_MS = 86_400_000;

export interface PlanDeps {
  readonly channels: Pick<ChannelRepo, 'findById'>;
  readonly videos: Pick<VideoRepo, 'listByChannel' | 'listSnapshots'> & {
    findById(videoId: string): StoredVideo | null;
  };
  readonly concepts: Pick<ConceptRepo, 'find' | 'findBatch' | 'listForCenter'>;
  readonly scripts: Pick<ScriptRepo, 'list'>;
  readonly links: VideoLinkRepo;
}

export type InspirationMatch =
  AgeViews | { readonly status: 'not-comparable'; readonly reason: 'not-stored' };

export interface InspirationAtAge {
  readonly videoId: string;
  /** Null when the video is not stored. */
  readonly title: string | null;
  readonly channelTitle: string | null;
  readonly match: InspirationMatch;
}

export interface LinkedVideo {
  readonly conceptId: number;
  readonly conceptTitle: string;
  readonly videoId: string;
  readonly videoTitle: string;
  readonly views: number;
  readonly ageDays: number;
  /** Outlier score: views against the channel's usual at this age; null when it cannot be scored. */
  readonly score: number | null;
  /** The views the channel's videos usually have at this age; null with no score. */
  readonly usualViews: number | null;
  readonly durationSeconds: number | null;
  readonly format: string | null;
  readonly hookStyle: string | null;
  readonly hasScript: boolean;
  readonly inspirations: readonly InspirationAtAge[];
}

export interface PlanView {
  readonly centerChannelId: string;
  readonly linked: readonly LinkedVideo[];
  readonly table: readonly PlanTableRow[];
  /** Kept concepts with no video linked yet. */
  readonly linkable: readonly {
    readonly conceptId: number;
    readonly title: string;
    readonly hasScript: boolean;
  }[];
}

export type LinkOutcome = 'linked' | 'video-taken' | 'no-concept' | 'not-stored' | 'other-channel';

const ageOf = (video: StoredVideo, now: Date): number =>
  Math.max(0, (now.getTime() - video.published.date.getTime()) / DAY_MS);

/**
 * Links a kept concept of the channel to a stored video of that same channel.
 * 'not-stored' asks the caller to read the channel once and try again.
 */
export function linkVideo(
  deps: PlanDeps,
  centerChannelId: string,
  conceptId: number,
  videoId: string,
  now: Date,
): { readonly status: LinkOutcome } {
  const concept = deps.concepts.find(centerChannelId, conceptId);
  if (!concept?.kept) return { status: 'no-concept' };
  const video = deps.videos.findById(videoId);
  if (!video) return { status: 'not-stored' };
  if (video.channelId !== centerChannelId) return { status: 'other-channel' };
  return { status: deps.links.link(centerChannelId, conceptId, videoId, now) };
}

function inspirationAt(
  deps: PlanDeps,
  videoId: string,
  own: StoredVideo,
  now: Date,
): InspirationAtAge {
  const video = deps.videos.findById(videoId);
  if (!video)
    return {
      videoId,
      title: null,
      channelTitle: null,
      match: { status: 'not-comparable', reason: 'not-stored' },
    };
  const age = ageOf(own, now);
  const match: InspirationMatch = dateTooRough(own.published.precision, age)
    ? { status: 'not-comparable', reason: 'date-too-rough' }
    : viewsAtAge(
        deps.videos.listSnapshots(videoId),
        video.published.date,
        video.published.precision,
        age,
      );
  return {
    videoId,
    title: video.title,
    channelTitle: deps.channels.findById(video.channelId)?.title ?? null,
    match,
  };
}

function linkedVideo(
  deps: PlanDeps,
  concept: StoredConcept,
  own: StoredVideo,
  context: {
    readonly now: Date;
    readonly scripted: ReadonlySet<number>;
    readonly rows: ReturnType<typeof buildVideoReport>;
  },
): LinkedVideo {
  const row = context.rows.find((entry) => entry.id === own.id);
  const age = ageOf(own, context.now);
  const batch = deps.concepts.findBatch(concept.centerChannelId, concept.batchId);
  return {
    conceptId: concept.id,
    conceptTitle: concept.title,
    videoId: own.id,
    videoTitle: own.title,
    views: own.views,
    ageDays: age,
    score: row?.score ?? null,
    usualViews: row?.baseline == null ? null : Math.round(row.baseline * ageRamp(age)),
    durationSeconds: own.durationSeconds,
    format: batch?.format?.template ?? null,
    hookStyle: concept.hookStyle,
    hasScript: context.scripted.has(concept.id),
    inspirations: (batch?.inspiration ?? []).map((id) => inspirationAt(deps, id, own, context.now)),
  };
}

export function loadPlan(deps: PlanDeps, centerChannelId: string, now: Date): PlanView {
  const scripted = new Set(deps.scripts.list(centerChannelId).map((script) => script.conceptId));
  const rows = buildVideoReport(deps.videos.listByChannel(centerChannelId), now);
  const links = deps.links.list(centerChannelId);
  const linked = links.flatMap((link): LinkedVideo[] => {
    const concept = deps.concepts.find(centerChannelId, link.conceptId);
    const own = deps.videos.findById(link.videoId);
    return concept && own ? [linkedVideo(deps, concept, own, { now, scripted, rows })] : [];
  });
  const linkedIds = new Set(links.map((link) => link.conceptId));
  return {
    centerChannelId,
    linked,
    table: planTable(linked),
    linkable: deps.concepts
      .listForCenter(centerChannelId)
      .filter((concept) => concept.kept && !linkedIds.has(concept.id))
      .map((concept) => ({
        conceptId: concept.id,
        title: concept.title,
        hasScript: scripted.has(concept.id),
      })),
  };
}
