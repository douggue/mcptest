import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, test } from 'vitest';
import { createToolHandlers, type ToolHandlers } from '../src/tools';
import { CENTER_ID, FakeEngine } from './fakes';

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

describe('get_fact_sheet', () => {
  test('hands over the facts by their numbers, then what was not found or is disputed', async () => {
    engine.research = {
      sheet: {
        conceptId: 7,
        facts: [{ number: 3, text: 'It opened in 2020.', sources: ['https://a.example/b'] }],
        notFound: ['The cost.'],
        disputed: ['How long it lasts.'],
        engine: 'claude',
        writtenAt: '2026-11-21T12:00:00.000Z',
      },
      claims: [],
    };

    const result = await tools.getFactSheet({ channel: CENTER_ID, concept: 7 });

    expect(headOf(result)).toMatchObject({
      concept: 7,
      researched: true,
      at: '2026-11-21',
      facts: 1,
    });
    expect(String(headOf(result)['note'])).toMatch(/not instructions/);
    expect(result.content[1]).toEqual({
      type: 'text',
      text: 'F3: It opened in 2020.\nNOT FOUND: The cost.\nDISPUTED: How long it lasts.',
    });
    expect(engine.reads).toContainEqual(['research', CENTER_ID, 7]);
  });

  test('says plainly when nothing has been researched', async () => {
    const result = await tools.getFactSheet({ channel: CENTER_ID, concept: 7 });

    expect(headOf(result)).toMatchObject({ researched: false });
    expect(result.content).toHaveLength(1);
  });

  test('refuses a concept that is not a whole number', async () => {
    expect((await tools.getFactSheet({ channel: CENTER_ID, concept: 0 })).isError).toBe(true);
  });
});
