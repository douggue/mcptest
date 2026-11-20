import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelSnapshot, SidebarItem, YouTubeSource } from '@jgtube/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createConnectorEngine, type RunningConnectorEngine } from '../src/connectorEngine';
import { createConnectorServer } from '../src/server';
import { jsonOf, textOf } from './fakes';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => letter.repeat(10) + String(n);
/** C is the centre; YouTube shows A and B beside it, and D beside A. */
const links: Record<string, readonly string[]> = { C: ['A', 'B'], A: ['D'] };
/** B covers something else entirely, so its titles share no words with the others. */
const titleFor = (letter: string, n: number) =>
  letter === 'B' ? `Slow Cooked Pasta Recipe ${n}` : `America Just Built Thing ${n}`;

const source: YouTubeSource = {
  resolveChannelId: async () => cid('C'),
  fetchChannel: async (channelId): Promise<ChannelSnapshot> => {
    const letter = channelId.charAt(2);
    return {
      channel: {
        id: channelId,
        title: `Channel ${letter}`,
        handle: `handle${letter}`,
        subscribers: 1000,
        subscribersHidden: false,
        videoCount: 3,
      },
      videos: [1, 2, 3].map((n) => ({
        id: vid(letter, n),
        channelId,
        title: titleFor(letter, n),
        views: 1000 * n,
        durationSeconds: 900,
        published: {
          date: new Date(NOW.getTime() - n * DAY_MS),
          precision: 'day',
          raw: `${n}d ago`,
        },
      })),
    };
  },
  getSidebar: async (videoId): Promise<readonly SidebarItem[]> =>
    (links[videoId.charAt(0)] ?? []).map((letter) => ({
      videoId: vid(letter, 0),
      title: `Video by ${letter}`,
      channelId: cid(letter),
      channelName: `Channel ${letter}`,
      channelHandle: null,
      views: 1000,
      published: null,
    })),
};

let folder: string;
let engine: RunningConnectorEngine;
let client: Client;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-mcp-'));
  engine = createConnectorEngine(
    { dbPath: join(folder, 'store.db'), region: 'US' },
    { createSource: async () => source, now: () => NOW },
  );
  const server = createConnectorServer({ engine, log: () => {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterEach(async () => {
  await client.close();
  engine.close();
  rmSync(folder, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;

interface Listed {
  readonly id: string;
  readonly title: string;
}

describe('the connector on a real store', () => {
  test('an empty store says so for every read', async () => {
    expect(engine.findChannelVideos(cid('C'))).toBeNull();
    expect(textOf(await call('get_map', { channel: '@handleC' }))).toMatch(/^No map has been made/);
    expect(textOf(await call('get_channel_videos', { channel: '@handleC' }))).toMatch(
      /^This channel is not in the store yet/,
    );
    expect(jsonOf(await call('list_niches', {}))).toMatchObject({ shown: 0, niches: [] });
  });

  test('make a map, read it, study a channel, then keep a near miss as a competitor', async () => {
    const made = await call('make_map', { channel: '@handleC' });
    expect(made.isError).toBeFalsy();
    const map = jsonOf(await call('get_map', { channel: '@handleC', include_others: true }));
    expect(jsonOf(made)['map']).toEqual(map['map']);
    expect(map['center']).toMatchObject({ id: cid('C'), handle: 'handleC', videos: 3 });
    const lookalikes = (map['lookalikes'] as Listed[]).map((entry) => entry.title).sort();
    expect(lookalikes).toEqual(['Channel A', 'Channel D']);
    expect(map['others']).toMatchObject([{ id: cid('B'), why: 'titles' }]);

    const byHandle = jsonOf(await call('get_channel_videos', { channel: '@handleA' }));
    const byId = jsonOf(await call('get_channel_videos', { channel: cid('A'), order: 'newest' }));
    expect(byHandle['channel']).toEqual({
      id: cid('A'),
      title: 'Channel A',
      handle: 'handleA',
      subs: 1000,
    });
    expect(byHandle['stored']).toBe(3);
    expect((byId['videos'] as Array<{ video: string; secs: number }>)[0]).toMatchObject({
      video: vid('A', 1),
      secs: 900,
    });

    const nearMisses = jsonOf(await call('get_near_misses', { channel: cid('C') }));
    expect(nearMisses['nearMisses']).toMatchObject([
      {
        id: cid('B'),
        title: 'Channel B',
        titles: [
          'Slow Cooked Pasta Recipe 1',
          'Slow Cooked Pasta Recipe 2',
          'Slow Cooked Pasta Recipe 3',
        ],
      },
    ]);

    const kept = jsonOf(
      await call('set_competitor_status', {
        center: '@handleC',
        channel: '@handleB',
        status: 'kept',
      }),
    );
    expect(kept).toEqual({
      center: { id: cid('C'), title: 'Channel C' },
      channel: { id: cid('B'), title: 'Channel B' },
      status: 'kept',
      lookalike: true,
    });
    expect(jsonOf(await call('get_near_misses', { channel: cid('C') }))['nearMisses']).toEqual([]);
    const board = jsonOf(await call('get_thumbnail_board', { channel: cid('C') }));
    expect(board['own']).toMatchObject({ id: cid('C') });

    const undone = jsonOf(
      await call('set_competitor_status', {
        center: cid('C'),
        channel: cid('B'),
        status: 'auto',
      }),
    );
    expect(undone).toMatchObject({ status: 'auto', lookalike: false });
  });
});
