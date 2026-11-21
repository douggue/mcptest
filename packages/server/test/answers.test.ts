import {
  THUMBNAIL_PROMPT_MARKER,
  VIDEO_REF_RULE,
  markerLines,
  type YouTubeSource,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { ANALYSES, thumbnailPromptRule } from '../src/analyses';
import type { AnswerView } from '../src/answerEngine';
import { createApp } from '../src/app';
import { createEngine, type RunningEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const NOW = new Date('2026-11-20T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n = 0) => letter.repeat(10) + String(n);
const { start, end } = markerLines(THUMBNAIL_PROMPT_MARKER);

/** A centre C whose map holds A; Z is read into the store but is on no map of C's. */
const source: YouTubeSource = {
  resolveChannelId: async () => cid('C'),
  fetchChannel: async (channelId) => {
    const letter = channelId.charAt(2);
    return {
      channel: {
        id: channelId,
        title: `Channel ${letter}`,
        handle: `handle${letter}`,
        subscribers: 1500,
        subscribersHidden: false,
        videoCount: 3,
      },
      videos: [0, 1, 2].map((n) => ({
        id: vid(letter, n),
        channelId,
        title: `Video ${letter}${n}`,
        views: 1000 * (n + 1),
        durationSeconds: 900,
        published: {
          date: new Date(NOW.getTime() - (n + 1) * 86_400_000),
          precision: 'day' as const,
          raw: `${n + 1}d ago`,
        },
      })),
    };
  },
  fetchVideoPage: async () => {
    throw new Error('fetchVideoPage is not used in this test');
  },
  getSidebar: async (videoId) =>
    (videoId.startsWith('C') ? ['A'] : []).map((letter) => ({
      videoId: vid(letter),
      title: `Video by ${letter}`,
      channelId: cid(letter),
      channelName: `Channel ${letter}`,
      channelHandle: null,
      views: 1000,
      published: null,
    })),
};

const REVIEW = [
  'WINNING STYLES',
  `- Dark photo, red words [video:${vid('A')}] [video:${vid('Z')}] [video:nosuchvideo]`,
  `- Yours are pale [video:${vid('C', 1)}]`,
  start,
  `A wide photo of [SUBJECT]. Not like [video:${vid('A', 2)}].`,
  end,
  'Fill the two slots.',
].join('\n');

async function mapped(text = REVIEW): Promise<RunningEngine> {
  const engine = createEngine(
    { dbPath: ':memory:', region: 'US' },
    {
      storePath: '/data/jgtube.db',
      createSource: async () => source,
      now: () => NOW,
      runEngine: async () => ({ text, turns: 1 }),
      checkEngines: async () => [],
    },
  );
  await engine.crawl('@handleC', 1, () => {});
  // A channel of another map, read into the same store.
  await engine.readChannelBrand(cid('Z'));
  return engine;
}

describe('the thumbnail review’s question', () => {
  const question = ANALYSES.thumbnails.question(CHANNEL_ID);

  test('asks for every point to name the videos it rests on, in the form code reads', () => {
    expect(question).toContain(VIDEO_REF_RULE);
    expect(question).toMatch(
      /list item of its own, with the markers of the thumbnails it rests on/,
    );
  });

  test('ends with a ready prompt between the two marker lines', () => {
    expect(question).toContain(start);
    expect(question).toContain(end);
    expect(question).toContain('[SUBJECT]');
    expect(question).toContain('[OVERLAY TEXT]');
    expect(question).toMatch(
      /names no channel, no video, no video id, no real person, no logo, no country and no flag/,
    );
  });

  test('is fitted to no one channel', () => {
    expect(question.replaceAll(CHANNEL_ID, '')).not.toMatch(
      /invent|america|britain|history|finance|gaming|aviation|engineer|crypto/i,
    );
    expect(thumbnailPromptRule('Lead.').startsWith('Lead. ')).toBe(true);
  });

  test('video ideas name their proof the same way', () => {
    expect(ANALYSES.topics.question(CHANNEL_ID)).toContain(VIDEO_REF_RULE);
  });
});

describe('a thumbnail review, once answered', () => {
  test('is kept, its prompt lifted out, and only stored videos of this map are named', async () => {
    const engine = await mapped();
    const app = createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] });

    const response = await post(app, '/api/analyses', {
      analysis: 'thumbnails',
      channel: cid('C'),
    });
    const { data } = await read<AnswerView & { engine: string }>(response);

    expect(response.status).toBe(200);
    expect(data.prompt).toBe(`A wide photo of [SUBJECT]. Not like [video:${vid('A', 2)}].`);
    expect(data.text).not.toContain('A wide photo');
    expect(data.text).not.toContain(start);
    expect(data.text).toContain('Fill the two slots.');
    // Z is stored but on no map of this channel; one id is made up; one is named only inside the prompt.
    expect(data.videos.map((video) => video.videoId)).toEqual([vid('A'), vid('C', 1)]);
    expect(data.videos[0]).toMatchObject({
      title: 'Video A0',
      channelTitle: 'Channel A',
      views: 1000,
    });
    expect(data.engine).toBe('claude');
    expect(data.writtenAt).toBe(NOW.toISOString());
    engine.close();
  });

  test('is read back as it was kept, and found by the tools that read notes', async () => {
    const engine = await mapped();
    const app = createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] });
    await post(app, '/api/analyses', { analysis: 'thumbnails', channel: cid('C') });

    const kept = await read<{ answer: AnswerView | null }>(
      await get(app, `/api/analyses?channel=${cid('C')}&analysis=thumbnails`),
    );
    const none = await read<{ answer: AnswerView | null }>(
      await get(app, `/api/analyses?channel=${cid('C')}&analysis=topics`),
    );

    expect(kept.data.answer?.prompt).toContain('[SUBJECT]');
    expect(kept.data.answer?.videos).toHaveLength(2);
    expect(none.data.answer).toBeNull();
    expect(engine.findChannelNote('@handleC', 'thumbnail-review')?.text).toBe(REVIEW);
    expect(engine.findChannelNote(cid('A'), 'thumbnail-review')).toBeNull();
    engine.close();
  });

  test('an answer with no prompt in it, or two, has none lifted out', async () => {
    const engine = await mapped(`STYLES\n- One [video:${vid('A')}]`);
    const app = createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] });

    const { data } = await read<AnswerView>(
      await post(app, '/api/analyses', { analysis: 'thumbnails', channel: cid('C') }),
    );

    expect(data.prompt).toBeNull();
    expect(data.text).toContain('STYLES');
    engine.close();
  });

  test('the other quick analyses are kept too, and never have a prompt lifted out', async () => {
    const engine = await mapped();
    const app = createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] });

    const { data } = await read<AnswerView>(
      await post(app, '/api/analyses', { analysis: 'topics', channel: cid('C') }),
    );

    expect(data.prompt).toBeNull();
    expect(data.text).toContain(start);
    expect(engine.findAnswer('topics', cid('C'))?.engine).toBe('claude');
    engine.close();
  });
});

