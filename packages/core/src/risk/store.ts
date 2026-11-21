import type { OverlapNote, RiskClaim } from './claims';

/** A concept's latest risk check by an engine, as checked in code. */
export interface StoredRiskCheck {
  readonly claims: readonly RiskClaim[];
  readonly notes: readonly OverlapNote[];
  readonly engine: string;
  readonly checkedAt: Date;
  /** When the script had last changed at the time, so a later change can be said. */
  readonly scriptUpdatedAt: Date;
}

export interface RiskRepo {
  /** Null when none was made, or the concept is another channel's. */
  find(centerChannelId: string, conceptId: number): StoredRiskCheck | null;
  save(centerChannelId: string, conceptId: number, check: StoredRiskCheck): void;
}
