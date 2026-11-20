export { loadConfig, DEFAULT_DAILY_UNITS, DEFAULT_REGIONS, type Config } from './config';
export { backupPathFor, backupStore } from './db/backup';
export { migrate, openDatabase, transactionRunner, type Db } from './db/sqlite';
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
export { SqliteLeaseRepo } from './repos/sqliteLeaseRepo';
export { SqliteQuotaRepo } from './repos/sqliteQuotaRepo';
export type { DayUsage, LeaseRepo, QuotaRepo, SpendLimits, Transact } from './repos/types';
export {
  MIN_SUBSCRIBERS_FOR_ADS,
  SHORTS_RATE,
  estimateShortsEarnings,
  type EarningsEstimate,
  type RateRange,
} from './scoring/earnings';
export {
  SEARCH_COST_UNITS,
  YouTubeApiError,
  fetchChannels,
  fetchPlaylistVideoIds,
  fetchVideos,
  searchRecentVideos,
  type ChannelFacts,
  type DataApiOptions,
  type PlaylistOptions,
  type PlaylistVideoIds,
  type SearchHit,
  type SearchOptions,
  type Spend,
  type VideoFacts,
} from './youtube/dataApi';
export { parseIsoDuration } from './youtube/duration';
