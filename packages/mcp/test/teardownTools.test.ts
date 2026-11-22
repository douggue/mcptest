import { describe, expect, test } from 'vitest';
import { getChannelMeasurements, getVideoTeardown, viewTeardownImages } from '../src/teardownTools';
import { FakeEngine } from './fakes';

const VIDEO = 'dQw4w9WgXcQ';

describe('the teardown tools', () => {
  test('get_video_teardown hands back the parts asked for, and refuses a bad id or part', () => {
    const engine = new FakeEngine();
    const result = getVideoTeardown(engine, { video: VIDEO, include: ['measured', 'plan'] });
    expect(JSON.parse(String((result.content[0] as { text?: string } | undefined)?.text))).toEqual({
      video: VIDEO,
      include: ['measured', 'plan'],
    });
    expect(getVideoTeardown(engine, { video: 'nope', include: ['measured'] }).isError).toBe(true);
    expect(getVideoTeardown(engine, { video: VIDEO, include: ['secrets' as 'plan'] }).isError).toBe(
      true,
    );
  });

  test('view_teardown_images shows the pictures there are, names the missing ones, and fails when none exist', async () => {
    const engine = new FakeEngine();
    const shown = await viewTeardownImages(engine, {
      video: VIDEO,
      names: ['k-001.jpg', 'k-002.jpg'],
    });
    expect(shown.content.map((block) => block.type)).toEqual(['text', 'image', 'text']);
    expect(shown.content[2]).toMatchObject({ text: 'k-002.jpg: there is no such picture.' });
    const none = await viewTeardownImages(engine, { video: VIDEO, names: ['k-009.jpg'] });
    expect(none.isError).toBe(true);
    expect(
      (await viewTeardownImages(engine, { video: VIDEO, names: ['../etc.jpg'] })).isError,
    ).toBe(true);
  });

  test('get_channel_measurements hands back what code measured across a channel, under its note', () => {
    const engine = new FakeEngine();
    const found = getChannelMeasurements(engine, { channel: '@maps' });
    const text = String((found.content[0] as { text?: string } | undefined)?.text);
    expect(JSON.parse(text)).toMatchObject({
      basis: { winners: 3 },
      note: expect.stringMatching(/measured and counted in code/),
    });
    expect(getChannelMeasurements(engine, { channel: '@nobody' }).isError).toBe(true);
    expect(getChannelMeasurements(engine, { channel: '' }).isError).toBe(true);
  });
});
