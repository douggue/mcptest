import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolFailure, plainMessage } from './failure';
import { failureResult, imageBlock } from './results';
import { checkedArgs } from './schemas';
import type { ConnectorEngine } from './types';

/**
 * The tools "Suggest a mix" reads with: the owner's shelf (each ingredient
 * with the evidence code counted) and its pictures, by names made in code.
 * Both read the local store only.
 */

const FORMAT_RULE = 'format is the format number given in the question.';
const NAME_RULE = 'names are picture names from the question, such as i12-1.jpg.';
const MAX_NAMES = 8;

export const getFormatShelfShape = {
  format: z
    .number({ error: FORMAT_RULE })
    .int(FORMAT_RULE)
    .positive(FORMAT_RULE)
    .describe('The format number.'),
};
export const viewFormatPicturesShape = {
  names: z
    .array(z.string().regex(/^i\d{1,9}-\d{1,2}\.(?:jpg|png|webp)$/, NAME_RULE), {
      error: NAME_RULE,
    })
    .min(1)
    .max(MAX_NAMES)
    .describe(`Up to ${MAX_NAMES} picture names to look at.`),
};
const CHANNEL_RULE = 'channel is the channel id (UC… with 24 characters) given in the question.';
export const getActiveFormatShape = {
  channel: z
    .string({ error: CHANNEL_RULE })
    .regex(/^UC[\w-]{22}$/, CHANNEL_RULE)
    .describe('The channel id.'),
};
const activeArgs = z.object(getActiveFormatShape);
export type GetActiveFormatArgs = z.input<typeof activeArgs>;
export const NO_ACTIVE_FORMAT = 'This channel has no active format: work as you would without one.';
const shelfArgs = z.object(getFormatShelfShape);
const pictureArgs = z.object(viewFormatPicturesShape);
export type GetFormatShelfArgs = z.input<typeof shelfArgs>;
export type ViewFormatPicturesArgs = z.input<typeof pictureArgs>;

const READS_STORE = { readOnlyHint: true, openWorldHint: false };
type FormatToolsEngine = Pick<ConnectorEngine, 'formatBuilder'>;

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
const typeOf = (name: string): string =>
  TYPES[name.slice(name.lastIndexOf('.') + 1) as keyof typeof TYPES];

export function getFormatShelf(
  engine: FormatToolsEngine,
  input: GetFormatShelfArgs,
): CallToolResult {
  try {
    const args = checkedArgs(shelfArgs, input);
    const shelf = engine.formatBuilder.shelfForMix(args.format);
    if (shelf === null) throw new ToolFailure('There is no such format.');
    return { content: [{ type: 'text', text: JSON.stringify(shelf) }] };
  } catch (error) {
    return failureResult(plainMessage(error));
  }
}

export async function viewFormatPictures(
  engine: FormatToolsEngine,
  input: ViewFormatPicturesArgs,
): Promise<CallToolResult> {
  try {
    const args = checkedArgs(pictureArgs, input);
    const content: CallToolResult['content'] = [];
    for (const name of args.names) {
      const bytes = await engine.formatBuilder.mixPicture(name);
      content.push(
        { type: 'text', text: bytes === null ? `${name}: there is no such picture.` : name },
        ...(bytes === null ? [] : [imageBlock({ bytes, mimeType: typeOf(name) })]),
      );
    }
    if (!content.some((block) => block.type === 'image')) {
      throw new ToolFailure('None of those pictures are on the shelf.');
    }
    return { content };
  } catch (error) {
    return failureResult(plainMessage(error));
  }
}

/** The channel's active format as the other runs read it; a channel without one says so. */
export function getActiveFormat(
  engine: FormatToolsEngine,
  input: GetActiveFormatArgs,
): CallToolResult {
  try {
    const args = checkedArgs(activeArgs, input);
    const plan = engine.formatBuilder.activePlan(args.channel);
    const answer =
      plan === null ? { active: false, note: NO_ACTIVE_FORMAT } : { active: true, plan };
    return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
  } catch (error) {
    return failureResult(plainMessage(error));
  }
}

/** Registers the tools; a server limited to other tools never offers them. */
export function registerFormatTools(server: McpServer, engine: FormatToolsEngine): void {
  server.registerTool(
    'get_format_shelf',
    {
      title: 'Read the format shelf',
      description:
        'The owner’s format shelf and one format: each ingredient (title formula, hook, structure, pacing, ' +
        'visual style, motion, thumbnail layout, sound, other) with the evidence code counted (videos, ' +
        'channels, score, measured numbers with their method), whether it is proven, and the names of its ' +
        'pictures (look at them with view_format_pictures). Reads the local store only.',
      inputSchema: getFormatShelfShape,
      annotations: READS_STORE,
    },
    (args) => getFormatShelf(engine, args),
  );
  server.registerTool(
    'get_active_format',
    {
      title: 'Read the channel’s active format',
      description:
        'The format the owner made active for a channel: its title formulas (from the slot, counted in ' +
        'code, or from its Bible), its hook with beats, chapter beats, words and cuts a minute measured ' +
        'in code, pacing rules, visual style, thumbnail layouts with prompts, and the measured palette. ' +
        'Text from the Bible is an AI’s reading. Says so when the channel has none. Reads the local store only.',
      inputSchema: getActiveFormatShape,
      annotations: READS_STORE,
    },
    (args) => getActiveFormat(engine, args),
  );
  server.registerTool(
    'view_format_pictures',
    {
      title: 'Look at the shelf’s pictures',
      description:
        'Pictures of the shelf’s ingredients by name (i12-1.jpg is the first picture of ingredient 12): ' +
        'teardown keyframes and frame strips, and the owner’s own pictures. Reads the local store only.',
      inputSchema: viewFormatPicturesShape,
      annotations: READS_STORE,
    },
    (args) => viewFormatPictures(engine, args),
  );
}
