import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { linkVideo, loadPlan, type PlanDeps } from '../src/plan/report';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteConceptRepo } from '../src/repos/sqliteConceptRepo';
import { SqliteScriptRepo } from '../src/repos/sqliteScriptRepo';
import { SqliteVideoLinkRepo } from '../src/repos/sqliteVideoLinkRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StorableVideo } from '../src/sources/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (name: string) => name.padEnd(11, '_').slice(0, 11);
const CENTER = cid('c');
const PEER = cid('p');

let db: Db;
const makeRepos = (store: Db) => ({
  channels: new SqliteChannelRepo(store),
  videos: new SqliteVideoRepo(store),
  concepts: new SqliteConceptRepo(store),
  scripts: new SqliteScriptRepo(store),
  links: new SqliteVideoLinkRepo(store),
});

let deps: ReturnType<typeof makeRepos> & PlanDeps;
let conceptId: number;
let otherConceptId: number;

const channel = (id: string, title: string, at: Date) =>
  deps.channels.upsert(
    { id, title, handle: null, subscribers: 1000, subscribersHidden: false, videoCount: null },
    at,
  );

const video = (channelId: string, name: string, views: number, days: number): StorableVideo => ({
  id: vid(name),
  channelId,
  title: `Title of ${name}`,
  views,
  durationSeconds: 600,
  published: { date: daysAgo(days), precision: 'day', raw: `${days}d ago` },
});

const concept = (title: string) => ({
  title,
  altTitles: ['Alt one', 'Alt two'] as const,
  thumbnail: 'A picture',
  overlay: 'Words',
  hook: 'An opening line.',
  hookStyle: 'A question',
  restsOn: 'The picked video',
  needs: 'nothing',
  origin: 'batch' as const,
  parentId: null,
  engine: 'test',
});

beforeEach(() => {
  db = openDatabase(':memory:');
  deps = makeRepos(db);
  channel(CENTER, 'Mine', daysAgo(1));
  channel(PEER, 'Peer', daysAgo(20));
  // The inspiration video read at 2 and 9 days old; the centre's own videos read today.
  deps.videos.upsertMany([video(PEER, 'insp', 500, 20)], daysAgo(18));
  deps.videos.upsertMany([video(PEER, 'insp', 4000, 20)], daysAgo(11));
  deps.videos.upsertMany(
    [
      ...[1, 2, 3, 4, 5].map((n) => video(CENTER, `old${n}`, 1000, 20 + n)),
      video(CENTER, 'mine', 6000, 9),
      video(CENTER, 'spare', 800, 3),
    ],
    daysAgo(0),
  );
  const batch = deps.concepts.createBatch(
    {
      centerChannelId: CENTER,
      inspiration: [vid('insp'), vid('gone')],
      hookModels: [],
      format: { source: 'transfer', ref: 'k', template: 'The {subject} nobody talks about' },
      angle: null,
      length: 'long',
    },
    daysAgo(30),
  );
  const [first, second] = deps.concepts.addConcepts(
    batch,
    [concept('My plan'), concept('Other plan')],
    daysAgo(30),
  );
  conceptId = first?.id ?? 0;
  otherConceptId = second?.id ?? 0;
  deps.concepts.setKept(CENTER, conceptId, true);
  deps.concepts.setKept(CENTER, otherConceptId, true);
});

describe('linkVideo', () => {
  test('links a kept concept to a stored video of the centre channel, by id or link', () => {
    expect(linkVideo(deps, CENTER, conceptId, vid('mine'), NOW)).toEqual({ status: 'linked' });
    expect(deps.links.list(CENTER).map((link) => [link.conceptId, link.videoId])).toEqual([
      [conceptId, vid('mine')],
    ]);
  });

  test('refuses a video of another channel, one not stored, one linked elsewhere and a concept not kept or not this channel', () => {
    expect(linkVideo(deps, CENTER, conceptId, vid('insp'), NOW)).toEqual({
      status: 'other-channel',
    });
    expect(linkVideo(deps, CENTER, conceptId, vid('unknown'), NOW)).toEqual({
      status: 'not-stored',
    });
    linkVideo(deps, CENTER, conceptId, vid('mine'), NOW);
    expect(linkVideo(deps, CENTER, otherConceptId, vid('mine'), NOW)).toEqual({
      status: 'video-taken',
    });
    expect(linkVideo(deps, PEER, conceptId, vid('mine'), NOW)).toEqual({ status: 'no-concept' });
    deps.concepts.setKept(CENTER, otherConceptId, false);
    expect(linkVideo(deps, CENTER, otherConceptId, vid('spare'), NOW)).toEqual({
      status: 'no-concept',
    });
  });

  test('replaces the video of a concept linked before, and unlinks', () => {
    linkVideo(deps, CENTER, conceptId, vid('mine'), NOW);
    linkVideo(deps, CENTER, conceptId, vid('spare'), NOW);
    expect(deps.links.list(CENTER).map((link) => link.videoId)).toEqual([vid('spare')]);
    expect(deps.links.unlink(CENTER, conceptId)).toBe(true);
    expect(deps.links.unlink(CENTER, conceptId)).toBe(false);
  });
});

describe('loadPlan', () => {
  test('gives each linked video its score against the channel usual and the inspirations at the same age', () => {
    linkVideo(deps, CENTER, conceptId, vid('mine'), NOW);

    const plan = loadPlan(deps, CENTER, NOW);

    expect(plan.linkable.map((entry) => entry.conceptId)).toEqual([otherConceptId]);
    const [linked] = plan.linked;
    expect(linked).toMatchObject({
      conceptId,
      conceptTitle: 'My plan',
      videoId: vid('mine'),
      videoTitle: 'Title of mine',
      views: 6000,
      format: 'The {subject} nobody talks about',
      hookStyle: 'A question',
      durationSeconds: 600,
      hasScript: false,
    });
    expect(linked?.ageDays).toBeCloseTo(9);
    expect(linked?.score).toBeGreaterThan(1);
    expect(linked?.usualViews).toBeGreaterThan(0);
    expect(linked?.inspirations).toEqual([
      {
        videoId: vid('insp'),
        title: 'Title of insp',
        channelTitle: 'Peer',
        match: { status: 'comparable', ageDays: 9, views: 4000 },
      },
      {
        videoId: vid('gone'),
        title: null,
        channelTitle: null,
        match: { status: 'not-comparable', reason: 'not-stored' },
      },
    ]);
    expect(plan.table.find((row) => row.kind === 'format')).toMatchObject({ videos: 1, scored: 1 });
  });

  test('has nothing linked and every kept concept linkable at first', () => {
    const plan = loadPlan(deps, CENTER, NOW);
    expect(plan.linked).toEqual([]);
    expect(plan.table).toEqual([]);
    expect(plan.linkable.map((entry) => entry.title)).toEqual(['My plan', 'Other plan']);
  });
});
