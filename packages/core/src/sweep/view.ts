/** What the sweep's routes answer, shared by the server and the page. Types only. */
import type { FindVia } from '../bank/cost';
import type { SweepAllowance, SweepPlan } from './budget';
import type { KeywordSuggestion } from './suggest';
import type { SweepOutcome } from './sweep';
import type { SweepSettings, SweepStarter, SweepStop, SweepSummary } from './types';

export interface KeywordView {
  readonly id: number;
  readonly keyword: string;
  readonly paused: boolean;
  /** ISO-8601; null until a sweep has searched for it. */
  readonly lastSweptAt: string | null;
  /** Channels it brought into the store that qualified as niches when found. */
  readonly found: number;
}

export interface SweepRunView {
  readonly id: number;
  readonly startedBy: SweepStarter;
  readonly via: FindVia;
  readonly startedAt: string;
  /** Null for a sweep cut off by a stop. */
  readonly finishedAt: string | null;
  readonly stopped: SweepStop | null;
  readonly message: string | null;
  /** Page requests and API units it was charged. */
  readonly requests: number;
  readonly apiUnits: number;
  readonly summary: SweepSummary | null;
}

export interface SweepInfo {
  /** How a sweep would read YouTube now: the owner's API key, or signed-out pages. */
  readonly via: FindVia;
  readonly keywords: readonly KeywordView[];
  readonly maxKeywords: number;
  readonly suggestions: readonly KeywordSuggestion[];
  readonly settings: SweepSettings;
  /** Today's budget: used and left, in page requests and, with a key, API units. */
  readonly budget: SweepAllowance;
  /** The most a sweep started now can cost. */
  readonly plan: SweepPlan;
  readonly last: SweepRunView | null;
  /** Set while sweeps rest after a refusal from YouTube, ISO-8601. */
  readonly restingUntil: string | null;
  /** Why a sweep cannot start now, in plain words; null when it can. */
  readonly cannotStart: string | null;
}

export type SweepResult = SweepOutcome;
