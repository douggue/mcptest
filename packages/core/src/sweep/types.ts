import type { FindVia } from '../bank/cost';
import type { Pots } from './budget';

/** How a sweep ended: all of it, at the day's budget, at a refusal from YouTube, or on failures. */
export type SweepStop = 'done' | 'budget' | 'refused' | 'failed';
/** Who started it: the owner's press or the schedule. */
export type SweepStarter = 'owner' | 'schedule';

/** One keyword or topic on the owner's watchlist. */
export interface WatchKeyword {
  readonly id: number;
  readonly keyword: string;
  readonly paused: boolean;
  readonly addedAt: Date;
  /** When a sweep last searched for it; null until one has. */
  readonly lastSweptAt: Date | null;
  /** Channels it brought into the store that qualified as niches when found. */
  readonly found: number;
}

export interface SweepSettings {
  /** Days between scheduled sweeps; null when the schedule is off. */
  readonly everyDays: number | null;
  /** The owner's YouTube reading budget per day, in page requests. */
  readonly pageBudget: number;
}

/** What one keyword's turn in a sweep did. */
export interface KeywordSummary {
  readonly keywordId: number;
  readonly keyword: string;
  /** Distinct channels behind the videos the search found. */
  readonly channelsFound: number;
  readonly channelsRead: number;
  /** Channels the store held from a recent read, so nothing was asked for. */
  readonly alreadyKnown: number;
  readonly failed: number;
  /** Channels it read that are niches now and were not before the sweep. */
  readonly qualified: number;
  /** Page requests charged (the most each read can take). */
  readonly requests: number;
  readonly apiUnits: number;
}

/** What the snowball step of a sweep did. */
export interface SnowballSummary {
  /** New niche channels whose sidebars were read. */
  readonly sources: number;
  readonly sidebarsRead: number;
  readonly channelsRead: number;
  readonly failed: number;
  readonly qualified: number;
  readonly requests: number;
  readonly apiUnits: number;
}

export interface SweepSummary {
  readonly keywords: readonly KeywordSummary[];
  readonly snowball: SnowballSummary;
  /** Channels this sweep read that are niches now and were not before it. */
  readonly newNiches: number;
  /** Active keywords the sweep did not reach. */
  readonly keywordsLeft: number;
  /** The first few reasons a read failed. */
  readonly problems: readonly string[];
}

export interface StoredSweep {
  readonly id: number;
  readonly startedBy: SweepStarter;
  readonly via: FindVia;
  /** Page requests charged so far. */
  readonly requests: number;
  readonly apiUnits: number;
  readonly startedAt: Date;
  /** Null while it runs, and for one cut off by a stop. */
  readonly finishedAt: Date | null;
  readonly stopped: SweepStop | null;
  readonly message: string | null;
  readonly summary: SweepSummary | null;
}

/** Which sweep first brought a channel into the store, and how. */
export interface SweepFind {
  readonly channelId: string;
  readonly sweepId: number;
  readonly source: 'keyword' | 'snowball';
  readonly keywordId: number | null;
  /** The keyword as it was swept; kept after the keyword is removed. */
  readonly keyword: string | null;
  /** The new niche channel whose sidebar it stood in, for a snowball find. */
  readonly fromChannelId: string | null;
  /** Whether it qualified as a niche when found. */
  readonly qualified: boolean;
  readonly foundAt: Date;
}

export interface SweepEnd {
  readonly stopped: SweepStop;
  readonly message: string | null;
  readonly summary: SweepSummary;
  readonly finishedAt: Date;
}

/** The watchlist, the owner's sweep settings, and what each sweep spent and found. */
export interface SweepRepo {
  keywords(): readonly WatchKeyword[];
  /** Null when the keyword is already kept, whatever its case. */
  addKeyword(keyword: string, at: Date): WatchKeyword | null;
  removeKeyword(id: number): boolean;
  setPaused(id: number, paused: boolean): boolean;
  markSwept(id: number, at: Date): void;
  settings(): SweepSettings;
  saveSettings(settings: SweepSettings): void;
  begin(start: {
    readonly startedBy: SweepStarter;
    readonly via: FindVia;
    readonly startedAt: Date;
  }): number;
  /** Writes what the sweep has spent so far. */
  spend(id: number, spent: Pots): void;
  finish(id: number, end: SweepEnd): void;
  /** The sweep started most recently, finished or not. */
  latest(): StoredSweep | null;
  /** The newest sweeps, newest first. */
  list(limit: number): readonly StoredSweep[];
  /** What sweeps started since then spent. */
  spentSince(since: Date): Pots;
  /** Kept only for a channel no sweep found before. */
  recordFind(find: SweepFind): void;
  finds(): ReadonlyMap<string, SweepFind>;
  /** Channels found since then that qualified as niches when found. */
  qualifiedSince(since: Date): number;
}
