import type { BoardVideo } from '../map/thumbnails';
import type { StoredChannel, StoredFacts, StoredVideo, VideoReading } from '../repos/types';
import type { EarningsEstimate } from '../scoring/earnings';
import type { NicheGrowth } from './growth';
import type { NicheTopic, TopicInput } from './topic';

/** What the niche list is made from and what it holds. */

/** 'new': first upload in the last 90 days. 'small': 10,000 subscribers or fewer. */
export type NicheReason = 'new' | 'small';

/** The alphabet a channel in another language writes in; null when it is not one of the named ones. */
export interface NicheLanguage {
  readonly script: string | null;
}

export interface NicheSample {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
}

export interface NicheChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  /** Null when the channel hides its count. */
  readonly subscribers: number | null;
  /** Views on videos uploaded in the last 30 days. Not the same as views in the last 30 days. */
  readonly recentViews: number;
  readonly recentUploads: number;
  /** `recentViews` for each subscriber; null when the count is hidden or zero. */
  readonly viewsPerSubscriber: number | null;
  /**
   * What the views on the last 30 days' uploads are worth in ad revenue: a
   * rough monthly range for comparing channels, not a measurement.
   */
  readonly earnings: EarningsEstimate;
  /** Views on videos uploaded in the last 90 days: the figure the list is sorted by. */
  readonly ninetyDayViews: number;
  readonly ninetyDayUploads: number;
  /** What the views on the last 90 days' uploads are worth in ad revenue; as rough as `earnings`. */
  readonly ninetyDayEarnings: EarningsEstimate;
  /**
   * Set when most of the channel's titles are in another alphabet than Latin:
   * it makes its videos for another audience, which makes it a possible idea
   * to carry over, not a channel to leave out. `script` names the alphabet
   * when it can be told, such as "Cyrillic". Null for a channel in Latin letters.
   */
  readonly otherLanguage: NicheLanguage | null;
  /** Days since the channel's first upload; null when older videos may not have been read. */
  readonly channelAgeDays: number | null;
  /** Which of new and small the channel is; both when it is both. */
  readonly reasons: readonly NicheReason[];
  /** Its recent videos that outperform, most viewed first; a few at most. */
  readonly outperformers: readonly BoardVideo[];
  /** Of its scored videos from the last 90 days, how many were strong outliers. */
  readonly hitCount: number;
  readonly scoredCount: number;
  /** Its most viewed uploads of the last 30 days. */
  readonly sampleTitles: readonly NicheSample[];
  /**
   * Views its videos gained between its earliest reading of the last 30 days
   * and its latest: a measurement, unlike `recentViews`. Null until the channel
   * has been read twice in that time.
   */
  readonly growth: NicheGrowth | null;
  /**
   * When the channel account was created, from the official API, as an
   * ISO-8601 string. Often years before the first upload. Null until asked for.
   */
  readonly createdAt: string | null;
  /** Two-letter country the channel's owner set; null when none or not asked for. */
  readonly country: string | null;
  /**
   * The address of the channel's logo, at a size for showing beside its name,
   * on the host channel images are served from. Null until the channel has
   * been read since logos were kept.
   */
  readonly logoUrl: string | null;
  /**
   * What the channel is about, as one label from a fixed table, and where the
   * label came from: its own keywords and description, or its titles. "Other"
   * when nothing pointed clearly anywhere.
   */
  readonly topic: NicheTopic;
  /** False only on a watched channel that no longer meets the rule. */
  readonly qualifies: boolean;
  /** The owner marked it to keep an eye on. */
  readonly watched: boolean;
  /**
   * How the channel came into the store: a watchlist keyword's sweep, the
   * snowball from another new niche, or one of the owner's maps. Null when
   * none of these is recorded (a pasted channel, an earlier keyword search).
   */
  readonly foundBy: NicheFoundBy | null;
  /** The latest finished sweep brought it into the store. */
  readonly newSinceSweep: boolean;
}

export type NicheFoundBy =
  | { readonly kind: 'keyword'; readonly keyword: string }
  | {
      readonly kind: 'snowball';
      readonly fromChannelId: string;
      /** The title of the niche it stood beside; null when the store no longer holds it. */
      readonly fromTitle: string | null;
    }
  | { readonly kind: 'map' };

/** How a listed channel was found, as the list shows it. */
export interface NicheFound {
  readonly foundBy: NicheFoundBy | null;
  readonly newSinceSweep: boolean;
}

/** Plain values, ready to serialise. */
export interface NicheList {
  /** Most views on the uploads of the last 90 days first. */
  readonly channels: readonly NicheChannel[];
  /** How many stored channels were gone through. */
  readonly channelsChecked: number;
  /** The limits the list was made with, so a reader can say what new and small mean. */
  readonly smallMaxSubscribers: number;
  readonly newMaxAgeDays: number;
  /** When the latest sweep finished, ISO-8601; null when none has. */
  readonly lastSweepAt: string | null;
  /** How many of the listed channels that sweep brought in. */
  readonly newSinceSweep: number;
}

/** A stored channel with its videos, newest first. */
export interface NicheSource {
  readonly channel: StoredChannel;
  readonly videos: readonly StoredVideo[];
}

export interface NicheInput {
  readonly sources: readonly NicheSource[];
  readonly watchedIds: ReadonlySet<string>;
  /** Channels never offered as a niche: the ones the owner maps from. */
  readonly excludedIds: ReadonlySet<string>;
  /**
   * A channel's stored view readings, asked for only for the channels that end
   * up listed. Without it no growth is worked out.
   */
  readonly readingsOf?: (channelId: string) => readonly VideoReading[];
  /** A channel's stored facts from the official API, asked for only for listed channels. */
  readonly factsOf?: (channelId: string) => StoredFacts | null;
  /** The address of a channel's stored logo, asked for only for listed channels. */
  readonly logoOf?: (channelId: string) => string | null;
  /** A channel's own keywords and description, asked for only for listed channels. */
  readonly brandOf?: (channelId: string) => TopicInput['brand'];
  /** How a channel was found, asked for only for listed channels. Without it nothing is said. */
  readonly foundOf?: (channelId: string) => NicheFound;
  /** When the latest sweep finished; null or left out when none has. */
  readonly lastSweepAt?: Date | null;
  /**
   * How many stored channels the sources were chosen from, when they are not
   * the whole store. Left out, the sources are taken to be all of it.
   */
  readonly channelsChecked?: number;
}
