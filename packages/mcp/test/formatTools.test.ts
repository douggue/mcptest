import { describe, expect, test } from 'vitest';
import { getActiveFormat, getFormatShelf, viewFormatPictures } from '../src/formatTools';
import { FakeEngine } from './fakes';

const textOf = (result: { content: readonly unknown[] }): string =>
  String((result.content[0] as { text?: string } | undefined)?.text);

describe('the format tools', () => {
  test('get_format_shelf hands back the shelf for a format, and refuses an unknown or bad one', () => {
    const engine = new FakeEngine();
    expect(JSON.parse(textOf(getFormatShelf(engine, { format: 1 })))).toMatchObject({
      format: { id: 1 },
    });
    expect(getFormatShelf(engine, { format: 2 }).isError).toBe(true);
    expect(getFormatShelf(engine, { format: -1 }).isError).toBe(true);
  });

  test('view_format_pictures shows the pictures there are and fails when none are', async () => {
    const engine = new FakeEngine();
    const shown = await viewFormatPictures(engine, { names: ['i1-1.png', 'i1-2.jpg'] });
    expect(shown.content.map((block) => block.type)).toEqual(['text', 'image', 'text']);
    expect(shown.content[1]).toMatchObject({ mimeType: 'image/png' });
    expect(shown.content[2]).toMatchObject({ text: 'i1-2.jpg: there is no such picture.' });
    expect((await viewFormatPictures(engine, { names: ['i1-2.webp'] })).isError).toBe(true);
    expect((await viewFormatPictures(engine, { names: ['../x.jpg'] })).isError).toBe(true);
  });

  test('get_active_format hands back the plan, says when there is none, refuses a bad channel', () => {
    const engine = new FakeEngine();
    const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
    expect(JSON.parse(textOf(getActiveFormat(engine, { channel: A })))).toMatchObject({
      active: true,
      plan: { format: { name: 'Long-form' } },
    });
    expect(
      JSON.parse(textOf(getActiveFormat(engine, { channel: 'UCbbbbbbbbbbbbbbbbbbbbbb' }))),
    ).toEqual({
      active: false,
      note: 'This channel has no active format: work as you would without one.',
    });
    expect(getActiveFormat(engine, { channel: 'bad' }).isError).toBe(true);
  });
});
