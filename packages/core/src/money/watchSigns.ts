/**
 * The public signs of earning on one watch page, read from the data the page
 * embeds. Two are looked for:
 *
 * - Memberships: the page offers a "Join" button for the channel. Signed out,
 *   YouTube sends the button's tip ("Join this channel and unlock members-only
 *   perks", aimed at `sponsorships-button`); signed in, the owner box carries a
 *   `sponsorButton`. Memberships need the YouTube Partner Program.
 * - Ads: the player's answer lists ad placements. YouTube can show ads on a
 *   channel outside the Partner Program, so this is never proof. The player
 *   answers only when the page is playable; otherwise ads are unknown.
 *
 * The page is untrusted: every access is guarded and nothing here throws.
 */
import { at, isRecord } from '../sources/mappers';
import { CHANNEL_ID_PATTERN } from '../sources/parse';
import { readAssignedObject } from './embeddedJson';

export type AdsSeen = 'shown' | 'none' | 'unknown';

export interface WatchSigns {
  /** The channel the page says the video belongs to; null when it could not be read. */
  readonly ownerId: string | null;
  readonly memberships: boolean;
  readonly ads: AdsSeen;
}

const JOIN_TARGET = 'sponsorships-button';
const PLAYABLE = 'OK';
/** A watch page's data has some tens of thousands of nodes; this bounds a hostile one. */
const MAX_NODES = 400_000;

interface Found {
  readonly ownerId: string | null;
  readonly memberships: boolean;
}

const channelIdOf = (value: unknown): string | null =>
  typeof value === 'string' && CHANNEL_ID_PATTERN.test(value) ? value : null;

/** Walks the page's data once for the owner box and the Join button or its tip. */
function walk(root: unknown): Found {
  let ownerId: string | null = null;
  let memberships = false;
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length > 0 && seen < MAX_NODES) {
    const node = stack.pop();
    seen += 1;
    if (Array.isArray(node)) {
      stack.push(...(node as unknown[]));
      continue;
    }
    if (!isRecord(node)) continue;
    if (node['targetId'] === JOIN_TARGET || isRecord(node['sponsorButton'])) memberships = true;
    const owner = node['videoOwnerRenderer'];
    ownerId ??= channelIdOf(at(owner, 'navigationEndpoint', 'browseEndpoint', 'browseId'));
    stack.push(...Object.values(node));
  }
  return { ownerId, memberships };
}

const listed = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

function adsOf(player: unknown): AdsSeen {
  if (at(player, 'playabilityStatus', 'status') !== PLAYABLE) return 'unknown';
  return listed(at(player, 'adPlacements')) || listed(at(player, 'playerAds')) ? 'shown' : 'none';
}

/** What one watch page shows of memberships and ads, and whose video it is. */
export function readWatchSigns(html: string): WatchSigns {
  const player = readAssignedObject(html, 'ytInitialPlayerResponse');
  const found = walk(readAssignedObject(html, 'ytInitialData'));
  return {
    ownerId: found.ownerId ?? channelIdOf(at(player, 'videoDetails', 'channelId')),
    memberships: found.memberships,
    ads: adsOf(player),
  };
}
