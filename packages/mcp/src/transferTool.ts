import { placeNamed } from '@jgtube/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolFailure } from './failure';
import { requireChannelRef } from './readTools';
import { jsonResult } from './results';
import {
  DEFAULT_TRANSFERS,
  PLACE_RULE,
  checkedArgs,
  listTransferOpportunitiesArgs,
  type ListTransferOpportunitiesArgs,
} from './schemas';
import { summarizeTransfers } from './transferSummary';
import type { ConnectorEngine } from './types';

/**
 * Ideas several channels made, judged as transfer opportunities for the
 * owner's place, or the title formats used for several subjects. The channel
 * and the place are checked before the store is read.
 */
export function listTransferOpportunities(
  engine: ConnectorEngine,
  input: ListTransferOpportunitiesArgs,
): CallToolResult {
  const args = checkedArgs(listTransferOpportunitiesArgs, input);
  if (args.channel !== undefined) requireChannelRef(args.channel);
  const place = args.place === undefined ? null : placeNamed(args.place);
  if (args.place !== undefined && place === null) throw new ToolFailure(PLACE_RULE);
  const list = engine.listTransfers({
    ...(args.channel === undefined ? {} : { channel: args.channel }),
    ...(place === null ? {} : { place }),
  });
  return jsonResult(
    summarizeTransfers(list, {
      show: args.show ?? 'opportunities',
      limit: args.limit ?? DEFAULT_TRANSFERS,
    }),
  );
}
