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
export {
  MIX_TAKEN_OFF_PERCENT,
  TAKEN_OFF_MIN_VIDEOS,
  TAKEN_OFF_MIN_VIDEO_VIEWS,
  TAKEN_OFF_MIN_VIEWS_PER_SUBSCRIBER,
  TAKEN_OFF_MIN_WINDOW_VIEWS,
  TAKEN_OFF_WINDOW_DAYS,
  channelGroup,
  mixOrder,
  mixSplit,
  type ChannelGroup,
  type GroupEvidence,
  type MixSplit,
} from './map/mix';
export { SqliteEdgeRepo } from './repos/sqliteEdgeRepo';
export { SqliteMapRepo } from './repos/sqliteMapRepo';
export { listBreakouts, type BreakoutVideo } from './map/breakouts';
export {
  listSavedChannels,
  loadMapSnapshot,
  type MapSnapshot,
  type SavedChannel,
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
export {
  CHANNEL_IMAGE_HOSTS,
  CHANNEL_IMAGE_RULE,
  MAX_THUMBNAIL_BYTES,
  STORYBOARD_RULE,
  THUMBNAIL_RULE,
  VIDEO_IMAGE_HOST,
  fetchPinnedImage,
  fetchThumbnail,
  isPinnedImageUrl,
  thumbnailUrl,
  type FetchImage,
  type FetchedImage,
  type ImageRule,
} from './sources/images';
export { fetchVideoDetails, type ApiVideoDetails } from './sources/dataApi';
export { SqliteVideoPageRepo } from './repos/sqliteVideoPageRepo';
export { SqliteBrandRepo } from './repos/sqliteBrandRepo';
export type {
  BrandRepo,
  DetailsSource,
  StoredBrand,
  StoredStoryboard,
  StoredTranscript,
  StoredVideoDetails,
  TranscriptRepo,
  VideoDetailsRepo,
} from './repos/types';
export type {
  BrandImage,
  ChannelBrand,
  StoryboardLevel,
  TranscriptSegment,
  VideoDetails,
  VideoPage,
  VideoPageOptions,
  VideoTranscript,
} from './sources/types';
export { parseVideoRef } from './video/ref';
export {
  STORYBOARD_FRESH_HOURS,
  TRANSCRIPT_NONE_RETRY_HOURS,
  readStoryboard,
  readTranscript,
  readVideoDetails,
  type DetailsProblem,
  type DetailsResult,
  type StoryboardResult,
  type TranscriptResult,
  type VideoPageDeps,
} from './video/pages';
export {
  STORYBOARD_FRAME_WIDTH,
  chooseLevel,
  describeSheet,
  planSheets,
  type FrameSheet,
} from './video/storyboard';
export {
  readVideoFrames,
  type FrameDeps,
  type FrameSheetImage,
  type VideoFrames,
} from './video/frames';
export {
  TRANSCRIPT_STAMP_SECONDS,
  clock,
  formatTranscript,
  type TranscriptText,
  type TranscriptTextOptions,
} from './video/transcriptText';
export {
  COVER_VIEWED_MIN_WIDTH,
  LOGO_SHOWN_MIN_WIDTH,
  LOGO_VIEWED_MIN_WIDTH,
  pickImage,
  readChannelBrand,
  type BrandDeps,
  type BrandResult,
} from './channel/brand';
export { DOWNLOADS_FOLDER, downloadsRoot, pathInside } from './downloads/folder';
export {
  THUMBNAILS_FOLDER,
  THUMBNAIL_INDEX_FILE,
  saveChannelThumbnails,
  type SavedThumbnail,
  type ThumbnailDownload,
  type ThumbnailDownloadDeps,
  type ThumbnailDownloadOptions,
} from './downloads/thumbnails';
export { boardChannel } from './map/thumbnails';
export {
  MAX_VIDEO_BYTES,
  VIDEO_MIN_HEIGHT,
  VIDEO_TEMP_FOLDER,
  VIDEO_TEMP_MAX_AGE_HOURS,
  cleanVideoTemp,
  downloadVideoFile,
  removeVideoFile,
  videoTempFolder,
  type VideoDownload,
  type VideoDownloadDeps,
  type VideoFailure,
  type VideoFailureKind,
  type VideoFetcher,
  type VideoFile,
  type VideoRoute,
} from './downloads/videoFile';
export { downloadVideo, type DownloadVideoOptions } from './downloads/video';
export { builtInVideoFetcher, type VideoPlayerSource } from './downloads/builtInVideo';
export { YT_DLP_PROGRAM, findProgram, ytDlpFetcher, type RunProgram } from './downloads/ytDlp';
export { describeVideos, type StoredVideoLookup, type VideoFacts } from './video/facts';
export { brandLines, thumbnailLines, transcriptLines, videoLines } from './downloads/text';
