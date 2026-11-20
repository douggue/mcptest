export { loadConfig, DEFAULT_DAILY_UNITS, DEFAULT_REGIONS, type Config } from './config';
export { reasonOf, stopReasonFor, type StopReason } from './cycleStop';
export { backupPathFor, backupStore } from './db/backup';
export { migrate, openDatabase, transactionRunner, type Db } from './db/sqlite';
export {
  CHANNEL_REREAD_AFTER_MS,
  readQueuedChannels,
  type ChannelReadsDeps,
  type ChannelReadsReport,
} from './discover/channelReads';
export {
  SEARCH_WINDOW_DAYS,
  runSearchCycle,
  type SearchCycleDeps,
  type SearchCycleReport,
  type SubjectFailure,
  type SubjectOutcome,
} from './discover/searchCycle';
export {
  READING_ELSEWHERE,
  ReadingElsewhereError,
  withYouTubeLease,
  type LeaseDeps,
} from './lease';
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
export { SqliteLeaseRepo } from './repos/sqliteLeaseRepo';
export { SqliteQuotaRepo } from './repos/sqliteQuotaRepo';
export { SqliteReadingRepo } from './repos/sqliteReadingRepo';
export { SqliteSubjectHitRepo, SqliteSubjectRepo } from './repos/sqliteSubjectRepo';
export { SqliteTrackingRepo } from './repos/sqliteTrackingRepo';
export { SqliteVideoRepo } from './repos/sqliteVideoRepo';
export { openStore } from './repos/store';
export type {
  ChannelReadRequest,
  ChannelRepo,
  DayUsage,
  LeaseRepo,
  QuotaRepo,
  Reading,
  ReadingRepo,
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
  TrackingRepo,
  Transact,
  VideoRepo,
} from './repos/types';
export {
  RATE_LIMIT_PAUSE_MS,
  READ_CYCLE_EVERY_MS,
  SCHEDULER_TICK_MS,
  startScheduler,
  type CycleName,
  type CycleRecord,
  type Scheduler,
  type SchedulerDeps,
} from './schedule/scheduler';
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
  MISSED_READS_BEFORE_DROP,
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
