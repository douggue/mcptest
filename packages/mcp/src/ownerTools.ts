import { parseChannelRef, type MapSnapshot } from '@jgtube/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolFailure } from './failure';
import { summarizeNearMisses } from './mapSummary';
import { summarizeNiches } from './nicheSummary';
import { NO_MAP_YET, requireChannelRef } from './readTools';
import { jsonResult } from './results';
import {
  DEFAULT_NEAR_MISSES,
  DEFAULT_NICHES,
  checkedArgs,
  getNearMissesArgs,
  listNichesArgs,
  setCompetitorStatusArgs,
  type GetNearMissesArgs,
  type ListNichesArgs,
  type SetCompetitorStatusArgs,
} from './schemas';
import type { ConnectorEngine } from './types';

/** Enough recent titles to tell what a channel is about. */
const NEAR_MISS_TITLES = 5;
const NOT_ON_MAP =
  'That channel is not on the latest map of this centre channel. Use get_map to see which are.';

function requireSnapshot(engine: ConnectorEngine, channel: string): MapSnapshot {
  requireChannelRef(channel);
  const snapshot = engine.findSnapshot(channel);
  if (!snapshot) throw new ToolFailure(NO_MAP_YET);
  return snapshot;
}

/** A stored channel's newest titles; null when its videos are not in the store. */
function recentTitles(engine: ConnectorEngine, channelId: string): readonly string[] | null {
  const found = engine.findChannelVideos(channelId);
  if (!found || found.videos.length === 0) return null;
  return [...found.videos]
    .sort((a, b) => a.ageDays - b.ageDays)
    .slice(0, NEAR_MISS_TITLES)
    .map((video) => video.title);
}

export function getNearMisses(engine: ConnectorEngine, input: GetNearMissesArgs): CallToolResult {
  const args = checkedArgs(getNearMissesArgs, input);
  const snapshot = requireSnapshot(engine, args.channel);
  return jsonResult(
    summarizeNearMisses(snapshot, {
      limit: args.limit ?? DEFAULT_NEAR_MISSES,
      recentTitles: (channelId) => recentTitles(engine, channelId),
    }),
  );
}

/** The id of the channel on the map that a handle, link or id refers to, or null. */
function channelIdOnMap(snapshot: MapSnapshot, channel: string): string | null {
  const ref = parseChannelRef(channel);
  if (ref.kind === 'id') return ref.id;
  const handle = ref.handle.toLowerCase();
  return snapshot.channels.find((entry) => entry.handle?.toLowerCase() === handle)?.id ?? null;
}

/**
 * Records the owner's say on one channel of a map, then reads the map again to
 * report how the channel counts now.
 */
export function setCompetitorStatus(
  engine: ConnectorEngine,
  input: SetCompetitorStatusArgs,
): CallToolResult {
  const args = checkedArgs(setCompetitorStatusArgs, input);
  requireChannelRef(args.channel);
  const before = requireSnapshot(engine, args.center);
  const channelId = channelIdOnMap(before, args.channel);
  const centerId = before.center.id;
  if (channelId === null || !engine.setCompetitorStatus(centerId, channelId, args.status)) {
    throw new ToolFailure(NOT_ON_MAP);
  }
  const after = engine.findSnapshot(centerId) ?? before;
  const entry = after.channels.find((candidate) => candidate.id === channelId);
  return jsonResult({
    center: { id: centerId, title: before.center.title },
    channel: { id: channelId, title: entry?.title ?? channelId },
    status: args.status,
    lookalike: entry !== undefined && entry.peer && !entry.removed,
  });
}

export function listNiches(engine: ConnectorEngine, input: ListNichesArgs): CallToolResult {
  const args = checkedArgs(listNichesArgs, input);
  return jsonResult(
    summarizeNiches(engine.listNiches(), {
      limit: args.limit ?? DEFAULT_NICHES,
      watchedOnly: args.watched_only ?? false,
    }),
  );
}
