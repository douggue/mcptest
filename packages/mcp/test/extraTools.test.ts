import { describe, expect, test } from 'vitest';
import {
  FOUND_IN_CODE,
  STRANGERS_TEXT,
  getRiskFindings,
  getThumbnailComparison,
  getViewerComments,
} from '../src/extraTools';
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

describe('get_risk_findings', () => {
  test('says the findings were worked out in code, then hands them over', async () => {
    const engine = new FakeEngine();

    const result = await getRiskFindings(engine, { channel: CENTER_ID, concept: 3 });

    const [first, second] = result.content;
    expect(first).toEqual({ type: 'text', text: FOUND_IN_CODE });
    expect(FOUND_IN_CODE).toMatch(/worked out by Jgtube in code/);
    expect(JSON.parse(second?.type === 'text' ? second.text : '')).toEqual(engine.risk);
    expect(engine.reads).toContainEqual(['risk', CENTER_ID, 3]);
  });

  test('says so when there is no such kept concept with a script, and refuses bad input', async () => {
    const engine = new FakeEngine();
    engine.risk = null;

    expect((await getRiskFindings(engine, { channel: CENTER_ID, concept: 3 })).isError).toBe(true);
    expect((await getRiskFindings(engine, { channel: '@x', concept: 3 })).isError).toBe(true);
    expect((await getRiskFindings(engine, { channel: CENTER_ID, concept: 0 })).isError).toBe(true);
  });
});

describe('get_thumbnail_comparison', () => {
  test('hands over the comparison counted in code for one video of the map', async () => {
    const engine = new FakeEngine();

    const result = await getThumbnailComparison(engine, { channel: CENTER_ID, video: VIDEO_ID });

    expect(textOf(result)).toBe('WINNING VALUES: Face or person = large');
    expect(engine.reads).toContainEqual(['thumbnail-comparison', CENTER_ID, VIDEO_ID]);
  });

  test('says so when none is kept, and refuses what is not a video id', async () => {
    const engine = new FakeEngine();
    engine.comparison = null;
    expect(
      textOf(await getThumbnailComparison(engine, { channel: CENTER_ID, video: VIDEO_ID })),
    ).toMatch(/No thumbnail comparison is kept/);
    const bad = await getThumbnailComparison(engine, { channel: CENTER_ID, video: 'nope' });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/11 characters/);
  });
});
