import type { QuotaKind } from '../quota/kinds';
import type { NewSubject } from '../subjects/subject';
import type { ChannelFacts, VideoFacts } from '../youtube/dataApi';

/** Runs the given writes as one: all of them are stored, or none. */
export type Transact = (work: () => void) => void;

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

/** What one day's API calls cost, in units of the key's allowance. */
export interface DayUsage {
  /** The calendar day in Pacific time, as YYYY-MM-DD. */
  readonly day: string;
  readonly unitsSpent: number;
  readonly byKind: Readonly<Record<QuotaKind, number>>;
}

/** The most a day may reach, for one kind of call and for all of them together. */
export interface SpendLimits {
  readonly kind: number;
  readonly total: number;
}

/** The record of units spent, one row a day. */
export interface QuotaRepo {
  /** What was spent on `day`; all zeros for a day nothing was spent on. */
  usage(day: string): DayUsage;
  /**
   * Adds `units` to the day and to its kind, unless either would pass its
   * limit: then nothing is added and the answer is false. Checked and written
   * as one step, so two programs cannot both spend the last units.
   */
  spendWithin(day: string, kind: QuotaKind, units: number, limits: SpendLimits): boolean;
  /**
   * Raises what the day has cost to at least `total`, leaving the per-kind
   * figures as they are. Never lowers it.
   */
  exhaust(day: string, total: number): void;
}

/** A channel as the store holds it. */
export interface StoredChannel {
  readonly id: string;
  /** Null when the channel is known only by its id so far. */
  readonly title: string | null;
  readonly country: string | null;
  /** Null until the channel's facts have been read: a row can be made from a search hit alone. */
  readonly createdAt: Date | null;
  readonly subscribers: number | null;
  readonly subscribersHidden: boolean;
  readonly videoCount: number | null;
  readonly totalViews: number | null;
  readonly uploadsPlaylistId: string | null;
  /** When YouTube was last asked about the channel, whatever it answered. */
  readonly fetchedAt: Date;
  /** Since when the channel has been waiting for its facts to be read; null when it is not. */
  readonly readQueuedAt: Date | null;
}

export interface ChannelReadRequest {
  readonly id: string;
  /** The channel's name as a search gave it, for a channel not stored yet. */
  readonly title: string | null;
  readonly now: Date;
  /** A stored channel is queued only when its facts were last asked for at or before this. */
  readonly staleBefore: Date;
}

export interface ChannelRepo {
  /** Stores a channel's facts as just read, and takes it out of the queue. */
  upsert(channel: ChannelFacts, fetchedAt: Date): void;
  /**
   * Makes sure the channel has a row (a video cannot be stored without one)
   * and queues a read of its facts: always for a new channel, and for a known
   * one only when its facts are stale. True when it was queued by this call.
   */
  queueRead(request: ChannelReadRequest): boolean;
  /** The ids waiting for a read, longest-waiting first. */
  listQueued(): readonly string[];
  /** Takes a channel the API did not return out of the queue, noting when it was asked for. */
  markUnavailable(id: string, at: Date): void;
  get(id: string): StoredChannel | null;
}

/** A video as the store holds it: the API's facts and when they were read. */
export interface StoredVideo extends VideoFacts {
  readonly fetchedAt: Date;
}

export interface VideoRepo {
  /** Stores a video's facts as just read. Its channel must have a row already. */
  upsert(video: VideoFacts, fetchedAt: Date): void;
  get(id: string): StoredVideo | null;
  /** Which of the given ids are stored. */
  knownIds(ids: readonly string[]): readonly string[];
  /** Deletes a video with its readings, its tracking and its search hits. False when not stored. */
  delete(id: string): boolean;
}

/** A video's view count at one moment. Moments are kept to the whole second. */
export interface Reading {
  readonly videoId: string;
  readonly capturedAt: Date;
  readonly views: number;
}

export interface ReadingRepo {
  /** Stores a reading; a second one in the same second replaces the first. */
  add(reading: Reading): void;
  /** A video's readings from `from` to `to`, both included, oldest first. */
  list(videoId: string, from: Date, to: Date): readonly Reading[];
  /**
   * Thins the readings taken before `cutoff` to the last one of each UTC day,
   * per video. Returns how many were removed.
   */
  rollUpOlderThan(cutoff: Date): number;
  /** Removes every reading of a video. Returns how many there were. */
  deleteForVideo(videoId: string): number;
}

/** A subject as the store holds it. */
export interface Subject extends NewSubject {
  readonly id: number;
  readonly enabled: boolean;
  /** Null for a subject never searched. */
  readonly lastSearchedAt: Date | null;
}

export interface SubjectRepo {
  /** Stores a new, enabled subject. Throws when the same keyword, country and language is already there. */
  add(subject: NewSubject): Subject;
  list(): readonly Subject[];
  /** Turns a subject on or off. False when there is no such subject. */
  setEnabled(id: number, enabled: boolean): boolean;
  markSearched(id: number, at: Date): void;
  /** Enabled subjects whose time has come, never-searched first, then oldest-searched first. */
  listDue(now: Date): readonly Subject[];
}

export interface SubjectHitRepo {
  /** Notes that a search on the subject found the video. False when that was already noted. */
  add(subjectId: number, videoId: string, firstSeenAt: Date): boolean;
  /** The videos searches on the subject have found, first-seen first. */
  videoIdsFor(subjectId: number): readonly string[];
}

/** How often a tracked video is read: every hour, every six, or no longer. */
export type Tier = 'hourly' | 'six_hourly' | 'done';
/** Whether a video is a Short. `yes` is by its length only; see `shortByLength`. */
export type ShortAnswer = 'yes' | 'no' | 'unknown';

export interface TrackedVideo {
  readonly videoId: string;
  readonly tier: Tier;
  /** Null once tracking is done. */
  readonly nextReadAt: Date | null;
  readonly isShort: ShortAnswer;
  /** How many reads in a row the API has left the video out of. */
  readonly missedReads: number;
  readonly publishedAt: Date;
}

export interface TrackingRepo {
  /** Starts tracking a stored video at the hourly tier. False when it is tracked already. */
  start(videoId: string, isShort: ShortAnswer, nextReadAt: Date): boolean;
  /** Videos still tracked whose next read is at or before `now`, longest-due first. */
  listDue(now: Date): readonly TrackedVideo[];
  /** Sets the tier and the next read after a read that found the video. */
  move(videoId: string, tier: Exclude<Tier, 'done'>, nextReadAt: Date): void;
  /** Counts a read that did not find the video, and sets its next one. Returns the count in a row. */
  markMissed(videoId: string, tier: Exclude<Tier, 'done'>, nextReadAt: Date): number;
  /** Records what was learnt about whether the video is a Short. */
  classify(videoId: string, isShort: ShortAnswer): void;
  /** Ends tracking: the video is not read again. */
  finish(videoId: string): void;
  get(videoId: string): TrackedVideo | null;
}

/** Every repository over one store, and the means to write to several as one. */
export interface Store {
  readonly channels: ChannelRepo;
  readonly videos: VideoRepo;
  readonly readings: ReadingRepo;
  readonly subjects: SubjectRepo;
  readonly hits: SubjectHitRepo;
  readonly tracking: TrackingRepo;
  readonly transact: Transact;
}
