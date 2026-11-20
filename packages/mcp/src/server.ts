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
  getThumbnailBoardShape,
  makeMapShape,
  viewThumbnailsShape,
} from './schemas';
import { TOOL_TEXT } from './toolText';
import { createToolHandlers, logToStderr, type ToolDeps, type ToolHandlers } from './tools';
import type { ToolContext } from './types';

const SERVER_INFO = { name: 'jgtube', version: '0.1.0' };

const INSTRUCTIONS =
  'Jgtube holds a YouTube channel’s competitor research: the channels like it and which of their videos took off. ' +
  'Start with get_map, then get_breakouts for what is working now. For thumbnails use get_thumbnail_board, then ' +
  'view_thumbnails to look at the pictures. Scores are multiples of a channel’s usual views. ' +
  'Only make_map reads YouTube, and it takes minutes; everything else reads the local store.';

/** Reads only the store. */
const READS_STORE = { readOnlyHint: true, openWorldHint: false };
/** Reads from the internet and changes nothing. */
const READS_INTERNET = { readOnlyHint: true, openWorldHint: true };
/** Adds to the store from the internet; never deletes. */
const ADDS_TO_STORE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

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

/** The connector: six tools and one prompt, ready to be connected to a transport. */
export function createConnectorServer(deps: ToolDeps): McpServer {
  const log = deps.log ?? logToStderr;
  const tools = createToolHandlers({ ...deps, log });
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerReadTools(server, tools);
  registerNetworkTools(server, tools, log);
  registerPrompts(server);
  return server;
}
