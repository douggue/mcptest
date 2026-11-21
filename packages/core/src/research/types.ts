import type { Claim, ClaimVerdict } from './claims';
import type { FactSheet } from './factSheet';

export interface StoredFactSheet extends FactSheet {
  readonly conceptId: number;
  readonly engine: string;
  readonly writtenAt: Date;
}

/** A claim with its verdict, as stored with its script. */
export type CheckedClaim = Claim & Omit<ClaimVerdict, 'index'>;

export interface StoredClaim extends CheckedClaim {
  readonly engine: string;
  readonly checkedAt: Date;
}

/** Which length field the owner typed last; with words, the words typed. */
export interface TypedLength {
  readonly typed: 'minutes' | 'words';
  readonly words: number | null;
}

/** A concept's research, read through the centre channel it belongs to. */
export interface ResearchRepo {
  findSheet(centerChannelId: string, conceptId: number): StoredFactSheet | null;
  /** Replaces the concept's sheet. Throws for a concept that does not exist. */
  saveSheet(conceptId: number, sheet: FactSheet, engine: string, at: Date): void;
  listClaims(centerChannelId: string, conceptId: number): readonly StoredClaim[];
  /** Stores each verdict, replacing an earlier one for the same claim. */
  saveClaims(conceptId: number, claims: readonly CheckedClaim[], engine: string, at: Date): void;
  removeClaim(conceptId: number, what: string, sentence: string): void;
  findLength(centerChannelId: string, conceptId: number): TypedLength | null;
  saveLength(conceptId: number, length: TypedLength, at: Date): void;
}
