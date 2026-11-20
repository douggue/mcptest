export { loadConfig, type Config } from './config';
export { openDatabase, type Db } from './db/sqlite';
export { ingestChannel, type IngestDeps, type IngestOptions, type IngestResult } from './ingest';
export { buildVideoReport, type VideoReportRow } from './report';
export { SqliteChannelRepo } from './repos/sqliteChannelRepo';
export { SqliteVideoRepo } from './repos/sqliteVideoRepo';
export type { ChannelRepo, StoredChannel, StoredVideo, VideoRepo } from './repos/types';
export { ageRamp, scoreVideos, type OutlierScore } from './scoring/outlier';
export { InnertubeSource } from './sources/innertube';
export { RateLimiter } from './sources/limiter';
export { parseChannelRef } from './sources/parse';
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
  type NicheList,
  type NicheReason,
  type NicheSample,
} from './niches/niches';
export { SqliteWatchlistRepo } from './repos/sqliteWatchlistRepo';
export type { WatchlistRepo } from './repos/types';
export { COMPETITOR_STATUSES, type CompetitorStatus } from './map/choices';
export { estimateEarnings, type EarningsEstimate } from './scoring/earnings';
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
