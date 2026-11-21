import type { BreakdownPartId } from '../breakdown/parts';
import type {
  ChannelBrand,
  ChannelInfo,
  StorableVideo,
  StoryboardLevel,
  VideoDetails,
  VideoTranscript,
} from '../sources/types';
import type { RecentVideo } from '../transfer/types';

export interface StoredChannel extends ChannelInfo {
  readonly fetchedAt: Date;
}

export interface StoredVideo extends StorableVideo {
  readonly fetchedAt: Date;
}

export interface ViewSnapshot {
  readonly capturedAt: Date;
  readonly views: number;
}

/** One video's view count at one reading of its channel. */
export interface VideoReading {
  readonly videoId: string;
  readonly capturedAt: Date;
  readonly views: number;
  /** When the video was published, so a new video can be told from one merely not read before. */
  readonly publishedAt: Date;
}

/** Runs a group of writes so that either all of them are stored or none is. */
export type Transact = (work: () => void) => void;

/** A stored channel whose latest reads all failed. */
export interface ReadFailure {
  readonly channelId: string;
  /** Failed reads in a row since the channel was last read. */
  readonly failures: number;
  readonly lastFailedAt: Date;
}

export interface ChannelRepo {
  findById(id: string): StoredChannel | null;
  findByHandle(handle: string): StoredChannel | null;
  /** Every stored channel, whichever crawl read it. */
  listAll(): readonly StoredChannel[];
  /** How many channels the store holds. */
  count(): number;
  /**
   * The channels with at most `maxSubscribers` (or a hidden count) that have a
   * video published at or after `publishedSince`, in the order of `listAll`.
   */
  listActiveUpTo(maxSubscribers: number, publishedSince: Date): readonly StoredChannel[];
  /** Storing a channel also forgets its failed reads: it has just been read. */
  upsert(channel: ChannelInfo, fetchedAt: Date): void;
  /** Notes that a stored channel could not be read; does nothing for one not in the store. */
  recordReadFailure(id: string, failedAt: Date): void;
  /** The stored channels that could not be read the last time it was tried. */
  listReadFailures(): readonly ReadFailure[];
}

export interface VideoRepo {
  listByChannel(channelId: string): readonly StoredVideo[];
  /** Stores the videos and records one view-count snapshot for each. */
  upsertMany(videos: readonly StorableVideo[], fetchedAt: Date): void;
  listSnapshots(videoId: string): readonly ViewSnapshot[];
  /** Every view reading of a channel's videos taken at or after `since`, oldest first. */
  listChannelReadings(channelId: string, since: Date): readonly VideoReading[];
}

/** One channel's videos were shown next to another's: `hits` of the `sampled` videos read. */
export interface RecEdge {
  readonly fromChannelId: string;
  readonly toChannelId: string;
  readonly hits: number;
  readonly sampled: number;
  readonly share: number;
}

export interface EdgeReading {
  readonly crawledAt: Date;
  /** Country the recommendations were read from. */
  readonly region: string;
  readonly edges: readonly RecEdge[];
}

export interface EdgeRepo {
  /** Null means this channel's recommendations were never read; an empty list means none were found. */
  listFrom(fromChannelId: string): EdgeReading | null;
  replaceFrom(
    fromChannelId: string,
    edges: readonly RecEdge[],
    region: string,
    crawledAt: Date,
  ): void;
  /** Every stored edge whose two ends are both in the given set. */
  listAmong(channelIds: readonly string[]): readonly RecEdge[];
}

export interface MapMember {
  readonly channelId: string;
  /** Recommendation hops from the centre; the centre itself is 0. */
  readonly steps: number;
}

export interface NewMap {
  readonly centerChannelId: string;
  /** The channel the owner wants to be like; "like yours" is measured against it. */
  readonly modelChannelId?: string | null;
  readonly depth: number;
  readonly region: string;
  readonly members: readonly MapMember[];
}

export interface StoredMap extends NewMap {
  readonly id: number;
  readonly modelChannelId: string | null;
  readonly createdAt: Date;
}

