import type { CrawlProgress } from '@jgtube/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolFailure, plainMessage } from './failure';
import { summarizeMap } from './mapSummary';
import { requireChannelRef } from './readTools';
import { capped, jsonResult } from './results';
import {
  DEFAULT_DEPTH,
  DEFAULT_MAP_CHANNELS,
  checkedArgs,
  makeMapArgs,
  type MakeMapArgs,
} from './schemas';
import type { ConnectorEngine, ToolContext } from './types';

const MAX_WARNINGS = 10;
const ALREADY_RUNNING = 'A map is already being made. Wait for it to finish, then use get_map.';
const NOT_READ_BACK = 'The map was made but could not be read back. Try get_map.';

export type MakeMap = (input: MakeMapArgs, context?: ToolContext) => Promise<CallToolResult>;

function progressMessage(progress: CrawlProgress): string {
  if (progress.stage === 'reading-recommendations') {
    const step = progress.step === undefined ? '' : `, step ${progress.step}`;
    return `Reading recommendations${step}: ${progress.channels} channels so far`;
  }
  return progress.stage === 'reading-channels'
    ? `Reading channels: ${progress.channels} so far`
    : `Done: ${progress.channels} channels`;
}

/** Turns the crawl's events into numbered updates, for a client that asked for them. */
function progressReporter(context: ToolContext): (progress: CrawlProgress) => void {
  let sent = 0;
  return (progress) => {
    sent += 1;
    context.reportProgress?.({ progress: sent, message: progressMessage(progress) });
  };
}

function warningList(warnings: readonly string[]): Record<string, unknown> {
  if (warnings.length === 0) return {};
  const { shown, more } = capped(warnings, MAX_WARNINGS);
  // Warnings can quote text read from YouTube, so they are cleaned like errors.
  return { warnings: shown.map(plainMessage), ...(more > 0 ? { moreWarnings: more } : {}) };
}

/**
 * Makes the tool that crawls a new map. One crawl runs at a time in this
 * process: a crawl is hundreds of requests to YouTube and two would double the rate.
 */
export function createMakeMap(engine: ConnectorEngine): MakeMap {
  let running = false;

  return async (input, context = {}) => {
    const args = checkedArgs(makeMapArgs, input);
    requireChannelRef(args.channel);
    if (args.model !== undefined) requireChannelRef(args.model, 'Model channel: ');
    if (running) throw new ToolFailure(ALREADY_RUNNING);

    running = true;
    try {
      const outcome = await engine.crawl(
        args.channel,
        args.depth ?? DEFAULT_DEPTH,
        progressReporter(context),
        {
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.max_channels === undefined ? {} : { maxChannels: args.max_channels }),
        },
      );
      const snapshot = engine.findSnapshot(outcome.centerChannelId);
      if (!snapshot) throw new ToolFailure(NOT_READ_BACK);
      return jsonResult({
        ...summarizeMap(snapshot, { includeOthers: false, limit: DEFAULT_MAP_CHANNELS }),
        ...warningList(outcome.warnings),
      });
    } finally {
      running = false;
    }
  };
}
