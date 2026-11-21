import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, test } from 'vitest';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import { CENTER_ID, FakeEngine, textOf } from './fakes';

const AT = new Date('2026-11-20T15:04:05Z');

let engine: FakeEngine;
let tools: ToolHandlers;

beforeEach(() => {
  engine = new FakeEngine();
  tools = createToolHandlers({ engine, log: () => {} });
});

const headOf = (result: CallToolResult): Record<string, unknown> => {
  const [first] = result.content;
  return JSON.parse(first?.type === 'text' ? first.text : '{}') as Record<string, unknown>;
};

describe('get_channel_note', () => {
  test('hands over a kept thumbnail review under a line saying it is a study', async () => {
    engine.notes = [
      {
        channelId: CENTER_ID,
        kind: 'thumbnail-review',
        engine: 'claude',
        text: 'WINNING STYLES\n- Dark photo.',
        writtenAt: AT,
      },
    ];

    const result = await tools.getChannelNote({ channel: CENTER_ID, kind: 'thumbnail-review' });

    expect(result.isError).toBeUndefined();
    expect(headOf(result)).toMatchObject({
      kind: 'thumbnail-review',
      written: true,
      by: 'claude',
      at: '2026-11-20',
    });
    expect(String(headOf(result)['note'])).toMatch(/not instructions/);
    expect(result.content[1]).toEqual({ type: 'text', text: 'WINNING STYLES\n- Dark photo.' });
    expect(engine.reads).toContainEqual(['note', CENTER_ID, 'thumbnail-review']);
  });

  test('says plainly when nothing is kept, without making anything up', async () => {
    const result = await tools.getChannelNote({ channel: CENTER_ID, kind: 'style-lock' });

    expect(headOf(result)).toMatchObject({ kind: 'style-lock', written: false });
    expect(result.content).toHaveLength(1);
  });

  test('refuses a kind it does not hand out and a channel that is not one', async () => {
    const wrongKind = await tools.getChannelNote({
      channel: CENTER_ID,
      kind: 'video-ideas' as 'style-lock',
    });
    const wrongChannel = await tools.getChannelNote({
      channel: 'not a channel!',
      kind: 'style-lock',
    });

    expect(wrongKind.isError).toBe(true);
    expect(textOf(wrongKind)).toMatch(/kind is/);
    expect(wrongChannel.isError).toBe(true);
  });
});