export interface MapRepo {
  create(map: NewMap, createdAt: Date): number;
  latestForCenter(centerChannelId: string): StoredMap | null;
  /** Each channel a map has been made around. */
  listCenterIds(): readonly string[];
  /**
   * Deletes every map made around a channel, with the owner's keep and remove
   * choices for it. The channels and videos that were read stay in the store.
   * Returns how many maps were deleted.
   */
  deleteForCenter(centerChannelId: string): number;
  /** Stores the map as it looked when it was made, as JSON. */
  saveSnapshot(mapId: number, snapshotJson: string): void;
  findSnapshot(mapId: number): string | null;
  /** Channels the owner removed from this centre's competitors; survives new crawls. */
  listRemoved(centerChannelId: string): readonly string[];
  /** Removing a channel also stops keeping it: the two choices exclude each other. */
  setRemoved(centerChannelId: string, channelId: string, removed: boolean, at: Date): void;
  /** Channels the owner counts as competitors whatever the filter says; survives new crawls. */
  listKept(centerChannelId: string): readonly string[];
  /** Keeping a channel also restores it if it was removed. */
  setKept(centerChannelId: string, channelId: string, kept: boolean, at: Date): void;
}

/** The channels the owner marked as niches to watch; not tied to any one map. */
export interface WatchlistRepo {
  listWatched(): readonly string[];
  /** The channel must be in the store. */
  setWatched(channelId: string, watched: boolean, at: Date): void;
}

/** An idea the owner saved as a transfer opportunity. */
export interface SavedIdea {
  /** The words of the idea's title template; see `Idea.key`. */
  readonly key: string;
  /** The template as it read when it was saved, to show once its videos are too old to list. */
  readonly template: string;
  readonly savedAt: Date;
}

/** What the transfer list reads from the store, and the ideas the owner saved. */
export interface TransferRepo {
  /**
   * Every stored video published at or after `since`, whichever channel it is
   * from, with its channel's title, size and country. Older videos are left
   * out by the store, not read and dropped.
   */
  listRecentVideos(since: Date): readonly RecentVideo[];
  listSaved(): readonly SavedIdea[];
  /** Saving an idea twice keeps the first save. */
  setSaved(key: string, template: string, saved: boolean, at: Date): void;
}

/** One finished refresh: how many stored channels were read again, and how it went. */
export interface RefreshRun {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly refreshed: number;
  readonly failed: number;
  /** YouTube refused several channels in a row, so the run gave up. */
  readonly stoppedEarly: boolean;
}

/** A log of refreshes, so the screen can say when the store was last brought up to date. */
export interface RefreshRunRepo {
  record(run: RefreshRun): void;
  /** The run that finished last, or null when there has been none. */
  latest(): RefreshRun | null;
}

/**
 * The right to read YouTube. One piece of work holds it at a time, across
 * every program that has the store open; see `withYouTubeLease`.
 */
export interface LeaseRepo {
  /** Takes the lease when it is free or has run out. False when other work holds it. */
  acquire(owner: string, now: Date, expiresAt: Date): boolean;
  /** Holds the lease for longer. False when `owner` does not hold it. */
  renew(owner: string, expiresAt: Date): boolean;
  /** Gives the lease back; does nothing when `owner` does not hold it. */
  release(owner: string): void;
  /** Who holds the lease at `now`; null when it is free or has run out. */
  holder(now: Date): string | null;
}

/** What the official API says about a channel, as far as the store keeps it. */
export interface NewFacts {
  readonly id: string;
  /** When the channel account was created, which can be long before its first upload. */
  readonly createdAt: Date;
  /** Two-letter country the owner of the channel set, or null when they set none. */
  readonly country: string | null;
  readonly totalViews: number | null;
}

export interface StoredFacts {
  readonly channelId: string;
  readonly createdAt: Date;
  readonly country: string | null;
  readonly totalViews: number | null;
  /** When the facts were read from the official API. */
  readonly fetchedAt: Date;
}

/** Channel facts from the official API, kept on the channel's own row. */
export interface FactsRepo {
  /** Null when the channel has no stored facts. */
  find(channelId: string): StoredFacts | null;
  /** Of these channels, the stored ones the official API has never been asked about. */
  listMissing(channelIds: readonly string[]): readonly string[];
  /**
   * Stores what the API returned and notes every channel asked about, so one
   * the API does not know is not asked about again on every run.
   */
  record(askedIds: readonly string[], facts: readonly NewFacts[], fetchedAt: Date): void;
}

/** What was found when a video's captions were asked for. */
export interface StoredTranscript {
  readonly videoId: string;
  /** Null when the video had no captions at the time. */
  readonly transcript: VideoTranscript | null;
  readonly fetchedAt: Date;
}

/** Video captions, kept so that each video's are read once. */
export interface TranscriptRepo {
  /** Null when the video's captions were never asked for. */
  find(videoId: string): StoredTranscript | null;
  /** Pass null for a video that has no captions, so that is remembered too. */
  save(videoId: string, transcript: VideoTranscript | null, fetchedAt: Date): void;
}

