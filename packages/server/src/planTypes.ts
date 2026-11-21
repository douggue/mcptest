/**
 * The owner's own videos against the plan, as the API sees them: one centre
 * channel's kept concepts linked to the published videos they became.
 */
import type { LinkOutcome, PlanView } from '@jgtube/core';

/** How linking went: core's outcomes, a link that is not a video, one not found after a read, or no map. */
export type PlanLinkOutcome = LinkOutcome | 'bad-link' | 'not-found' | 'no-map';

export interface PlanLinkReply {
  readonly outcome: PlanLinkOutcome;
  /** The plan after a link; null when nothing was linked. */
  readonly plan: PlanView | null;
}

export interface PlanEngine {
  /** Reads the store only; null when the channel has no map. */
  findPlan(centerChannelId: string): PlanView | null;
  /** Links a pasted video; reads the channel from YouTube once when the video is not stored. */
  linkPlanVideo(centerChannelId: string, conceptId: number, link: string): Promise<PlanLinkReply>;
  /** Null when the channel has no map. */
  unlinkPlanVideo(centerChannelId: string, conceptId: number): PlanView | null;
}
