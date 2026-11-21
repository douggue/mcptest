import type { Place } from './places';

/** What the transfer list is made from and what it holds. Plain values, ready to serialise. */

/** One recent video with what is needed of its channel, as the store hands it over. */
export interface RecentVideo {
  readonly id: string;
  readonly channelId: string;
  readonly title: string;
  readonly views: number;
  readonly durationSeconds: number | null;
  readonly publishedAt: Date;
  readonly channelTitle: string;
  /** Null when the channel hides its count. */
  readonly subscribers: number | null;
  /** The channel's two-letter country from the official API; null when not known. */
  readonly country: string | null;
}

/** Where a version's place was read from: the title's own words, or its channel's country. */
export type PlaceSource = 'title' | 'channel';

export interface VersionPlace extends Place {
  readonly source: PlaceSource;
}

/** One video that is a version of an idea. */
export interface TransferVersion {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly subscribers: number | null;
  /** The place the version was made for; null when neither the title nor the channel says. */
  readonly place: VersionPlace | null;
  readonly views: number;
  /** Multiple of the channel's usual views; null when it cannot be judged. */
  readonly score: number | null;
  readonly ageDays: number;
  readonly durationSeconds: number | null;
  /** Far above its channel's usual views or its size, and widely seen: see `isStrong`. */
  readonly strong: boolean;
  /** The country of the version's channel, from the official API; null when it is not known. */
  readonly channelCountry: Place | null;
  /**
   * True when the title names one place and the channel is in another country:
   * the version was made from outside the place it is about. False whenever
   * either is unknown.
   */
  readonly elsewhere: boolean;
}

/**
 * 'open': a version took off elsewhere and none was made for the owner's place.
 * 'weak': one was made for the owner's place and did far worse than the best elsewhere.
 * 'done': the owner's place already has a version that did well.
 * 'unproven': no version took off anywhere.
 * 'unplaced': a version took off, but where it or the owner's channel belongs is not known.
 * 'gone': a saved idea with no version among the recent videos any more.
 */
export type TransferStatus = 'open' | 'weak' | 'done' | 'unproven' | 'unplaced' | 'gone';

export interface TransferVerdict {
  readonly status: TransferStatus;
  /** The strongest version made for another place; null when none took off. */
  readonly winner: TransferVersion | null;
  /** The most viewed version made for the owner's place; null when there is none. */
  readonly own: TransferVersion | null;
}

/** How many versions an idea has for one place, and the best of them. */
export interface PlaceResult extends Place {
  readonly versions: number;
  readonly bestViews: number;
}

/** A video for the owner's place whose title is one word away from the idea's. */
export interface TransferVariant {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  readonly views: number;
  /** The word the variant uses where the idea's title has another, or null when it only adds or drops one. */
  readonly word: string | null;
}

/** One idea made by several channels: the same title but for the place and the numbers. */
export interface TransferIdea {
  /** The idea's words, joined: stable for as long as the title is, so a save can be kept by it. */
  readonly key: string;
  /** The title in lower case with its slots, such as "{place} just found a fuel that shouldn't exist". */
  readonly template: string;
  readonly verdict: TransferVerdict;
  /** True for 'open' and 'weak'. */
  readonly opportunity: boolean;
  /** Most viewed first; the first few when there are many. */
  readonly versions: readonly TransferVersion[];
  readonly versionCount: number;
  readonly channelCount: number;
  /** The spread: the most and the least viewed version. Null only for a 'gone' idea. */
  readonly best: TransferVersion | null;
  readonly worst: TransferVersion | null;
  /** The places it has been made for, best result first. */
  readonly places: readonly PlaceResult[];
  /** One-word-different titles made for the owner's place, when the idea itself was not. */
  readonly variants: readonly TransferVariant[];
  readonly saved: boolean;
}

/** One subject a title format has been used for. */
export interface FormatSubject {
  readonly subject: string;
  readonly videos: number;
  readonly channels: number;
  readonly bestViews: number;
  /** Its most viewed video. */
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  /**
   * The keys of the ideas behind this subject (see `TransferIdea.key`), so a
   * reader can leave out a subject whose ideas the owner has all saved.
   */
  readonly ideaKeys: readonly string[];
}

/** A title format used for several subjects: the same words around a subject that changes. */
export interface TransferFormat {
  readonly key: string;
  /** Such as "{place}'s new invention could make {subject} obsolete forever". */
  readonly template: string;
  readonly subjectCount: number;
  readonly channelCount: number;
  readonly videoCount: number;
  readonly bestViews: number;
  readonly medianViews: number;
  /** The places it has been made for, best result first; empty when its titles name none. */
  readonly places: readonly PlaceResult[];
  /** Most viewed subject first; the first few when there are many. */
  readonly subjects: readonly FormatSubject[];
}

/**
 * Where the owner's place came from: passed in for one request, the owner's
 * stored choice for the channel, the centre channels' titles, or their country.
 */
export type OwnerPlaceSource = 'given' | 'owner' | 'titles' | 'country';

/** What is known about the place of the channel on screen, each source on its own. */
export interface PlaceCheck {
  /** The channel on screen; null when the list is for the whole store. */
  readonly channelId: string | null;
  /** The place the owner chose for this channel; null when they have chosen none. */
  readonly chosen: Place | null;
  /** The place most of the channel's titles name first; null when none has the majority. */
  readonly fromTitles: Place | null;
  /** The channel's own country as a place; null when it is not known or not on the place list. */
  readonly fromCountry: Place | null;
  /** The two-letter country the official API gave for the channel; null when it gave none. */
  readonly countryCode: string | null;
  /** Whether the official API has been asked about this channel at all. */
  readonly countryAsked: boolean;
  /** True when the titles' place and the channel's country are both known and differ. */
  readonly disagree: boolean;
}

export interface OwnerPlace extends Place {
  readonly source: OwnerPlaceSource;
}

export interface TransferList {
  /** The place the owner makes videos for; null when it could not be told. */
  readonly ownerPlace: OwnerPlace | null;
  /** What each source says about the place of the channel on screen. */
  readonly placeCheck: PlaceCheck;
  /**
   * Channels this list rests on (the one on screen, and those behind the
   * listed ideas) whose country the official API was never asked for.
   */
  readonly countriesMissing: number;
  /** How far back videos were considered, in days. */
  readonly windowDays: number;
  readonly videosChecked: number;
  /** Ideas made by at least two channels: opportunities first, then the rest; saved ones always. */
  readonly ideas: readonly TransferIdea[];
  /** How many such ideas there are, shown or not. */
  readonly ideaCount: number;
  readonly opportunityCount: number;
  readonly formats: readonly TransferFormat[];
  readonly formatCount: number;
}
