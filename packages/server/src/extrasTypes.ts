/**
 * The later features as the API sees them, each scoped to one centre channel
 * by its channel id: what changed since the owner last looked.
 */
import type { ChangesView, SinceKind } from '@jgtube/core';
import type { AlertsEngine } from './alertsTypes';
import type { CalendarEngine } from './calendarTypes';
import type { CommentsEngine } from './commentsTypes';
import type { PacingEngine } from './pacingTypes';
import type { RiskEngine } from './riskTypes';
import type { PlanEngine } from './planTypes';

/** What changed around a channel, with the moment it was asked for and the one it was answered for. */
export interface ChangesReply extends ChangesView {
  readonly asked: SinceKind;
  /** The moment answered for: a week when "last look" was asked and none is stored. */
  readonly sinceKind: SinceKind;
  /** When the owner last marked this channel as seen; null when never. */
  readonly lastLookAt: string | null;
}

export interface ChangesEngine {
  /** What changed among a channel's look-alikes; reads the store only. Null when it has no map. */
  findChanges(centerChannelId: string, since: SinceKind): ChangesReply | null;
  /** Moves the channel's last look to now and returns it; null when it has no map. */
  markChangesSeen(centerChannelId: string): string | null;
}

/** Everything the later features add to the engine. */
export type ExtrasEngine = ChangesEngine &
  AlertsEngine &
  PlanEngine &
  CalendarEngine &
  PacingEngine &
  CommentsEngine &
  RiskEngine;