/** Where a video's description and tags were read from: the official API or its watch page. */
export type DetailsSource = 'api' | 'web';

export interface StoredVideoDetails extends VideoDetails {
  readonly videoId: string;
  readonly source: DetailsSource;
  readonly fetchedAt: Date;
}

export interface StoredStoryboard {
  /** Empty when the video has no storyboard. */
  readonly levels: readonly StoryboardLevel[];
  readonly fetchedAt: Date;
}

/** Video descriptions, tags and storyboards. A video need not be in the videos table. */
export interface VideoDetailsRepo {
  findDetails(videoId: string): StoredVideoDetails | null;
  /**
   * A length already stored is kept when the new reading has none: the
   * official API, read with the snippet alone, does not give one.
   */
  saveDetails(videoId: string, details: VideoDetails, source: DetailsSource, fetchedAt: Date): void;
  findStoryboard(videoId: string): StoredStoryboard | null;
  saveStoryboard(videoId: string, levels: readonly StoryboardLevel[], fetchedAt: Date): void;
}

/**
 * 'watch': what an engine saw and heard watching the whole video, sound included.
 * 'frames': what the video's preview frames show from start to end.
 */
export type StudyKind = 'watch' | 'frames';

/** What an engine wrote down about one video. */
export interface NewVideoStudy {
  readonly videoId: string;
  readonly kind: StudyKind;
  /** The engine that made it, by its id, such as "agy". */
  readonly engine: string;
  /** The study as the engine wrote it: a model's words, to be read as a description only. */
  readonly text: string;
  /**
   * For a study of frames: where the frames came from ('file': cut from the
   * video file, one a second; 'preview': YouTube's own preview frames) and how
   * many there were to look at. Absent or null for a watch.
   */
  readonly frames?: StudiedFrames | null;
}

export interface StudiedFrames {
  readonly source: 'file' | 'preview';
  readonly available: number;
}

export interface StoredVideoStudy extends NewVideoStudy {
  readonly frames: StudiedFrames | null;
  readonly studiedAt: Date;
}

/** Studies of videos, one per video and kind. A video need not be in the videos table. */
export interface VideoStudyRepo {
  /** Null when no engine has made that kind of study of the video. */
  find(videoId: string, kind: StudyKind): StoredVideoStudy | null;
  /** Replaces any earlier study of that kind. Throws for an id that is not a video id, or an empty study. */
  save(study: NewVideoStudy, studiedAt: Date): void;
}

/** One part of a channel's breakdown as it is stored: the text an engine wrote, or why there is none. */
export type StoredBreakdownPart = {
  readonly channelId: string;
  readonly part: BreakdownPartId;
  /** When it was written, or when writing it failed. */
  readonly writtenAt: Date;
} & (
  | {
      readonly written: true;
      /** Who wrote it: an engine by its id, or "jgtube" for the part worked out in code. */
      readonly engine: string;
      /** The part as it was written: a model's words, to be read as a study only. */
      readonly text: string;
    }
  | { readonly written: false; readonly reason: string }
);

export interface WrittenBreakdownPart {
  readonly channelId: string;
  readonly part: BreakdownPartId;
  readonly engine: string;
  readonly text: string;
}

export interface FailedBreakdownPart {
  readonly channelId: string;
  readonly part: BreakdownPartId;
  /** Why it could not be written, in plain words. */
  readonly reason: string;
}

/** The parts of each channel's breakdown, one per channel and part; a new run replaces them. */
export interface BreakdownRepo {
  /** The channel's stored parts, in the order a breakdown is read. */
  list(channelId: string): readonly StoredBreakdownPart[];
  /** Null when that part was never written for the channel. */
  find(channelId: string, part: BreakdownPartId): StoredBreakdownPart | null;
  /** Replaces whatever was stored for that part. Throws for a bad channel id, part, engine or an empty text. */
  saveWritten(part: WrittenBreakdownPart, writtenAt: Date): void;
  /** Records that the part could not be written, in place of whatever was stored for it. */
  saveFailed(part: FailedBreakdownPart, failedAt: Date): void;
}

export interface StoredBrand extends ChannelBrand {
  readonly channelId: string;
  readonly fetchedAt: Date;
}

/** How each channel presents itself, kept on the channel's own row. */
export interface BrandRepo {
  /** Null when the channel's branding was never read. */
  find(channelId: string): StoredBrand | null;
  /** Does nothing for a channel that is not in the store. */
  save(channelId: string, brand: ChannelBrand, fetchedAt: Date): void;
}
