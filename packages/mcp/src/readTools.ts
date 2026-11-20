import { parseChannelRef } from '@jgtube/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolFailure } from './failure';
import { summarizeBreakouts, summarizeMap } from './mapSummary';
import { jsonResult } from './results';
import {
  DEFAULT_BOARD_CHANNELS,
  DEFAULT_BOARD_VIDEOS,
  DEFAULT_BREAKOUTS,
  DEFAULT_CHANNEL_VIDEOS,
  DEFAULT_MAP_CHANNELS,
  checkedArgs,
  getBreakoutsArgs,
  getChannelVideosArgs,
  getMapArgs,
  getThumbnailBoardArgs,
  type GetBreakoutsArgs,
  type GetChannelVideosArgs,
  type GetMapArgs,
  type GetThumbnailBoardArgs,
} from './schemas';
import type { ConnectorEngine } from './types';
import { summarizeBoard, summarizeChannelVideos } from './videoSummary';

export const NO_MAP_YET =
  'No map has been made for this channel yet. Use make_map to make one; it takes several minutes.';
const NOT_STORED =
  'This channel is not in the store yet. A channel is stored when it appears on a map made with make_map.';

/**
 * Fails with the reason when the text is not a channel handle, link or id, so
 * nothing the caller typed reaches the store or YouTube unchecked.
 */
export function requireChannelRef(channel: string, label = ''): void {
  try {
    parseChannelRef(channel);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Not a valid channel';
    throw new ToolFailure(`${label}${reason}`);
  }
}

/** Returns what was found, or fails with the sentence that says what to do about it. */
function found<T>(value: T | null, otherwise: string): T {
  if (value === null) throw new ToolFailure(otherwise);
  return value;
}

export function getMap(engine: ConnectorEngine, input: GetMapArgs): CallToolResult {
  const args = checkedArgs(getMapArgs, input);
  requireChannelRef(args.channel);
  const snapshot = found(engine.findSnapshot(args.channel), NO_MAP_YET);
  return jsonResult(
    summarizeMap(snapshot, {
      includeOthers: args.include_others ?? false,
      limit: args.limit ?? DEFAULT_MAP_CHANNELS,
    }),
  );
}

export function getBreakouts(engine: ConnectorEngine, input: GetBreakoutsArgs): CallToolResult {
  const args = checkedArgs(getBreakoutsArgs, input);
  requireChannelRef(args.channel);
  const snapshot = found(engine.findSnapshot(args.channel), NO_MAP_YET);
  return jsonResult(
    summarizeBreakouts(snapshot, {
      lookalikesOnly: args.lookalikes_only ?? true,
      limit: args.limit ?? DEFAULT_BREAKOUTS,
    }),
  );
}

export function getThumbnailBoard(
  engine: ConnectorEngine,
  input: GetThumbnailBoardArgs,
): CallToolResult {
  const args = checkedArgs(getThumbnailBoardArgs, input);
  requireChannelRef(args.channel);
  const board = found(engine.findThumbnailBoard(args.channel), NO_MAP_YET);
  return jsonResult(
    summarizeBoard(board, {
      channels: args.channels ?? DEFAULT_BOARD_CHANNELS,
      perChannel: args.per_channel ?? DEFAULT_BOARD_VIDEOS,
    }),
  );
}

export function getChannelVideos(
  engine: ConnectorEngine,
  input: GetChannelVideosArgs,
): CallToolResult {
  const args = checkedArgs(getChannelVideosArgs, input);
  requireChannelRef(args.channel);
  const videos = found(engine.findChannelVideos(args.channel), NOT_STORED);
  return jsonResult(
    summarizeChannelVideos(videos, {
      order: args.order ?? 'strongest',
      limit: args.limit ?? DEFAULT_CHANNEL_VIDEOS,
    }),
  );
}
