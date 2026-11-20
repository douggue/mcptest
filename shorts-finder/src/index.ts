export {
  ALERTS_PAUSED_UNTIL,
  ALERT_FAILURE_PAUSE_MS,
  DEFAULT_MAX_ALERTS_PER_DAY,
  MAX_SEND_ATTEMPTS,
  runAlertCycle,
  type AlertCycleReport,
  type AlertDeps,
  type AlertSettings,
  type NotSent,
} from './alerts/alertCycle';
export {
  DIGEST_SENT_FOR_DAY,
  HEARTBEAT_SENT_FOR_DAY,
  runDailyMessages,
  type DailyDeps,
  type DailyOutcome,
  type DailyReport,
  type ServiceStats,
} from './alerts/dailyMessages';
export {
  DIGEST_TOP,
  formatDigest,
  formatFinding,
  formatHeartbeat,
  type DigestInput,
  type FindingContext,
  type HeartbeatInput,
  type LastProblem,
} from './alerts/format';
export { isTimeZone, localMoment, startOfLocalDay, endOfLocalDay } from './alerts/localTime';
export {
  TELEGRAM_MAX_MESSAGE_LENGTH,
  TELEGRAM_TIMEOUT_MS,
  createSender,
  sendMessage,
  type MessageOptions,
  type Send,
  type SendResult,
  type TelegramOptions,
} from './alerts/telegram';
export { escapeHtml, truncateHtml } from './alerts/text';
export {
  ConfigError,
  DEFAULT_DAILY_UNITS,
  DEFAULT_REGIONS,
  loadConfig,
  loadStoreConfig,
  type Config,
  type StoreConfig,
  type TelegramSettings,
} from './config';
export { SHUTDOWN, abortReason, reasonOf, stopReasonFor, type StopReason } from './cycleStop';
export { backupPathFor, backupStore } from './db/backup';
export { migrate, openDatabase, transactionRunner, type Db } from './db/sqlite';
export {
  CHANNEL_REREAD_AFTER_MS,
  MAX_CHANNEL_READ_ATTEMPTS,
  readQueuedChannels,
  type ChannelReadsDeps,
  type ChannelReadsReport,
} from './discover/channelReads';
export {
  PENDING_HIT_MAX_AGE_MS,
  resolvePendingHits,
  type HitDetailsDeps,
  type HitDetailsReport,
} from './discover/hitDetails';
export {
  SEARCH_WINDOW_DAYS,
  runSearchCycle,
  type SearchCycleDeps,
  type SearchCycleReport,
  type SubjectFailure,
  type SubjectOutcome,
} from './discover/searchCycle';
export { NO_REASON, reasonFromText, reasonToText } from './findings/reason';
export {
  READING_ELSEWHERE,
  ReadingElsewhereError,
  withYouTubeLease,
  type LeaseDeps,
} from './lease';
export { createLogger, type LogFields, type Logger, type LoggerOptions } from './log';
export { QUOTA_KINDS, type QuotaKind } from './quota/kinds';
export {
  AllowanceSpentError,
  DEFAULT_PLAN,
  createQuotaLedger,
  createQuotaPlan,
  pacificDay,
  planFor,
  type QuotaLedger,
  type QuotaPlan,
  type Remaining,
} from './quota/ledger';
export { SqliteChannelRepo } from './repos/sqliteChannelRepo';
export { SqliteFindingRepo } from './repos/sqliteFindingRepo';
export { SqliteLeaseRepo } from './repos/sqliteLeaseRepo';
export { SqliteQuotaRepo } from './repos/sqliteQuotaRepo';
export { SqliteReadingRepo } from './repos/sqliteReadingRepo';
export { SqliteServiceStateRepo } from './repos/sqliteServiceStateRepo';
export { SqliteSubjectHitRepo, SqliteSubjectRepo } from './repos/sqliteSubjectRepo';
export { SqliteTrackingRepo } from './repos/sqliteTrackingRepo';
export { SqliteVideoRepo } from './repos/sqliteVideoRepo';
export { openStore } from './repos/store';
export type {
  ChannelReadRequest,
  ChannelRepo,
  DayUsage,
  Finding,
  FindingKind,
  FindingReason,
  FindingRepo,
  LeaseRepo,
  NewFinding,
  QuotaRepo,
  Reading,
  ReadingRepo,
  ServiceStateRepo,
  ShortAnswer,
  SpendLimits,
  Store,
  StoredChannel,
  StoredVideo,
  Subject,
  SubjectHitRepo,
  SubjectRepo,
  Tier,
  TrackedVideo,
  TrackingCounts,
  TrackingRepo,
  Transact,
  VideoRepo,
} from './repos/types';
export {
  LAST_READ_AT,
  LAST_ROLLUP_DAY,
  RATE_LIMIT_PAUSE_MS,
  READ_CYCLE_EVERY_MS,
  SCHEDULER_TICK_MS,
  startScheduler,
  type CycleName,
  type CycleRecord,
  type Scheduler,
  type SchedulerDeps,
  type SchedulerMemory,
} from './schedule/scheduler';
export { startService, type Service, type ServiceDeps } from './service';
export {
  CYCLE_NAMES,
  gatherStats,
  noteOutcome,
  problemIn,
  readLastProblem,
  readOutcome,
  storeBytes,
  type CycleOutcome,
  type StatsSources,
} from './status';
export {
  DEFAULT_SHORTS_RATE,
  SUBSCRIBER_THRESHOLD,
  estimateShortsEarnings,
  type EarningsEstimate,
  type RateRange,
} from './scoring/earnings';
export { SUBJECT_COST_UNITS, isDue, pickDueSubjects } from './subjects/due';
export {
  DEFAULT_EVERY_HOURS,
  MAX_EVERY_HOURS,
  MAX_KEYWORD_LENGTH,
  createSubject,
  expandAcrossRegions,
  type ExpandOptions,
  type NewSubject,
  type SubjectInput,
} from './subjects/subject';
export {
  MISSED_READS_BEFORE_GONE,
  MISS_MIN_GAP_MS,
  SUSPECT_EMPTY_BATCH_ABOVE,
  READ_BATCH_SIZE,
  runReadCycle,
  type ReadCycleDeps,
  type ReadCycleReport,
} from './track/readCycle';
export { KEEP_EVERY_READING_DAYS, rollUpOldReadings, type RollupReport } from './track/rollup';
export {
  HOURLY_READ_MS,
  HOURLY_UNTIL_MS,
  SIX_HOURLY_READ_MS,
  TRACKED_UNTIL_MS,
  planNextRead,
  type ReadPlan,
} from './track/tiers';
export {
  MIN_SPAN_MS,
  RATE_WINDOW_MS,
  STALE_AFTER_MS,
  velocity,
  viewsPerHour,
  type Velocity,
  type ViewReading,
} from './track/velocity';
export { createYouTubeApi, type SearchRequest, type YouTubeApi } from './youtube/api';
export {
  SEARCH_COST_UNITS,
  YouTubeApiError,
  fetchChannels,
  fetchPlaylistVideoIds,
  fetchVideos,
  searchRecentVideos,
  type ChannelFacts,
  type DataApiOptions,
  type ListResult,
  type PlaylistOptions,
  type PlaylistVideoIds,
  type SearchHit,
  type SearchOptions,
  type SearchResult,
  type Spend,
  type VideoFacts,
} from './youtube/dataApi';
export { parseIsoDuration } from './youtube/duration';
export { SHORTS_MAX_SECONDS, shortByLength } from './youtube/shorts';
