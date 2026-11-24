/**
 * The outlier bank: every stored video, whichever map, saved channel, niche
 * list, pasted channel or refresh read it, with its outlier score worked out
 * the usual way (views over its channel's usual at that age). Nothing here is
 * stored twice: the rows are read from the `outlier_bank_rows` view.
 */
import type { ScoreCaution } from '../map/breakouts';
import type { Tier } from '../map/view';
import type { MoneyStatus } from '../money/verdict';
import type { TopicSource } from '../niches/topic';

/** How close a channel is to one of the owner's channels, on that channel's latest map. */
export interface BankCloseness {
  readonly centerId: string;
  readonly centerTitle: string;
  readonly tier: Tier;
}

/** The channel a bank video belongs to, as the card and the filters need it. */
export interface BankChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  /** Null when hidden or never read. */
  readonly subscribers: number | null;
  /** On the channel image host only; null when none was read. */
  readonly logoUrl: string | null;
  /** Two letters, from the official API; null when not known. */
  readonly country: string | null;
  readonly topic: { readonly label: string; readonly source: TopicSource };
  /** 'latin', or the alphabet of most of its titles ('other' when it is not one of the named ones). */
  readonly alphabet: string;
  readonly money: MoneyStatus;
  /** Null when the channel is on none of the owner's maps' look-alike lists. */
  readonly closeness: BankCloseness | null;
  /** Whether any map holds the channel at all. */
  readonly onAMap: boolean;
}

export interface BankVideo {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  readonly ageDays: number;
  /** ISO-8601; as exact as YouTube said (see `publishedRaw`). */
  readonly publishedAt: string;
  readonly publishedRaw: string;
  readonly durationSeconds: number | null;
  /** A minute or less: the Shorts line the earnings estimate draws too. */
  readonly isShort: boolean;
  /** Views over the channel's usual at this age; null when there is too little to compare against. */
  readonly score: number | null;
  readonly baseline: number | null;
  readonly sampleSize: number | null;
  readonly caution: ScoreCaution | null;
  /** Views over days since upload (at least one day): an average, not a measured pace. */
  readonly viewsPerDay: number;
  /** When the video was last read, ISO-8601. */
  readonly readAt: string;
  readonly channel: BankChannel;
}

/** The bank as built from the store at one moment. */
export interface Bank {
  readonly builtAt: string;
  readonly videos: readonly BankVideo[];
}
