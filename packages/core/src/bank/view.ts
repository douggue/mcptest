/** What the bank's routes answer, shared by the server and the page. Types only. */
import type { BankCollection } from './collections';
import type { FindAllowance, FindPlan, FindVia } from './cost';
import type { FindOutcome } from './grow';
import type { BankPage } from './query';

export interface BankLook {
  /** When the bank was last worked out from the store, ISO-8601. */
  readonly builtAt: string;
  readonly page: BankPage;
  readonly collections: readonly BankCollection[];
}

export interface FindInfo {
  readonly via: FindVia;
  /** The most a run of that many channels can cost, said before it starts. */
  readonly plan: FindPlan;
  readonly allowance: FindAllowance;
  /** The topics that can be searched for, by label. */
  readonly topics: readonly string[];
}

export interface FindResult extends FindOutcome {
  /** Videos in the bank before and after the run. */
  readonly bankBefore: number;
  readonly bankAfter: number;
}
