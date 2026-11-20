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
  /**
   * Counts a read whose reply could not be read for this channel, which stays
   * queued. Returns how many there have been since its facts were last stored.
   */
  countFailedRead(id: string): number;
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
  /**
   * Deletes a video with its readings, its tracking and its search hits. False
   * when not stored. Only the retention clean-up does this: never a missed read.
   */
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

/**
 * The two searches made for a subject. `top_recent`: the most-viewed videos of
 * the last two days. `newest`: everything published since the last such sweep.
 */
export type SearchKind = 'top_recent' | 'newest';

/**
 * How a video came to be known: by one of the searches, or by reading the
 * uploads of a channel that is followed.
 */
export type HitKind = SearchKind | 'channel_uploads';

/** A subject as the store holds it. `everyHours` is the cadence of its top-recent search. */
export interface Subject extends NewSubject {
  readonly id: number;
  readonly enabled: boolean;
  /** When its top-recent search last ran; null when it never has. */
  readonly lastSearchedAt: Date | null;
  /**
   * The hours between its newest sweeps as things stand: the configured
   * `newestEveryHours`, or less while its sweeps come back full.
   */
  readonly newestIntervalHours: number;
  /** When its newest sweep last ran, whether or not it answered; null when it never has. */
  readonly newestLastAt: Date | null;
  /** The moment its last answered newest sweep reached: the next one starts from here. */
  readonly newestSweptTo: Date | null;
}

/** A newest sweep that answered: when, and the interval it leaves the subject on. */
export interface Sweep {
  readonly at: Date;
  readonly intervalHours: number;
}

export interface SubjectRepo {
  /** Stores a new, enabled subject. Throws when the same keyword, country and language is already there. */
  add(subject: NewSubject): Subject;
  list(): readonly Subject[];
  /** Turns a subject on or off. False when there is no such subject. */
  setEnabled(id: number, enabled: boolean): boolean;
  /** Notes that a search of this kind ran now, answered or not, so its hours start again. */
  markSearched(id: number, kind: SearchKind, at: Date): void;
  /** Notes a newest sweep that answered: the next starts where this one ended. */
  markSwept(id: number, sweep: Sweep): void;
}

/** Which search, or which channel read, found a video, and how. */
export interface SubjectHit {
  /** Null for a video found on a followed channel that no subject led to. */
  readonly subjectId: number | null;
  readonly videoId: string;
  readonly kind: HitKind;
  /** Its place in the results, 1 to 50; null when the way it was found has none. */
  readonly rank: number | null;
  /** How old the video was when found, in hours; null when not known. */
  readonly ageHours: number | null;
  readonly firstSeenAt: Date;
}

export interface SubjectHitRepo {
  /** Notes a find. False when the same subject and kind had found the video before. */
  add(hit: SubjectHit): boolean;
  /** The videos searches on the subject have found, first-seen first, each once. */
  videoIdsFor(subjectId: number): readonly string[];
  /** Every find of a video, first-seen first. */
  listForVideo(videoId: string): readonly SubjectHit[];
}

/** A search result waiting for the details of its video to be read. */
export interface PendingHit {
  readonly subjectId: number;
  readonly videoId: string;
  readonly kind: SearchKind;
  /** Its place in the search's results, 1 to 50. */
  readonly rank: number | null;
  readonly channelId: string;
  /** The channel's name as the search gave it. */
  readonly channelTitle: string | null;
  /** When the search answered. */
  readonly foundAt: Date;
}

/** Search results kept from the search's reply until their videos' details are read. */
export interface PendingHitRepo {
  /** Keeps a result. False when the same search of the subject is already waiting on the video. */
  add(hit: PendingHit): boolean;
  /** Every result still waiting, longest-waiting first. */
  list(): readonly PendingHit[];
  remove(hit: Pick<PendingHit, 'subjectId' | 'videoId' | 'kind'>): void;
  count(): number;
  /** Drops results found before `cutoff`. Returns how many. */
  deleteOlderThan(cutoff: Date): number;
}

/** Why a video a search returned is not tracked. */
export type PassedOverReason = 'too_long' | 'not_returned';

/** Videos searches return that are not worth reading again. */
export interface PassedOverRepo {
  /** Remembers a video; one already remembered keeps its first reason. */
  add(videoId: string, reason: PassedOverReason, at: Date): void;
  /** Which of the given ids are remembered. */
  knownIds(ids: readonly string[]): readonly string[];
  /** Forgets videos noted before `cutoff`. Returns how many. */
  deleteOlderThan(cutoff: Date): number;
}

/** How often a tracked video is read: every hour, every six, or no longer. */
export type Tier = 'hourly' | 'six_hourly' | 'done';
/** Whether a video is a Short. `yes` is by its length only; see `shortByLength`. */
export type ShortAnswer = 'yes' | 'no' | 'unknown';

/**
 * Why a video's tracking ended. `aged_out`: it reached the age tracking stops
 * at. `not_short`: it turned out too long for a Short. `gone`: the API left
 * it out of several reads, far enough apart, in a row.
 */
export type FinishReason = 'aged_out' | 'not_short' | 'gone';

export interface TrackedVideo {
  readonly videoId: string;
  readonly tier: Tier;
  /** Null once tracking is done. */
  readonly nextReadAt: Date | null;
  readonly isShort: ShortAnswer;
  /** How many reads in a row, far enough apart to count, the API has left the video out of. */
  readonly missedReads: number;
  readonly publishedAt: Date;
  /** When and why tracking ended; null while it goes on. */
  readonly finishedAt: Date | null;
  readonly finishReason: FinishReason | null;
}

