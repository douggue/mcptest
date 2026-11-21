import {
  SqliteChannelRepo,
  SqliteCommentRepo,
  SqliteEdgeRepo,
  SqliteMapRepo,
  SqliteVideoRepo,
  freezeMapSnapshot,
  openDatabase,
  type CommentsResult,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { commentsEngine, DAILY_UNITS } from '../src/commentsEngine';
import type { CommentsEngine } from '../src/commentsTypes';

type StorableVideo = Parameters<SqliteVideoRepo['upsertMany']>[0][number];

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const CENTER = `UC${'c'.repeat(22)}`;
const PEER = `UC${'p'.repeat(22)}`;
const NO_MAP = `UC${'n'.repeat(22)}`;
const HIT = 'hit________';

let engine: CommentsEngine;
let key: string | undefined;
let fetched: string[];
let asked: unknown[];
let answerText: string;

const video = (channelId: string, id: string, views: number, days: number): StorableVideo => ({
  id: id.padEnd(11, '_'),
  channelId,
  title: `Title of ${id}`,
  views,
  durationSeconds: 600,
  published: { date: new Date(NOW.getTime() - days * DAY_MS), precision: 'day', raw: '' },
});

beforeEach(() => {
  const db = openDatabase(':memory:');
  const repos = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    comments: new SqliteCommentRepo(db),
  };
  for (const id of [CENTER, PEER]) {
    repos.channels.upsert(
      {
        id,
        title: id === PEER ? 'Peer' : 'Mine',
        handle: null,
        subscribers: 1000,
        subscribersHidden: false,
        videoCount: null,
      },
      NOW,
    );
    repos.videos.upsertMany(
      [1, 2, 3, 4, 5].map((n) => video(id, `${id.slice(2, 3)}old${n}`, 1000, 40 + n)),
      NOW,
    );
  }
  repos.videos.upsertMany([video(PEER, 'hit', 60_000, 6)], NOW);
  repos.maps.create(
    {
      centerChannelId: CENTER,
      depth: 1,
      region: 'US',
      members: [
        { channelId: CENTER, steps: 0 },
        { channelId: PEER, steps: 1 },
      ],
    },
    NOW,
  );
  freezeMapSnapshot(repos, CENTER, NOW);
  key = 'stand-in-key';
  fetched = [];
  asked = [];
  answerText = '';
  engine = commentsEngine({
    now: () => NOW,
    repos,
    apiKey: () => key,
    fetchComments: async (videoId, apiKey): Promise<CommentsResult> => {
      fetched.push(`${videoId}:${apiKey}`);
      return {
        status: 'read',
        comments: ['c1', 'c2', 'c3'].map((id, n) => ({
          commentId: id,
          videoId,
          text: `Please cover bridges ${n}`,
          likes: 10 - n,
          publishedAt: NOW,
        })),
      };
    },
    analyse: async (...args) => {
      asked.push(args);
      return { text: answerText, turns: 1, engine: 'claude', skipped: [] };
    },
  });
});

describe('commentsEngine', () => {
  test("says whether a key is set, the quota, and the map's winners", () => {
    const view = engine.findComments(CENTER);

    expect(view).toMatchObject({
      keySet: true,
      unitsPerVideo: 1,
      maxVideos: 10,
      dailyUnits: DAILY_UNITS,
    });
    expect(view?.candidates.map((entry) => [entry.videoId, entry.read])).toEqual([[HIT, null]]);
    key = undefined;
    expect(engine.findComments(CENTER)?.keySet).toBe(false);
    expect(engine.findComments(NO_MAP)).toBeNull();
  });

  test('reads the comments of chosen winners with the key read at the time of use', async () => {
    const outcomes = await engine.readComments(CENTER, [HIT], () => {});

    expect(fetched).toEqual([`${HIT}:stand-in-key`]);
    expect(outcomes).toEqual([{ videoId: HIT, status: 'read', count: 3, problem: null }]);
    expect(engine.findComments(CENTER)?.candidates[0]?.read).toMatchObject({
      status: 'read',
      count: 3,
    });
  });

  test('refuses with no key, no map, a video that is not a winner of this map, or too many', async () => {
    await expect(engine.readComments(NO_MAP, [HIT], () => {})).rejects.toThrow(/No map/);
    await expect(engine.readComments(CENTER, ['notawinner_'], () => {})).rejects.toThrow(
      /not among the winning videos/,
    );
    await expect(engine.readComments(CENTER, Array(11).fill(HIT), () => {})).rejects.toThrow(
      /at most 10/,
    );
    key = undefined;
    await expect(engine.readComments(CENTER, [HIT], () => {})).rejects.toThrow(
      /No YouTube API key/,
    );
    expect(fetched).toEqual([]);
  });

  test('hands the connector the stored comments of winners only', async () => {
    await engine.readComments(CENTER, [HIT], () => {});

    const handed = engine.viewerComments(CENTER, [HIT, 'notawinner_']);

    expect(handed?.videos.map((entry) => [entry.videoId, entry.comments.map((c) => c.id)])).toEqual(
      [[HIT, ['c1', 'c2', 'c3']]],
    );
    expect(engine.viewerComments(NO_MAP, [HIT])).toBeNull();
  });

  test('asks what viewers ask for, and keeps only findings resting on comments it handed out', async () => {
    await engine.readComments(CENTER, [HIT], () => {});
    answerText = [
      'FINDING',
      'KIND: request',
      'SAYS: Viewers want a video on bridges.',
      'COMMENTS: c1, c2, invented',
      '',
      'FINDING',
      'KIND: question',
      'SAYS: Something made up.',
      'COMMENTS: invented, other',
    ].join('\n');

    const outcome = await engine.askViewers(CENTER, [HIT]);

    expect(asked).toEqual([
      ['viewer-requests', CENTER, undefined, { kind: 'comments', videoIds: [HIT] }],
    ]);
    expect(outcome).toMatchObject({ proposed: 2, dropped: 1, engine: 'claude' });
    const answer = engine.findComments(CENTER)?.answer;
    expect(answer?.findings).toEqual([
      {
        kind: 'request',
        says: 'Viewers want a video on bridges.',
        comments: [
          { commentId: 'c1', videoId: HIT, text: 'Please cover bridges 0', likes: 10 },
          { commentId: 'c2', videoId: HIT, text: 'Please cover bridges 1', likes: 9 },
        ],
      },
    ]);
  });

  test('will not ask about videos whose comments are not stored', async () => {
    await expect(engine.askViewers(CENTER, [HIT])).rejects.toThrow(/Read their comments first/);
    expect(asked).toEqual([]);
  });
});
