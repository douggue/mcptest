import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { plainMessage } from './failure';
import {
  THUMBNAIL_REVIEW_DESCRIPTION,
  THUMBNAIL_REVIEW_PROMPT,
  thumbnailReviewText,
} from './prompt';
import {
  getBreakoutsShape,
  getChannelVideosShape,
  getMapShape,
  getNearMissesShape,
  getThumbnailBoardShape,
  listNichesShape,
  listTransferOpportunitiesShape,
  makeMapShape,
  setCompetitorStatusShape,
  viewThumbnailsShape,
} from './schemas';
import { TOOL_TEXT } from './toolText';
import { createToolHandlers, logToStderr, type ToolDeps, type ToolHandlers } from './tools';
import type { ToolContext } from './types';

const SERVER_INFO = { name: 'jgtube', version: '0.1.0' };

const INSTRUCTIONS =
  'Jgtube holds a YouTube channel’s competitor research: the channels like it and which of their videos took off. ' +
  'Start with get_map, then get_breakouts for what is working now. For thumbnails use get_thumbnail_board, then ' +
  'view_thumbnails to look at the pictures. get_near_misses lists channels left out only for wording their titles ' +
  'differently; set_competitor_status records a decision the owner has agreed to. list_niches shows new or small ' +
  'channels with a video that took off; list_transfer_opportunities shows ideas that won for another country ' +
  'and are untried or weak for the owner’s. Scores are multiples of a channel’s usual views. ' +
  'Only make_map reads YouTube, and it takes minutes; everything else reads the local store.';

/** Reads only the store. */
const READS_STORE = { readOnlyHint: true, openWorldHint: false };
/** Reads from the internet and changes nothing. */
const READS_INTERNET = { readOnlyHint: true, openWorldHint: true };
/** Adds to the store from the internet; never deletes. */
const ADDS_TO_STORE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
/** Changes one stored choice of the owner's; repeating it changes nothing more, and it can be undone. */
const CHANGES_A_CHOICE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Progress goes only to a client that sent a token asking for it. */
function progressContext(extra: Extra, log: (line: string) => void): ToolContext {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return {};
  return {
    reportProgress: ({ progress, message }) => {
      extra
        .sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress, message },
        })
        .catch((error: unknown) => log(`jgtube progress not sent: ${plainMessage(error)}`));
    },
  };
}

function registerReadTools(server: McpServer, tools: ToolHandlers): void {
  server.registerTool(
    'get_map',
    { ...TOOL_TEXT.get_map, inputSchema: getMapShape, annotations: READS_STORE },
    (args) => tools.getMap(args),
  );
  server.registerTool(
    'get_breakouts',
    { ...TOOL_TEXT.get_breakouts, inputSchema: getBreakoutsShape, annotations: READS_STORE },
    (args) => tools.getBreakouts(args),
  );
  server.registerTool(
    'get_thumbnail_board',
    {
      ...TOOL_TEXT.get_thumbnail_board,
      inputSchema: getThumbnailBoardShape,
      annotations: READS_STORE,
    },
    (args) => tools.getThumbnailBoard(args),
  );
  server.registerTool(
    'get_channel_videos',
    {
      ...TOOL_TEXT.get_channel_videos,
      inputSchema: getChannelVideosShape,
      annotations: READS_STORE,
    },
    (args) => tools.getChannelVideos(args),
  );
}

function registerOwnerTools(server: McpServer, tools: ToolHandlers): void {
  server.registerTool(
    'get_near_misses',
    { ...TOOL_TEXT.get_near_misses, inputSchema: getNearMissesShape, annotations: READS_STORE },
    (args) => tools.getNearMisses(args),
  );
  server.registerTool(
    'set_competitor_status',
    {
      ...TOOL_TEXT.set_competitor_status,
      inputSchema: setCompetitorStatusShape,
      annotations: CHANGES_A_CHOICE,
    },
    (args) => tools.setCompetitorStatus(args),
  );
  server.registerTool(
    'list_niches',
    { ...TOOL_TEXT.list_niches, inputSchema: listNichesShape, annotations: READS_STORE },
    (args) => tools.listNiches(args),
  );
  server.registerTool(
    'list_transfer_opportunities',
    {
      ...TOOL_TEXT.list_transfer_opportunities,
      inputSchema: listTransferOpportunitiesShape,
      annotations: READS_STORE,
    },
    (args) => tools.listTransferOpportunities(args),
  );
}

function registerNetworkTools(
  server: McpServer,
  tools: ToolHandlers,
  log: (line: string) => void,
): void {
  server.registerTool(
    'view_thumbnails',
    { ...TOOL_TEXT.view_thumbnails, inputSchema: viewThumbnailsShape, annotations: READS_INTERNET },
    (args) => tools.viewThumbnails(args),
  );
  server.registerTool(
    'make_map',
    { ...TOOL_TEXT.make_map, inputSchema: makeMapShape, annotations: ADDS_TO_STORE },
    (args, extra) => tools.makeMap(args, progressContext(extra, log)),
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    THUMBNAIL_REVIEW_PROMPT,
    {
      title: 'Thumbnail review',
      description: THUMBNAIL_REVIEW_DESCRIPTION,
      argsSchema: {
        channel: z.string().describe('Your channel: @handle, channel URL or channel id.'),
      },
    },
    ({ channel }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: thumbnailReviewText(channel) } }],
    }),
  );
}

const TOOL_NAMES = /^[a-z_]+(?:,[a-z_]+)*$/;

/**
 * The tools named by the JGTUBE_TOOLS setting, or null when it is not set and
 * every tool is offered. The app sets it when it starts the connector for an
 * analysis, so that run is offered the tools it needs and no others. A setting
 * that cannot be read is an error, never "every tool".
 */
export function onlyTools(setting: string | undefined): ReadonlySet<string> | null {
  if (setting === undefined) return null;
  if (!TOOL_NAMES.test(setting)) {
    throw new Error(
      'JGTUBE_TOOLS must be tool names separated by commas, such as get_map,list_niches',
    );
  }
  return new Set(setting.split(','));
}

/** A server that takes only the named tools; the rest are never offered or callable. */
function limitedTo(server: McpServer, only: ReadonlySet<string> | null): McpServer {
  if (only === null) return server;
  const register = server.registerTool.bind(server) as (...values: unknown[]) => unknown;
  const registerTool = (name: string, ...rest: unknown[]): unknown =>
    only.has(name) ? register(name, ...rest) : undefined;
  return { registerTool } as unknown as McpServer;
}

/**
 * The connector: its tools and one prompt, ready to be connected to a
 * transport. With `only`, just those tools.
 */
export function createConnectorServer(
  deps: ToolDeps,
  only: ReadonlySet<string> | null = null,
): McpServer {
  const log = deps.log ?? logToStderr;
  const tools = createToolHandlers({ ...deps, log });
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const tooled = limitedTo(server, only);
  registerReadTools(tooled, tools);
  registerOwnerTools(tooled, tools);
  registerNetworkTools(tooled, tools, log);
  registerPrompts(server);
  return server;
}