/** A read that did not find a video. */
export interface MissedRead {
  readonly videoId: string;
  readonly tier: Exclude<Tier, 'done'>;
  readonly nextReadAt: Date;
  readonly at: Date;
  /** A miss counts only when the one before it is at least this long ago. */
  readonly minGapMs: number;
}

export interface TrackingRepo {
  /** Starts tracking a stored video at the hourly tier. False when it is tracked already. */
  start(videoId: string, isShort: ShortAnswer, nextReadAt: Date): boolean;
  /** Videos still tracked whose next read is at or before `before`, longest-due first. */
  listDue(before: Date): readonly TrackedVideo[];
  /** Sets the tier and the next read after a read that found the video. */
  move(videoId: string, tier: Exclude<Tier, 'done'>, nextReadAt: Date): void;
  /**
   * Notes a read that did not find the video, and sets its next one. The miss
   * is counted only when the last counted one is far enough back (or there is
   * none): two misses minutes apart are one outage, not two. Returns the count.
   */
  markMissed(miss: MissedRead): number;
  /** Records what was learnt about whether the video is a Short. */
  classify(videoId: string, isShort: ShortAnswer): void;
  /** Ends tracking, noting when and why: the video is not read again. */
  finish(videoId: string, reason: FinishReason, at: Date): void;
  get(videoId: string): TrackedVideo | null;
  /** How many videos are still tracked, and how many of those have a read due at `now`. */
  counts(now: Date): TrackingCounts;
}

export interface TrackingCounts {
  readonly tracked: number;
  readonly due: number;
}

/** `niche`: a small channel's Short gaining fast. `transfer`: an idea winning elsewhere. */
export type FindingKind = 'niche' | 'transfer';

/**
 * What a finding says about itself, kept with it so an alert needs no other
 * row. The rules that write findings fill in what they know; everything may
 * be missing, and an alert leaves out what is.
 */
export interface FindingReason {
  /** Why the video is listed, one plain sentence each, as the rules worded it. */
  readonly why: readonly string[];
  readonly totalViews: number | null;
  /** Null when hidden or not read yet. */
  readonly subscribers: number | null;
  readonly channelCreatedAt: Date | null;
  /** The country the channel says it is in. */
  readonly channelCountry: string | null;
  /** The subject whose search found the video, and the country it was searched in. */
  readonly subjectKeyword: string | null;
  readonly subjectRegion: string | null;
}

/** A finding as the rules hand it over. */
export interface NewFinding {
  readonly videoId: string;
  readonly channelId: string;
  readonly videoTitle: string;
  readonly channelTitle: string | null;
  readonly publishedAt: Date;
  readonly kind: FindingKind;
  readonly reason: FindingReason;
  readonly viewsPerHour: number | null;
  /** US dollars at the configured Shorts rate; null when not worked out. */
  readonly earningsLow: number | null;
  readonly earningsHigh: number | null;
  readonly foundAt: Date;
}

export interface Finding extends NewFinding {
  readonly id: number;
  /** When its own alert was accepted by Telegram; null when none was sent. */
  readonly alertedAt: Date | null;
  /** When a daily summary told of it in place of an alert; null when none did. */
  readonly digestedAt: Date | null;
  /** When it was given up on because Telegram would not take its message; null when it was not. */
  readonly skippedAt: Date | null;
  /** What Telegram said of the message it would not take. */
  readonly skipReason: string | null;
}

/** What was found, and what the owner has been told of it. */
export interface FindingRepo {
  /**
   * Stores a finding. A video is found once of each kind: a second finding of
   * the same video and kind changes nothing and the answer is false.
   */
  add(finding: NewFinding): boolean;
  /** Findings the owner has not been told of, in an alert or a summary, and not given up on, oldest first. */
  listWaiting(limit: number): readonly Finding[];
  countWaiting(): number;
  /** Notes that the finding's alert went out. False when it had gone out already. */
  markAlerted(id: number, at: Date): boolean;
  /** Counts a message Telegram would not take for this finding. Returns how many there have been. */
  countRejection(id: number): number;
  /** Gives up on telling of this finding, noting why: it no longer waits. */
  markSkipped(id: number, reason: string, at: Date): void;
  /** Notes that a daily summary told of these findings. */
  markDigested(ids: readonly number[], at: Date): void;
  /** How many alerts went out from `from` up to, not including, `to`. */
  countAlertedBetween(from: Date, to: Date): number;
  /** Findings made from `from` up to, not including, `to`, oldest first. */
  listFoundBetween(from: Date, to: Date): readonly Finding[];
}

/** The service's memory between restarts: a few named values. */
export interface ServiceStateRepo {
  get(key: string): string | null;
  set(key: string, value: string, at: Date): void;
}

/** Every repository over one store, and the means to write to several as one. */
export interface Store {
  readonly channels: ChannelRepo;
  readonly videos: VideoRepo;
  readonly readings: ReadingRepo;
  readonly subjects: SubjectRepo;
  readonly hits: SubjectHitRepo;
  readonly pending: PendingHitRepo;
  readonly passedOver: PassedOverRepo;
  readonly tracking: TrackingRepo;
  readonly findings: FindingRepo;
  readonly state: ServiceStateRepo;
  readonly transact: Transact;
}
