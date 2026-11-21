import {
  SqliteChannelRepo,
  SqliteConceptRepo,
  SqliteMapRepo,
  SqliteScriptRepo,
  SqliteVideoLinkRepo,
  SqliteVideoRepo,
  openDatabase,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { planEngine } from '../src/planEngine';
import type { PlanEngine } from '../src/planTypes';

type StorableVideo = Parameters<SqliteVideoRepo['upsertMany']>[0][number];

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const CENTER = `UC${'c'.repeat(22)}`;
const NO_MAP = `UC${'n'.repeat(22)}`;
const MINE = 'mine_______';
const LATER = 'later______';

let repos: {
  channels: SqliteChannelRepo;
  videos: SqliteVideoRepo;
  maps: SqliteMapRepo;
  concepts: SqliteConceptRepo;
  scripts: SqliteScriptRepo;
  links: SqliteVideoLinkRepo;
};
let reads: string[];
let engine: PlanEngine;
let conceptId: number;

const video = (id: string, views: number, days: number): StorableVideo => ({
  id,
  channelId: CENTER,
  title: `Title ${id}`,
  views,
  durationSeconds: 600,
  published: { date: daysAgo(days), precision: 'day', raw: `${days}d ago` },
});

beforeEach(() => {
  const db = openDatabase(':memory:');
  repos = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    maps: new SqliteMapRepo(db),
    concepts: new SqliteConceptRepo(db),
    scripts: new SqliteScriptRepo(db),
    links: new SqliteVideoLinkRepo(db),
  };
  repos.channels.upsert(
    {
      id: CENTER,
      title: 'Mine',
      handle: null,
      subscribers: 10,
      subscribersHidden: false,
      videoCount: null,
    },
    NOW,
  );
  repos.videos.upsertMany([video(MINE, 900, 5)], NOW);
  repos.maps.create(
    { centerChannelId: CENTER, depth: 1, region: 'US', members: [{ channelId: CENTER, steps: 0 }] },
    NOW,
  );
  const batch = repos.concepts.createBatch(
    {
      centerChannelId: CENTER,
      inspiration: [],
      hookModels: [],
      format: null,
      angle: null,
      length: 'long',
    },
    NOW,
  );
  const [stored] = repos.concepts.addConcepts(
    batch,
    [
      {
        title: 'Plan',
        altTitles: ['a', 'b'],
        thumbnail: 't',
        overlay: 'o',
        hook: 'h',
        hookStyle: null,
        restsOn: 'r',
        needs: 'nothing',
        origin: 'batch',
        parentId: null,
        engine: 'test',
      },
    ],
    NOW,
  );
  conceptId = stored?.id ?? 0;
  repos.concepts.setKept(CENTER, conceptId, true);
  reads = [];
  engine = planEngine({
    now: () => NOW,
    repos,
    readChannel: async (channelId) => {
      reads.push(channelId);
      repos.videos.upsertMany([video(LATER, 300, 1)], NOW);
    },
  });
});

describe('planEngine', () => {
  test('links a stored video from a pasted link without reading YouTube', async () => {
    const reply = await engine.linkPlanVideo(CENTER, conceptId, `https://youtu.be/${MINE}`);

    expect(reply.outcome).toBe('linked');
    expect(reply.plan?.linked.map((entry) => entry.videoId)).toEqual([MINE]);
    expect(reads).toEqual([]);
  });

  test('reads the channel once when the video is not stored, then links it', async () => {
    const reply = await engine.linkPlanVideo(CENTER, conceptId, LATER);

    expect(reply.outcome).toBe('linked');
    expect(reads).toEqual([CENTER]);
  });

  test('says the video was not found when one read does not bring it', async () => {
    const reply = await engine.linkPlanVideo(CENTER, conceptId, 'nowhere____');

    expect(reply).toEqual({ outcome: 'not-found', plan: null });
    expect(reads).toEqual([CENTER]);
  });

  test('refuses what is not a video link, and a channel with no map', async () => {
    expect(await engine.linkPlanVideo(CENTER, conceptId, 'https://example.com/x')).toEqual({
      outcome: 'bad-link',
      plan: null,
    });
    expect(await engine.linkPlanVideo(NO_MAP, conceptId, MINE)).toEqual({
      outcome: 'no-map',
      plan: null,
    });
    expect(engine.findPlan(NO_MAP)).toBeNull();
    expect(engine.unlinkPlanVideo(NO_MAP, conceptId)).toBeNull();
  });

  test('answers the plan and unlinks', async () => {
    await engine.linkPlanVideo(CENTER, conceptId, MINE);

    expect(engine.unlinkPlanVideo(CENTER, conceptId)?.linked).toEqual([]);
    expect(engine.findPlan(CENTER)?.linkable.map((entry) => entry.conceptId)).toEqual([conceptId]);
  });
});
