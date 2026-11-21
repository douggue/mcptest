import type { AlertCriteria, AlertFinding } from './alerts';

/** What the owner sets for one centre channel. */
export interface AlertSettings extends AlertCriteria {
  readonly enabled: boolean;
}

/** A centre channel's rule as stored. */
export interface AlertRule extends AlertSettings {
  readonly centerChannelId: string;
  readonly createdAt: Date;
  /** The moment the last check compared up to; the next check starts from here. */
  readonly checkedAt: Date;
}

/** An alert as kept. */
export interface StoredAlert extends AlertFinding {
  readonly id: number;
  readonly centerChannelId: string;
  readonly foundAt: Date;
  /** Null until the owner marks the channel's alerts read. */
  readonly readAt: Date | null;
}

export interface AlertRepo {
  rule(centerChannelId: string): AlertRule | null;
  /** Saves a rule; a new one starts checking from `at`, a changed one keeps its times. */
  saveRule(centerChannelId: string, settings: AlertSettings, at: Date): AlertRule;
  listRules(): readonly AlertRule[];
  markChecked(centerChannelId: string, at: Date): void;
  /** Keeps findings not kept before; returns how many were new. */
  add(centerChannelId: string, findings: readonly AlertFinding[], at: Date): number;
  /** The newest first, up to `limit`. */
  list(centerChannelId: string, limit: number): readonly StoredAlert[];
  /** Unread alerts per centre channel; channels with none are left out. */
  unreadCounts(): ReadonlyMap<string, number>;
  /** Marks a channel's unread alerts read; returns how many. */
  markRead(centerChannelId: string, at: Date): number;
}
