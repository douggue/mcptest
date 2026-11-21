import {
  SqliteChannelRepo,
  SqliteConceptRepo,
  SqliteConceptThumbnailRepo,
  SqliteMapRepo,
  SqliteVideoRepo,
  THUMBNAIL_PROMPT_MARKER,
  markerLines,
  openDatabase,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AnalysisId } from '../src/analyses';
import { conceptThumbEngine, type ConceptThumbEngine } from '../src/conceptThumbEngine';
import type { LabProgress } from '../src/labTypes';
import type { QuestionFocus } from '../src/questionFocus';

const NOW = new Date('2026-11-21T12:00:00Z');
const cid = (name: string) => `UC${name.padEnd(22, '_').slice(0, 22)}`;
const vid = (name: string) => name.padEnd(11, '_').slice(0, 11);
const MINE = cid('mine');
const { start, end } = markerLines(THUMBNAIL_PROMPT_MARKER);

let engine: ConceptThumbEngine;
let conceptId: number;
let answer: string;
let asked: { analysis: AnalysisId; channel: string; focus: QuestionFocus | undefined }[];

const reply = (prompt: string | null): string =>
  [
    'STYLE: Dark close-up, two big words',
    `WHY: The winners all fill the frame [video:${vid('alpha')}].`,
    `LEARNED FROM: [video:${vid('alpha')}] [video:${vid('theirs')}] [video:${vid('nowhere')}]`,
    ...(prompt === null ? [] : [start, prompt, end]),
  ].join('\n');

beforeEach(() => {
  const db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  const videos = new SqliteVideoRepo(db);
  const maps = new SqliteMapRepo(db);
  const concepts = new SqliteConceptRepo(db);
  for (const name of ['mine', 'alike', 'stranger']) {
    channels.upsert(
      {
        id: cid(name),
        title: name,
        handle: name,
        subscribers: 1000,
        subscribersHidden: false,
        videoCount: null,
      },
      NOW,
    );
  }
  const add = (channel: string, name: string): void =>
    videos.upsertMany(
      [
        {
          id: vid(name),
          channelId: cid(channel),
          title: `Title of ${name}`,
          views: 9000,
          durationSeconds: 600,
          published: { date: NOW, precision: 'day', raw: '' },
        },
      ],
      NOW,
    );
  add('alike', 'alpha');
  add('stranger', 'theirs');
  maps.create(
    {
      centerChannelId: MINE,
      depth: 1,
      region: 'US',
      members: [
        { channelId: MINE, steps: 0 },
        { channelId: cid('alike'), steps: 1 },
      ],
    },
    NOW,
  );
  const batchId = concepts.createBatch(
    {
      centerChannelId: MINE,
      inspiration: [vid('alpha')],
      hookModels: [],
      format: null,
      angle: null,
      length: 'long',
    },
    NOW,
  );
  const [stored] = concepts.addConcepts(
    batchId,
    [
      {
        title: 'The Machine Nobody Switched Off',
        altTitles: ['A', 'B'],
        thumbnail: 'A rusted press.',
        overlay: 'STILL RUNNING',
        hook: 'Nobody switched it off.',
        hookStyle: null,
        restsOn: 'alpha: the frame.',
        needs: 'nothing',
        origin: 'batch',
        parentId: null,
        engine: 'claude',
      },
    ],
    NOW,
  );
  conceptId = stored?.id ?? 0;
  answer = reply('A dark close-up of a rusted press. Overlay: STILL RUNNING.');
  asked = [];
  engine = conceptThumbEngine({
    now: () => NOW,
    repos: {
      channels,
      videos,
      maps,
      concepts,
      conceptThumbnails: new SqliteConceptThumbnailRepo(db),
    },
    analyse: async (analysis, channel, _only, focus) => {
      asked.push({ analysis, channel, focus });
      return { text: answer, engine: 'claude', skipped: [], turns: 1 };
    },
  });
});

const progress = (): ((p: LabProgress) => void) => () => undefined;

describe('a concept’s thumbnail prompt', () => {
  test('asks the fixed question for that concept, and stores the prompt with the thumbnails of this map it learned from', async () => {
    const outcome = await engine.writeConceptThumbnail(MINE, conceptId, undefined, progress());

    expect(asked).toEqual([
      { analysis: 'concept-thumbnail', channel: MINE, focus: { kind: 'concept', conceptId } },
    ]);
    expect(outcome.kind).toBe('concept-thumbnail');
    expect(outcome.thumbnail.prompt).toBe(
      'A dark close-up of a rusted press. Overlay: STILL RUNNING.',
    );
    expect(outcome.thumbnail.why).toBe('The winners all fill the frame.');
    // A video off this map and a made-up id are dropped.
    expect(outcome.thumbnail.learnedFrom.map((video) => video.videoId)).toEqual([vid('alpha')]);
    expect(engine.listConceptThumbnails(MINE)).toEqual([outcome.thumbnail]);
  });

  test('stores nothing when the answer holds no prompt between the marker lines', async () => {
    answer = reply(null);

    await expect(
      engine.writeConceptThumbnail(MINE, conceptId, undefined, progress()),
    ).rejects.toThrow(/marker lines.*Nothing was changed/);
    expect(engine.listConceptThumbnails(MINE)).toEqual([]);
  });

  test('is refused for a concept that is not this channel’s', async () => {
    await expect(
      engine.writeConceptThumbnail(cid('stranger'), conceptId, undefined, progress()),
    ).rejects.toThrow(/not one of this channel’s concepts/);
    expect(asked).toEqual([]);
  });

  test('a new run replaces the stored prompt', async () => {
    await engine.writeConceptThumbnail(MINE, conceptId, undefined, progress());
    answer = reply('A second prompt.');
    await engine.writeConceptThumbnail(MINE, conceptId, 'claude', progress());

    expect(engine.listConceptThumbnails(MINE)?.map((entry) => entry.prompt)).toEqual([
      'A second prompt.',
    ]);
  });

  test('lists none for a channel with no map', () => {
    expect(engine.listConceptThumbnails(cid('stranger'))).toBeNull();
  });
});
