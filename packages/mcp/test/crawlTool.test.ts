import {
  CRAWL_DEFAULT_DEPTH,
  CRAWL_DEFAULT_MAX_CHANNELS,
  CRAWL_MAX_CHANNELS_ASKED,
  CRAWL_MAX_DEPTH,
  CRAWL_MIN_CHANNELS_ASKED,
  ReadingElsewhereError,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { makeMapShape } from '../src/schemas';
import { TOOL_TEXT } from '../src/toolText';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import type { CrawlOutcome, ProgressUpdate } from '../src/types';
import { BETA_ID, CENTER_ID, FakeEngine, jsonOf, textOf } from './fakes';

let engine: FakeEngine;
let tools: ToolHandlers;

beforeEach(() => {
  engine = new FakeEngine();
  tools = createToolHandlers({ engine, log: () => {} });
});

describe('make_map', () => {
  test('crawls with the default depth and returns the new map’s summary', async () => {
    const result = await tools.makeMap({ channel: '@mychannel' });

    expect(result.isError).toBeUndefined();
    expect(engine.crawls).toEqual([{ channel: '@mychannel', depth: 2, choices: {} }]);
    // The summary is read back by the id the crawl resolved, not by the text typed in.
    expect(engine.lookups).toEqual([CENTER_ID]);
    const data = jsonOf(result);
    expect(data['center']).toMatchObject({ id: CENTER_ID });
    expect(data['counts']).toMatchObject({ lookalikes: 2 });
    expect(data).not.toHaveProperty('warnings');
  });

  test('passes the model channel, depth and size on', async () => {
    await tools.makeMap({ channel: '@mychannel', model: BETA_ID, depth: 3, max_channels: 300 });

    expect(engine.crawls).toEqual([
      { channel: '@mychannel', depth: 3, choices: { model: BETA_ID, maxChannels: 300 } },
    ]);
  });

  test('reports progress in words, counting upwards', async () => {
    const updates: ProgressUpdate[] = [];

    await tools.makeMap(
      { channel: '@mychannel' },
      { reportProgress: (update) => updates.push(update) },
    );

    expect(updates).toEqual([
      { progress: 1, message: 'Reading recommendations, step 1: 1 channels so far' },
      { progress: 2, message: 'Reading channels: 9 so far' },
      { progress: 3, message: 'Done: 9 channels' },
    ]);
  });

  test('returns warnings, cleaned and capped', async () => {
    const warnings = Array.from({ length: 13 }, (_, n) => `Could not read channel ${n}\u0007`);
    engine.outcome = () => Promise.resolve({ centerChannelId: CENTER_ID, warnings });

    const data = jsonOf(await tools.makeMap({ channel: '@mychannel' }));

    expect(data['warnings']).toHaveLength(10);
    expect((data['warnings'] as string[])[0]).toBe('Could not read channel 0');
    expect(data['moreWarnings']).toBe(3);
  });

  test('refuses a second crawl while one is running, then allows one after it ends', async () => {
    let finish: (outcome: CrawlOutcome) => void = () => {};
    engine.outcome = () => new Promise((resolve) => (finish = resolve));
    const first = tools.makeMap({ channel: '@mychannel' });

    const second = await tools.makeMap({ channel: '@mychannel' });

    expect(second.isError).toBe(true);
    expect(textOf(second)).toBe(
      'A map is already being made. Wait for it to finish, then use get_map.',
    );
    finish({ centerChannelId: CENTER_ID, warnings: [] });
    expect((await first).isError).toBeUndefined();
    engine.outcome = () => Promise.resolve({ centerChannelId: CENTER_ID, warnings: [] });
    expect((await tools.makeMap({ channel: '@mychannel' })).isError).toBeUndefined();
  });

  test('says so when Jgtube is reading YouTube in another window or process', async () => {
    engine.outcome = () => Promise.reject(new ReadingElsewhereError());

    const refused = await tools.makeMap({ channel: '@mychannel' });

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe(
      'Jgtube is already reading YouTube in another window or process. Wait for it to finish, then try again.',
    );
  });

  test('tells the reader in its description that it waits its turn', () => {
    expect(TOOL_TEXT.make_map.description).toMatch(/another window or process/);
  });

  test('a failed crawl is one clean sentence and frees the way for the next', async () => {
    engine.outcome = () =>
      Promise.reject(new Error('YouTube refused the request at /root/app/src/x.ts:12\nstack'));

    const failed = await tools.makeMap({ channel: '@mychannel' });

    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toMatch(/^YouTube refused the request at <path>/);
    expect(textOf(failed)).not.toContain('\n');
    engine.outcome = () => Promise.resolve({ centerChannelId: CENTER_ID, warnings: [] });
    expect((await tools.makeMap({ channel: '@mychannel' })).isError).toBeUndefined();
  });

  test.each([
    [{ channel: 'not a channel!' }, /^Not a valid YouTube channel/],
    [{ channel: '@mychannel', model: 'not a channel!' }, /^Model channel: Not a valid YouTube/],
    [{ channel: '@mychannel', depth: 4 }, /^depth is a whole number from 1 to 3/],
    [{ channel: '@mychannel', max_channels: 5 }, /^max_channels is a whole number from 10 to 600/],
  ])('refuses %j before anything is requested', async (args, message) => {
    const result = await tools.makeMap(args);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(message);
    expect(engine.crawls).toEqual([]);
  });

  test('takes its limits and defaults from the engine, not from a copy of them', async () => {
    const most = { depth: CRAWL_MAX_DEPTH, max_channels: CRAWL_MAX_CHANNELS_ASKED };
    expect((await tools.makeMap({ channel: '@mychannel', ...most })).isError).toBeUndefined();
    const tooDeep = await tools.makeMap({ channel: '@mychannel', depth: CRAWL_MAX_DEPTH + 1 });
    const tooLarge = await tools.makeMap({
      channel: '@mychannel',
      max_channels: CRAWL_MAX_CHANNELS_ASKED + 1,
    });

    expect(textOf(tooDeep)).toBe(`depth is a whole number from 1 to ${CRAWL_MAX_DEPTH}.`);
    expect(textOf(tooLarge)).toBe(
      `max_channels is a whole number from ${CRAWL_MIN_CHANNELS_ASKED} to ${CRAWL_MAX_CHANNELS_ASKED}.`,
    );
    expect(makeMapShape.max_channels.description).toContain(
      `Default ${CRAWL_DEFAULT_MAX_CHANNELS}.`,
    );
    expect(makeMapShape.depth.description).toContain(`Default ${CRAWL_DEFAULT_DEPTH};`);
  });

  test('says so when the new map cannot be read back', async () => {
    engine.stored = null;

    const result = await tools.makeMap({ channel: '@mychannel' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('The map was made but could not be read back. Try get_map.');
  });
});
