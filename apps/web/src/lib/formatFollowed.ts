/**
 * "Your videos against the plan": which slots of the channel's active format
 * its own videos followed, and how those did against the ones that did not.
 * Every count and median comes from the server, worked out in code; this
 * only fetches and phrases it.
 */
import type { FollowedReport, FollowedRow, FollowedSlot } from '@jgtube/core';
import { ApiError, apiCaller, type Fetch } from './api';
import { LAYER_LABELS } from './formatShelf';

export const FOLLOWED_PATH = '/api/format/followed';
const NOT_FOUND = 404;

export interface FollowedView {
  readonly format: { readonly id: number; readonly name: string };
  readonly report: FollowedReport;
}

export function createFollowedApi(fetcher?: Fetch) {
  const { call, unwrap } = apiCaller(fetcher);
  return {
    /** The channel's videos against its active format; null when it has none. */
    async followed(channel: string): Promise<FollowedView | null> {
      try {
        return unwrap<FollowedView>(
          await call(`${FOLLOWED_PATH}?channel=${encodeURIComponent(channel)}`),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === NOT_FOUND) return null;
        throw error;
      }
    },
  };
}

const score = (median: number | null): string =>
  median === null ? 'no score yet' : `median ${Math.round(median * 10) / 10}×`;

/** One slot's counts in a sentence: "Title formula: 2 of 6 followed it (median 4×), …". */
export function followedLine(slot: FollowedSlot): string {
  const total = slot.followed + slot.not + slot.unknown;
  if (slot.followed + slot.not === 0) {
    return `${LAYER_LABELS[slot.layer]}: none of your ${total} videos is measured yet, so code cannot tell.`;
  }
  const not = slot.not === 0 ? '0 did not' : `${slot.not} did not (${score(slot.medianScoreNot)})`;
  const unknown = slot.unknown === 0 ? '' : `, ${slot.unknown} not measured`;
  return `${LAYER_LABELS[slot.layer]}: ${slot.followed} of ${total} followed it (${score(slot.medianScoreFollowed)}), ${not}${unknown}.`;
}

/** One video's slots, followed and not. */
export function rowLine(row: FollowedRow): string {
  const names = (layers: FollowedRow['followed']) => layers.map((l) => LAYER_LABELS[l]).join(', ');
  const parts = [
    row.followed.length === 0 ? null : `Followed: ${names(row.followed)}`,
    row.not.length === 0 ? null : `Not: ${names(row.not)}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? 'Nothing code could check' : parts.join(' · ');
}
