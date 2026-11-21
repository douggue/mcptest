/**
 * What the later features add to the library, in one place so that the main
 * index names them with a single line: what changed since the last look.
 */
export { hadReadingBy, videosAsOf } from './changes/asOf';
export {
  CHANGES_BREAKOUTS_SHOWN,
  CHANGES_FORMATS_SHOWN,
  CHANGES_FORMAT_MIN_BREAKOUTS,
  mapChanges,
  type BreakoutBefore,
  type ChannelHistory,
  type GroupChange,
  type GroupChanges,
  type MapChanges,
  type NewBreakout,
} from './changes/changes';
export { breakoutFormats, type BreakoutFormat, type TitledBreakout } from './changes/formats';
export {
  CHANGES_WEEK_DAYS,
  CHANGES_YESTERDAY_DAYS,
  SINCE_KINDS,
  loadChanges,
  resolveSince,
  type ChangesDeps,
  type ChangesFreshness,
  type ChangesView,
  type SinceKind,
} from './changes/load';
export {
  lookalikeChanges,
  type LookalikeChanges,
  type LookalikeRef,
  type NotComparable,
} from './changes/lookalikes';
export type { EarlierMap, LookRepo } from './changes/store';
export { SqliteLookRepo } from './repos/sqliteLookRepo';
export {
  ALERT_MAX_MIN_SCORE,
  ALERT_MIN_MIN_SCORE,
  DEFAULT_ALERT_MIN_SCORE,
  findAlerts,
  isValidMinScore,
  type AlertCriteria,
  type AlertFinding,
  type AlertKind,
} from './alerts/alerts';
export {
  checkDueAlerts,
  checkStoredAlerts,
  type AlertCheck,
  type AlertCheckDeps,
} from './alerts/check';
export type { AlertRepo, AlertRule, AlertSettings, StoredAlert } from './alerts/store';
export { lookalikeHistories, type HistoryDeps, type MapHistories } from './changes/load';
export { SqliteAlertRepo } from './repos/sqliteAlertRepo';
export {
  linkVideo,
  loadPlan,
  type InspirationAtAge,
  type InspirationMatch,
  type LinkOutcome,
  type LinkedVideo,
  type PlanDeps,
  type PlanView,
} from './plan/report';
export {
  SAME_AGE_MIN_DAYS,
  SAME_AGE_SHARE,
  dateTooRough,
  viewsAtAge,
  type AgeViews,
} from './plan/sameAge';
export type { VideoLink, VideoLinkRepo } from './plan/store';
export {
  PLAN_LENGTH_BANDS,
  lengthBand,
  planTable,
  type PlanTableKind,
  type PlanTableRow,
  type TableVideo,
} from './plan/table';
export { SqliteVideoLinkRepo } from './repos/sqliteVideoLinkRepo';
export {
  CALENDAR_MAX_WEEKS,
  CALENDAR_MIN_WEEKS,
  CONCEPT_STATUSES,
  buildWeeks,
  isPlannedDate,
  weekStart,
  type CalendarItem,
  type CalendarWeek,
  type CalendarWeeks,
  type ConceptStatus,
} from './calendar/calendar';
export { loadCalendar, saveSchedule, type CalendarDeps, type CalendarView } from './calendar/load';
export { PACE_WINDOW_DAYS, winnersPace, type WinnersPace } from './calendar/pace';
export type { ScheduleEntry, ScheduleRepo } from './calendar/store';
export { SqliteScheduleRepo } from './repos/sqliteScheduleRepo';
export {
  comparePacing,
  winnerVideos,
  type PacingComparison,
  type PacingInput,
} from './pacing/compare';
export { loadPacing, type PacingDeps, type PacingView } from './pacing/load';
export { spreadOf, type Spread } from './pacing/spread';
