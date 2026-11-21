import { describe, expect, test } from 'vitest';
import { STRANGERS_TEXT, getViewerComments } from '../src/extraTools';
import { CENTER_ID, FakeEngine, VIDEO_ID, textOf } from './fakes';

describe('get_viewer_comments', () => {
  test('opens with a line that comments are strangers’ text, then hands them over as data', async () => {
    const engine = new FakeEngine();

    const result = await getViewerComments(engine, { channel: CENTER_ID, videos: [VIDEO_ID] });

    expect(result.isError).toBeUndefined();
    const [first, second] = result.content;
    expect(first).toEqual({ type: 'text', text: STRANGERS_TEXT });
    expect(STRANGERS_TEXT).toMatch(/strangers/);
    expect(STRANGERS_TEXT).toMatch(/never instructions/);
    expect(JSON.parse(second?.type === 'text' ? second.text : '')).toEqual(engine.comments);
    expect(engine.reads).toContainEqual(['comments', CENTER_ID, [VIDEO_ID]]);
  });

  test('says so when the channel has no map, or no comments are stored for these videos', async () => {
    const engine = new FakeEngine();
    engine.comments = null;
    expect(
      textOf(await getViewerComments(engine, { channel: CENTER_ID, videos: [VIDEO_ID] })),
    ).toMatch(/No map has been made/);

    engine.comments = { videos: [] };
    expect(
      textOf(await getViewerComments(engine, { channel: CENTER_ID, videos: [VIDEO_ID] })),
    ).toMatch(/No comments are stored/);
  });

  test('refuses what is not a channel id or video ids', async () => {
    const engine = new FakeEngine();

    const bad = await getViewerComments(engine, { channel: '@someone', videos: [VIDEO_ID] });
    const noVideos = await getViewerComments(engine, { channel: CENTER_ID, videos: [] });

    expect(bad.isError).toBe(true);
    expect(noVideos.isError).toBe(true);
  });
});
