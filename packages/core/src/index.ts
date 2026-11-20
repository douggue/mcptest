export { loadConfig, type Config } from './config';
export { openDatabase, type Db } from './db/sqlite';
export { backupPathFor, backupStore } from './db/backup';
export { ingestChannel, type IngestDeps, type IngestOptions, type IngestResult } from './ingest';
export { buildVideoReport, type VideoReportRow } from './report';
export { SqliteChannelRepo } from './repos/sqliteChannelRepo';
export { SqliteVideoRepo } from './repos/sqliteVideoRepo';
export type { ChannelRepo, StoredChannel, StoredVideo, VideoRepo } from './repos/types';
export { ageRamp, scoreVideos, type OutlierScore } from './scoring/outlier';
export { InnertubeSource } from './sources/innertube';
export { RateLimiter } from './sources/limiter';
export { parseChannelRef, VIDEO_ID_PATTERN } from './sources/parse';
export type { ChannelInfo, SidebarItem, VideoItem, YouTubeSource } from './sources/types';
export { crawlMap, type CrawlDeps, type CrawlOptions, type CrawlResult } from './crawl/crawl';
export { buildMapView, loadMapView, type MapRow, type Tier } from './map/view';
export { SqliteEdgeRepo } from './repos/sqliteEdgeRepo';
export { SqliteMapRepo } from './repos/sqliteMapRepo';
export { listBreakouts, type BreakoutVideo } from './map/breakouts';
export {
  loadMapSnapshot,
  type MapSnapshot,
  type SnapshotChannel,
  type SnapshotDeps,
  type SnapshotEdge,
} from './map/snapshot';
export { transactionRunner } from './db/sqlite';
export { loadMapView as loadStoredMapView } from './map/view';
export type { EdgeRepo, MapRepo, RecEdge } from './repos/types';
export type { CrawlProgress } from './crawl/crawl';
export type { OutsideReason } from './map/peers';
export type { SnapshotBreakout } from './map/snapshot';
export { freezeMapSnapshot } from './map/snapshot';
export type { ChannelSnapshot } from './sources/types';
export type { ScoreCaution } from './map/breakouts';
export type { SnapshotModel } from './map/snapshot';
export {
  buildThumbnailBoard,
  loadThumbnailBoard,
  type BoardCenter,
  type BoardChannel,
  type BoardVideo,
  type ScoredBoardVideo,
  type ThumbnailBoard,
} from './map/thumbnails';
export {
  buildNicheList,
  loadNicheList,
  type NicheChannel,
  type NicheDeps,
  type NicheLanguage,
  type NicheList,
  type NicheReason,
  type NicheSample,
} from './niches/niches';
export { SqliteWatchlistRepo } from './repos/sqliteWatchlistRepo';
export type { WatchlistRepo } from './repos/types';
export { COMPETITOR_STATUSES, type CompetitorStatus } from './map/choices';
export {
  RATE_TIER_MULTIPLIER,
  estimateEarnings,
  rateTierFor,
  type EarningsEstimate,
  type RateTier,
  type RateTierId,
} from './scoring/earnings';
export {
  fetchChannelFacts,
  searchRecentVideos,
  type ChannelFacts,
  type SearchHit,
} from './sources/dataApi';
export { discoverByKeyword, type DiscoveryResult } from './discovery/keyword';
export {
  buildSameTopicList,
  loadSameTopicList,
  type SameTopicChannel,
  type SameTopicKept,
  type SameTopicList,
  type SameTopicVideo,
} from './map/sameTopic';
export { viewsGained, type NicheGrowth } from './niches/growth';
export {
  loadRefreshStatus,
  refreshStalest,
  type RefreshDeps,
  type RefreshOptions,
  type RefreshProgress,
  type RefreshResult,
  type RefreshStatus,
} from './refresh/refresh';
export { SqliteRefreshRepo } from './repos/sqliteRefreshRepo';
export type { RefreshRun, RefreshRunRepo, VideoReading } from './repos/types';
export { fillNicheFacts, type FactsDeps, type FactsOutcome } from './niches/facts';
export { SqliteFactsRepo } from './repos/sqliteFactsRepo';
export type { FactsRepo, NewFacts, StoredFacts } from './repos/types';
export { NICHE_MIN_LATIN_SHARE, dominantScript, latinShare } from './niches/script';
export {
  READING_ELSEWHERE,
  ReadingElsewhereError,
  withYouTubeLease,
  type LeaseDeps,
} from './lease';
export { SqliteLeaseRepo } from './repos/sqliteLeaseRepo';
export {
  CRAWL_DEFAULT_DEPTH,
  CRAWL_DEFAULT_MAX_CHANNELS,
  CRAWL_MAX_CHANNELS_ASKED,
  CRAWL_MAX_DEPTH,
  CRAWL_MIN_CHANNELS_ASKED,
  PEER_DORMANT_AFTER_DAYS,
  REFRESH_DEFAULT_MAX_CHANNELS,
  REFRESH_MAX_CHANNELS,
  SMALL_CHANNEL_MAX_SUBSCRIBERS,
} from './limits';
export type { LeaseRepo } from './repos/types';
export {
  TRANSFER_WINDOW_DAYS,
  buildTransferList,
  findRecentIdea,
  loadTransferList,
  type TransferDeps,
  type TransferOptions,
} from './transfer/transfers';
export { findPlaces, placeForCountry, placeNamed, type Place } from './transfer/places';
export { PLACE_SLOT, NUMBER_SLOT, SUBJECT_SLOT } from './transfer/template';
export type {
  FormatSubject,
  OwnerPlace,
  PlaceResult,
  TransferFormat,
  TransferIdea,
  TransferList,
  TransferStatus,
  TransferVariant,
  TransferVerdict,
  TransferVersion,
  VersionPlace,
} from './transfer/types';
export { SqliteTransferRepo } from './repos/sqliteTransferRepo';
export type { SavedIdea, TransferRepo } from './repos/types';
