import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMakeMap } from './crawlTool';
import { ToolFailure, plainMessage } from './failure';
import { getBreakouts, getChannelVideos, getMap, getThumbnailBoard } from './readTools';
import { failureResult } from './results';
import type {
  GetBreakoutsArgs,
  GetChannelVideosArgs,
  GetMapArgs,
  GetThumbnailBoardArgs,
  MakeMapArgs,
  ViewThumbnailsArgs,
} from './schemas';
import type { FetchImage } from './thumbnailImages';
import { viewThumbnails } from './thumbnailTool';
import type { ConnectorEngine, ToolContext } from './types';

export interface ToolDeps {
  readonly engine: ConnectorEngine;
  /** Replaces the network for thumbnail images; used by tests. */
  readonly fetchImage?: FetchImage;
  /** Where diagnostics go. Never standard output: that carries the protocol. */
  readonly log?: (line: string) => void;
}

export interface ToolHandlers {
  getMap(args: GetMapArgs): Promise<CallToolResult>;
  getBreakouts(args: GetBreakoutsArgs): Promise<CallToolResult>;
  getThumbnailBoard(args: GetThumbnailBoardArgs): Promise<CallToolResult>;
  viewThumbnails(args: ViewThumbnailsArgs): Promise<CallToolResult>;
  getChannelVideos(args: GetChannelVideosArgs): Promise<CallToolResult>;
  makeMap(args: MakeMapArgs, context?: ToolContext): Promise<CallToolResult>;
}

/** The default place for diagnostics. */
export const logToStderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * The six tools as plain functions. Every failure, expected or not, comes back
 * as an error result holding one clean sentence; unexpected ones are also logged.
 */
export function createToolHandlers(deps: ToolDeps): ToolHandlers {
  const { engine, fetchImage } = deps;
  const log = deps.log ?? logToStderr;
  const makeMap = createMakeMap(engine);

  const guarded = async (
    tool: string,
    work: () => CallToolResult | Promise<CallToolResult>,
  ): Promise<CallToolResult> => {
    try {
      return await work();
    } catch (error) {
      const message = plainMessage(error);
      if (!(error instanceof ToolFailure)) log(`jgtube ${tool} failed: ${message}`);
      return failureResult(message);
    }
  };

  return {
    getMap: (args) => guarded('get_map', () => getMap(engine, args)),
    getBreakouts: (args) => guarded('get_breakouts', () => getBreakouts(engine, args)),
    getThumbnailBoard: (args) =>
      guarded('get_thumbnail_board', () => getThumbnailBoard(engine, args)),
    viewThumbnails: (args) => guarded('view_thumbnails', () => viewThumbnails(fetchImage, args)),
    getChannelVideos: (args) => guarded('get_channel_videos', () => getChannelVideos(engine, args)),
    makeMap: (args, context) => guarded('make_map', () => makeMap(args, context)),
  };
}
