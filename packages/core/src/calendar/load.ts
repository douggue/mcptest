import { lookalikeHistories, type HistoryDeps } from '../changes/load';
import type { ConceptRepo } from '../concepts/types';
import type { VideoLinkRepo } from '../plan/store';
import { SCRIPT_STATUSES, type ScriptRepo, type ScriptStatus } from '../script/types';
import {
  buildWeeks,
  isPlannedDate,
  type CalendarItem,
  type CalendarWeeks,
  type ConceptStatus,
} from './calendar';
import { PACE_WINDOW_DAYS, winnersPace } from './pace';
import type { ScheduleEntry, ScheduleRepo } from './store';

/**
 * The upload calendar of one centre channel, from the store: its kept
 * concepts with their status and planned date, by week, and the pace of the
 * look-alikes that took off on its map to compare with.
 */

export type CalendarDeps = HistoryDeps & {
  readonly concepts: Pick<ConceptRepo, 'find' | 'listForCenter'>;
  readonly scripts: Pick<ScriptRepo, 'find' | 'list' | 'save'>;
  readonly links: Pick<VideoLinkRepo, 'list'>;
  readonly schedule: ScheduleRepo;
};

export interface CalendarView extends CalendarWeeks {
  readonly centerChannelId: string;
  /** The date the weeks are counted from, YYYY-MM-DD. */
  readonly today: string;
  readonly pace: {
    readonly channels: number;
    readonly medianPerWeek: number | null;
    /** The days the uploads a week are counted over. */
    readonly windowDays: number;
  };
}

/** A linked video makes it published; then the owner's status; then its script's; else an idea. */
function statusOf(
  linked: boolean,
  entry: ScheduleEntry | undefined,
  script: ScriptStatus | undefined,
): ConceptStatus {
  if (linked) return 'published';
  return entry?.status ?? script ?? 'idea';
}

export function loadCalendar(
  deps: CalendarDeps,
  centerChannelId: string,
  now: Date,
  today: string,
): CalendarView | null {
  const found = lookalikeHistories(deps, centerChannelId, now);
  if (!found) return null;
  const scripts = new Map(deps.scripts.list(centerChannelId).map((s) => [s.conceptId, s.status]));
  const links = new Map(deps.links.list(centerChannelId).map((l) => [l.conceptId, l.videoId]));
  const schedule = deps.schedule.list(centerChannelId);
  const items = deps.concepts
    .listForCenter(centerChannelId)
    .filter((concept) => concept.kept)
    .map((concept): CalendarItem => ({
      conceptId: concept.id,
      title: concept.title,
      status: statusOf(links.has(concept.id), schedule.get(concept.id), scripts.get(concept.id)),
      setStatus: schedule.get(concept.id)?.status ?? null,
      plannedDate: schedule.get(concept.id)?.plannedDate ?? null,
      hasScript: scripts.has(concept.id),
      linkedVideoId: links.get(concept.id) ?? null,
    }));
  const pace = winnersPace(found.histories, now);
  return {
    centerChannelId,
    today,
    pace: { ...pace, windowDays: PACE_WINDOW_DAYS },
    ...buildWeeks(items, today, pace.medianPerWeek),
  };
}

const isScriptStatus = (status: ConceptStatus): status is ScriptStatus =>
  SCRIPT_STATUSES.some((known) => known === status);

/**
 * Saves a kept concept's status and planned date. A concept with a script
 * keeps idea, drafting and ready on its script, so the script writer shows
 * the same; "published", and any status of a concept with no script, is kept
 * here. A null status leaves the status to the script or a linked video.
 */
export function saveSchedule(
  deps: CalendarDeps,
  centerChannelId: string,
  conceptId: number,
  entry: ScheduleEntry,
  now: Date,
): 'saved' | 'no-concept' | 'bad-date' {
  if (!deps.concepts.find(centerChannelId, conceptId)?.kept) return 'no-concept';
  if (entry.plannedDate !== null && !isPlannedDate(entry.plannedDate)) return 'bad-date';
  const scripted = deps.scripts.find(centerChannelId, conceptId) !== null;
  const { status, plannedDate } = entry;
  const scriptStatus = scripted && status !== null && isScriptStatus(status) ? status : null;
  if (scriptStatus !== null) {
    deps.scripts.save(centerChannelId, conceptId, { status: scriptStatus }, now);
  }
  const kept = scriptStatus === null ? status : null;
  deps.schedule.save(centerChannelId, conceptId, { status: kept, plannedDate }, now);
  return 'saved';
}
