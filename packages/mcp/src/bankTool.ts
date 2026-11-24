import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { BankVideo } from '@jgtube/core';
import { parseBankQuery } from '@jgtube/core/src/bank/query';
import { z } from 'zod';
import { plainMessage } from './failure';
import { failureResult, jsonResult, oneDecimal, withoutAbsent } from './results';
import { checkedArgs } from './schemas';
import type { ConnectorEngine } from './types';

/**
 * search_outlier_bank: the owner's outlier bank as a read-only tool. Every
 * stored video across every map, saved channel, niche list, pasted channel
 * and refresh, with its outlier score worked out in code. Reads the local
 * store only; it never reads YouTube and never changes anything.
 */
export const SEARCH_OUTLIER_BANK = 'search_outlier_bank';
export const DEFAULT_BANK_RESULTS = 15;
const MAX_BANK_RESULTS = 30;

const keys = (values: readonly [string, ...string[]], what: string) =>
  z.array(z.enum(values)).max(values.length).optional().describe(what);

export const searchOutlierBankShape = {
  min_score: z
    .union([z.literal(2), z.literal(5), z.literal(10), z.literal(50), z.literal(100)])
    .optional()
    .describe('Keep videos at least this many times their channel’s usual views (2, 5, 10, 50 or 100).'),
  max_age_days: z
    .union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)])
    .optional()
    .describe('Keep videos uploaded within this many days (7, 30, 90 or 365). Leave out for all.'),
  views: keys(['under-10k', '10k-100k', '100k-1m', '1m-plus'], 'View ranges to keep.'),
  length: keys(['shorts', 'under-8', '8-20', '20-plus'], 'Lengths to keep (Shorts: a minute or less; minutes otherwise).'),
  channel_size: keys(
    ['under-1k', '1k-10k', '10k-100k', '100k-1m', '1m-plus', 'hidden'],
    'Channel sizes in subscribers to keep.',
  ),
  topics: z.array(z.string().min(1).max(40)).max(13).optional().describe('Topic labels to keep, as the results name them (such as "Cars").'),
  alphabets: z.array(z.string().min(1).max(20)).max(10).optional().describe('Title alphabets to keep: "latin", "Cyrillic", "Arabic", "CJK"…'),
  countries: z.array(z.string().regex(/^(?:[A-Z]{2}|unknown)$/)).max(20).optional().describe('Two-letter countries the channels set, or "unknown".'),
  monetized: keys(['monetized', 'likely', 'not-yet', 'no-sign', 'not-checked'], 'Money signs to keep.'),
  source: z.enum(['maps', 'elsewhere']).optional().describe('"maps": channels on the owner’s maps; "elsewhere": the rest.'),
  collection: z.string().min(1).max(60).optional().describe('Only videos in the owner’s collection of this name.'),
  title_has: z.string().max(100).optional().describe('Words every title kept must hold.'),
  title_lacks: z.string().max(100).optional().describe('Words no title kept may hold.'),
  sort: z.enum(['score', 'views', 'newest', 'pace']).optional().describe('score (default), views, newest or pace (views a day).'),
  limit: z.number().int().min(1).max(MAX_BANK_RESULTS).optional().describe(`At most ${MAX_BANK_RESULTS}; ${DEFAULT_BANK_RESULTS} by default.`),
};
const bankArgs = z.object(searchOutlierBankShape);
export type SearchOutlierBankArgs = z.input<typeof bankArgs>;

type BankToolEngine = Pick<ConnectorEngine, 'bank'>;

const NO_COLLECTION = 'The owner has no collection of that name.';

function queryOf(engine: BankToolEngine, args: z.output<typeof bankArgs>): URLSearchParams {
  const join = (values?: readonly string[]) => (values && values.length > 0 ? values.join(',') : null);
  const collection =
    args.collection === undefined
      ? null
      : engine.bank.collections
          .list()
          .find((one) => one.name.toLowerCase() === args.collection?.trim().toLowerCase());
  if (args.collection !== undefined && !collection) throw new Error(NO_COLLECTION);
  const pairs: readonly (readonly [string, string | null])[] = [
    ['score', args.min_score === undefined ? null : String(args.min_score)],
    ['age', args.max_age_days === undefined ? null : String(args.max_age_days)],
    ['views', join(args.views)],
    ['length', join(args.length)],
    ['size', join(args.channel_size)],
    ['topic', join(args.topics)],
    ['language', join(args.alphabets)],
    ['country', join(args.countries)],
    ['money', join(args.monetized)],
    ['source', args.source ?? null],
    ['collection', collection ? `c${collection.id}` : null],
    ['contains', args.title_has ?? null],
    ['excludes', args.title_lacks ?? null],
    ['sort', args.sort ?? null],
  ];
  return new URLSearchParams(pairs.flatMap(([key, value]) => (value === null ? [] : [[key, value]])));
}

function row(video: BankVideo) {
  const { channel } = video;
  return withoutAbsent({
    id: video.videoId,
    t: video.title,
    x: video.score === null ? null : oneDecimal(video.score),
    usual: video.baseline === null ? null : Math.round(video.baseline),
    n: video.sampleSize,
    caution: video.caution,
    views: video.views,
    days: Math.floor(video.ageDays),
    secs: video.durationSeconds,
    short: video.isShort ? true : null,
    vpd: Math.round(video.viewsPerDay),
    ch: channel.title,
    cid: channel.id,
    subs: channel.subscribers,
    topic: channel.topic.label,
    country: channel.country,
    alphabet: channel.alphabet === 'latin' ? null : channel.alphabet,
    money: channel.money,
    close: channel.closeness ? `${channel.closeness.tier} to ${channel.closeness.centerTitle}` : null,
  });
}

export function searchOutlierBank(
  engine: BankToolEngine,
  input: SearchOutlierBankArgs,
): CallToolResult {
  try {
    const args = checkedArgs(bankArgs, input);
    const limit = args.limit ?? DEFAULT_BANK_RESULTS;
    const state = parseBankQuery(queryOf(engine, args));
    const { page } = engine.bank.look(state, { offset: 0, limit });
    return jsonResult({
      total: page.total,
      matched: page.matched,
      videos: page.videos.map(row),
      more: Math.max(0, page.matched - page.videos.length),
    });
  } catch (error) {
    return failureResult(plainMessage(error));
  }
}

const DESCRIPTION =
  'Searches the owner’s outlier bank: every video Jgtube has stored, from every map, saved channel, niche ' +
  'list, pasted channel and refresh, not just one map. Each has an outlier score worked out in code: views ' +
  'over the channel’s usual views at the same age (x, with usual, the median it divides by, and n, how many ' +
  'videos that median came from; caution few-videos or low-baseline says to read it with care; no x means too ' +
  'few videos to compare against). Also views, days since upload, secs (length), short, vpd (views a day, an ' +
  'average since upload, not a measured pace), the channel (ch, cid, subs), topic (a label from a fixed word ' +
  'table), country, alphabet when not Latin, money (public signs only, never a yes from YouTube) and close ' +
  '(the channel’s tier on one of the owner’s maps). Answers total (videos in the bank), matched, the videos and ' +
  'more (matched but not shown). Reads the local store only; nothing is fetched or changed. Numbers are stored ' +
  'readings, not forecasts.';

export function registerBankTool(server: McpServer, engine: BankToolEngine): void {
  server.registerTool(
    SEARCH_OUTLIER_BANK,
    {
      title: 'Search the outlier bank',
      description: DESCRIPTION,
      inputSchema: searchOutlierBankShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => searchOutlierBank(engine, args),
  );
}