describe('GET /api/videos/named', () => {
  test('gives the stored videos of this map among the ids, and one more channel’s when asked', async () => {
    const engine = await mapped();
    const app = createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] });
    const ids = [vid('Z'), vid('A', 1), 'nosuchvideo'].join(',');
    const named = async (query: string) =>
      (
        await read<{ videos: { videoId: string }[] }>(await get(app, `/api/videos/named?${query}`))
      ).data.videos.map((video) => video.videoId);

    expect(await named(`channel=${cid('C')}&ids=${ids}`)).toEqual([vid('A', 1)]);
    expect(await named(`channel=${cid('C')}&ids=${ids}&of=${cid('Z')}`)).toEqual([
      vid('Z'),
      vid('A', 1),
    ]);
    expect(await named(`channel=${cid('Q')}&ids=${ids}`)).toEqual([]);
    engine.close();
  });

  test.each([
    ['no ids', `channel=${CHANNEL_ID}`],
    ['an id that is not one', `channel=${CHANNEL_ID}&ids=not-an-id`],
    ['a channel that is not an id', 'channel=@handle&ids=aaaaaaaaaaa'],
    ['too many ids', `channel=${CHANNEL_ID}&ids=${Array(81).fill('aaaaaaaaaaa').join(',')}`],
  ])('refuses %s', async (_what, query) => {
    const app = createApp({ engine: stubEngine({}), jobs: new JobStore(), allowedHosts: [HOST] });

    expect((await get(app, `/api/videos/named?${query}`)).status).toBe(400);
    expect((await post(app, '/api/videos/named', {})).status).toBe(405);
  });
});
