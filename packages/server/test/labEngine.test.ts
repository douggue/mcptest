import {
  SqliteChannelRepo,
  SqliteConceptRepo,
  SqliteFormulaRepo,
  SqliteHookLabelRepo,
  SqliteMapRepo,
  SqliteScriptRepo,
  SqliteVideoPageRepo,
  SqliteVideoRepo,
  SqliteVideoStudyRepo,
  openDatabase,
  type MapSnapshot,
  type TransferList,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AnalysisId } from '../src/analyses';
import type { LabDeps } from '../src/labDeps';
import { lab } from '../src/labSetup';
import type { ConceptRequest, LabEngine, LabProgress } from '../src/labTypes';
import type { QuestionFocus } from '../src/questionFocus';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (name: string) => `UC${name.padEnd(22, '_').slice(0, 22)}`;
const vid = (name: string) => name.padEnd(11, '_').slice(0, 11);
const MINE = cid('mine');
const OTHER = cid('elsewhere');
const A = vid('alpha');
const B = vid('beta');

interface Asked {
  readonly analysis: AnalysisId;
  readonly channel: string;
  readonly only: string | undefined;
  readonly focus: QuestionFocus | undefined;
}

let deps: LabDeps;
let engine: LabEngine;
let asked: Asked[];
let answer: string;
let closing: boolean;
let pages: SqliteVideoPageRepo;
let transcriptReads: string[];
let unreadable: readonly string[];

const concept = (number: number, extra: readonly string[] = []): string =>
  [
    `CONCEPT ${number}`,
    `TITLE: The Machine Nobody Switched Off ${number}`,
    'ALT: Why This Machine Still Runs',
    'ALT: The Factory That Forgot Its Machine',
    'THUMBNAIL: A rusted press in an empty hall.',
    'OVERLAY: STILL RUNNING',
    'HOOK: Nobody switched it off.',
    `RESTS ON: ${A}: the cold open. zzzzzzzzzz9: made up.`,
    'NEEDS: The year the plant closed.',
    ...extra,
  ].join('\n');

const concepts = (count: number): string =>
  Array.from({ length: count }, (_, index) => concept(index + 1)).join('\n\n');

const request = (overrides: Partial<ConceptRequest> = {}): ConceptRequest => ({
  centerChannelId: MINE,
  inspiration: [A, B],
  hookModels: [],
  format: null,
  angle: null,
  length: 'long',
  ...overrides,
});

const steps = (): { readonly seen: LabProgress[]; readonly report: (p: LabProgress) => void } => {
  const seen: LabProgress[] = [];
  return { seen, report: (progress) => seen.push(progress) };
};

const snapshotOf = (centerId: string): MapSnapshot =>
  ({
    center: { id: centerId, title: 'Mine' },
    breakouts: [
      {
        videoId: A,
        title: 'Title of alpha',
        channelId: cid('alike'),
        channelTitle: 'alike',
        views: 9000,
        score: 8,
        peer: true,
      },
      {
        videoId: B,
        title: 'Title of beta',
        channelId: cid('alike'),
        channelTitle: 'alike',
        views: 4000,
        score: 3,
        peer: true,
      },
    ],
  }) as unknown as MapSnapshot;

beforeEach(() => {
  const db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  const videos = new SqliteVideoRepo(db);
  const maps = new SqliteMapRepo(db);
  pages = new SqliteVideoPageRepo(db);
  for (const name of ['mine', 'alike', 'elsewhere', 'stranger']) {
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
  const add = (channel: string, name: string, daysAgo: number): void =>
    videos.upsertMany(
      [
        {
          id: vid(name),
          channelId: cid(channel),
          title: `Title of ${name}`,
          views: 9000,
          durationSeconds: 600,
          published: {
            date: new Date(NOW.getTime() - daysAgo * DAY_MS),
            precision: 'day',
            raw: '',
          },
        },
      ],
      NOW,
    );
  add('alike', 'alpha', 10);
  add('alike', 'beta', 60);
  add('stranger', 'theirs', 5);
  const mapOf = (centre: string, other: string): number =>
    maps.create(
      {
        centerChannelId: cid(centre),
        depth: 1,
        region: 'US',
        members: [
          { channelId: cid(centre), steps: 0 },
          { channelId: cid(other), steps: 1 },
        ],
      },
      NOW,
    );
  mapOf('mine', 'alike');
  mapOf('elsewhere', 'stranger');
  asked = [];
  answer = concepts(10);
  closing = false;
  transcriptReads = [];
  unreadable = [];
  deps = {
    now: () => NOW,
    repos: {
      channels,
      videos,
      maps,
      pages,
      concepts: new SqliteConceptRepo(db),
      formulas: new SqliteFormulaRepo(db),
      hookLabels: new SqliteHookLabelRepo(db),
      scripts: new SqliteScriptRepo(db),
      studies: new SqliteVideoStudyRepo(db),
    },
    analyse: async (analysis, channel, only, focus) => {
      asked.push({ analysis, channel, only, focus });
      return { text: answer, engine: 'claude', skipped: [], turns: 1 };
    },
    listTransfers: () =>
      ({
        formats: [{ key: 'why {subject} left', template: 'why {subject} left' }],
      }) as unknown as TransferList,
    findSnapshot: (channel) => (channel === MINE || channel === '@mine' ? snapshotOf(MINE) : null),
    readTranscript: async (videoId) => {
      transcriptReads.push(videoId);
      if (unreadable.includes(videoId)) throw new Error('YouTube refused');
      const transcript = {
        language: 'en',
        autoGenerated: true,
        segments: [{ startMs: 0, text: `the opening words of ${videoId}` }],
      };
      pages.save(videoId, transcript, NOW);
      return { videoId, transcript, fetchedAt: NOW, fromStore: false };
    },
    isClosing: () => closing,
  };
  engine = lab(deps);
});

describe('what the owner chose for a batch', () => {
  test('is fine when every picked video is a stored video of a channel on this channel’s map', () => {
    expect(engine.conceptProblem(request())).toBeNull();
  });

  test.each([
    [
      'a video from another channel’s map',
      { inspiration: [A, vid('theirs')] },
      /not a stored video/,
    ],
    ['a channel with no map', { centerChannelId: cid('alike') }, /No map/],
    [
      'an opening to model that was not picked',
      { hookModels: [vid('theirs')] },
      /one of the picked/,
    ],
    ['a format that is not this channel’s', { format: { source: 'transfer', key: 'x' } }, /format/],
    ['a formula that is not this channel’s', { format: { source: 'formula', id: 9 } }, /format/],
    ['an angle of two lines', { angle: 'one\ntwo' }, /one line/],
  ] as const)('is refused for %s', (_name, overrides, problem) => {
    expect(engine.conceptProblem(request(overrides))).toMatch(problem);
  });

  test('may name a transfer template or a stored formula of this channel', () => {
    deps.repos.formulas.replace(
      { centerChannelId: MINE, windowDays: 90, engine: 'claude' },
      [{ formula: 'Why [Thing] Left', why: 'A secret.', videoIds: [A, B] }],
      NOW,
    );
    const id = deps.repos.formulas.list(MINE, 90)[0]?.id ?? 0;

    expect(
      engine.conceptProblem(request({ format: { source: 'transfer', key: 'why {subject} left' } })),
    ).toBeNull();
    expect(engine.conceptProblem(request({ format: { source: 'formula', id } }))).toBeNull();
  });
});

describe('a batch of concepts', () => {
  test('is asked of the engine with the batch stored first, and stores what could be read', async () => {
    const { seen, report } = steps();

    const outcome = await engine.makeConcepts(
      request({ angle: 'machines that outlived us', hookModels: [B], only: 'codex' }),
      report,
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ analysis: 'concepts', channel: MINE, only: 'codex' });
    expect(asked[0]?.focus).toEqual({
      kind: 'concepts',
      batchId: outcome.batchId,
      inspiration: [A, B],
      hookModels: [B],
      hasFormat: false,
      angle: 'machines that outlived us',
      length: 'long',
    });
    expect(outcome).toMatchObject({
      kind: 'concepts',
      asked: 10,
      unread: 0,
      note: null,
      engine: 'claude',
    });
    expect(outcome.added).toHaveLength(10);
    expect(seen.map((step) => step.step)).toEqual(['asking', 'reading']);
    expect(engine.findIdeaBrief(MINE, outcome.batchId)?.batch.angle).toBe(
      'machines that outlived us',
    );
  });

  test('shows each concept with what its batch rested on, linking only videos that were picked', async () => {
    await engine.makeConcepts(request({ length: 'shorts' }), () => {});

    const [first] = engine.listConcepts(MINE)?.concepts ?? [];

    expect(first).toMatchObject({
      title: 'The Machine Nobody Switched Off 1',
      origin: 'batch',
      kept: false,
      length: 'shorts',
      pickedCount: 2,
      formatTemplate: null,
    });
    expect(first?.restsOnVideos).toEqual([
      { videoId: A, title: 'Title of alpha', channelId: cid('alike'), channelTitle: 'alike' },
    ]);
  });

  test('comes back short with a plain note, and is still stored', async () => {
    answer = [
      concept(1),
      concept(2).replace('HOOK: Nobody switched it off.\n', ''),
      concept(3),
    ].join('\n\n');

    const outcome = await engine.makeConcepts(request(), () => {});

    expect(outcome.added).toHaveLength(2);
    expect(outcome.unread).toBe(1);
    expect(outcome.note).toMatch(/2 concepts that could be read, not the 10 asked for/);
    expect(engine.listConcepts(MINE)?.concepts).toHaveLength(2);
  });

  test('replaces the concepts that were not kept, and only those', async () => {
    await engine.makeConcepts(request(), () => {});
    const keeper = engine.listConcepts(MINE)?.concepts[3];
    engine.setConceptKept(MINE, keeper?.id ?? 0, true);
    answer = concepts(2);

    await engine.makeConcepts(request(), () => {});

    const titles = engine.listConcepts(MINE)?.concepts.map((one) => [one.title, one.kept]);
    expect(titles).toEqual([
      ['The Machine Nobody Switched Off 4', true],
      ['The Machine Nobody Switched Off 1', false],
      ['The Machine Nobody Switched Off 2', false],
    ]);
  });

  test('changes nothing when the answer holds no concept that can be read', async () => {
    await engine.makeConcepts(request(), () => {});
    answer = 'I could not reach the tools.';

    await expect(engine.makeConcepts(request(), () => {})).rejects.toThrow(/Nothing was changed/);

    expect(engine.listConcepts(MINE)?.concepts).toHaveLength(10);
    expect(deps.repos.concepts.listBatches(MINE)).toHaveLength(1);
  });

  test('leaves no empty batch behind when the engine fails', async () => {
    deps = { ...deps, analyse: () => Promise.reject(new Error('limit')) };

    await expect(lab(deps).makeConcepts(request(), () => {})).rejects.toThrow(/limit/);

    expect(deps.repos.concepts.listBatches(MINE)).toEqual([]);
  });

  test('is refused before anything is asked when what was chosen does not belong to this channel', async () => {
    await expect(
      engine.makeConcepts(request({ inspiration: [vid('theirs')] }), () => {}),
    ).rejects.toThrow(/not a stored video/);
    expect(asked).toEqual([]);
  });

  test('keeps the format the owner picked with the batch, as it read then', async () => {
    const outcome = await engine.makeConcepts(
      request({ format: { source: 'transfer', key: 'why {subject} left' } }),
      () => {},
    );

    expect(asked[0]?.focus).toMatchObject({ hasFormat: true });
    expect(engine.findIdeaBrief('@mine', outcome.batchId)?.batch.format).toEqual({
      source: 'transfer',
      ref: 'why {subject} left',
      template: 'why {subject} left',
    });
    expect(engine.listConcepts(MINE)?.concepts[0]?.formatTemplate).toBe('why {subject} left');
  });
});

describe('growing one concept', () => {
  const firstId = async (): Promise<number> => {
    await engine.makeConcepts(request(), () => {});
    return engine.listConcepts(MINE)?.concepts[0]?.id ?? 0;
  };

  test('a twist asks for three angles and adds them to the concept’s batch, removing nothing', async () => {
    const id = await firstId();
    answer = concepts(3);

    const outcome = await engine.growConcept('twist', MINE, id, undefined, () => {});

    expect(asked[1]).toMatchObject({
      analysis: 'concept-twist',
      channel: MINE,
      focus: { kind: 'concept', conceptId: id },
    });
    expect(outcome.added.map((one) => [one.origin, one.parentId])).toEqual([
      ['twist', id],
      ['twist', id],
      ['twist', id],
    ]);
    expect(engine.listConcepts(MINE)?.concepts).toHaveLength(13);
  });

  test('more like this asks for five and takes no more than five', async () => {
    const id = await firstId();
    answer = concepts(8);

    const outcome = await engine.growConcept('more', MINE, id, 'claude', () => {});

    expect(asked[1]).toMatchObject({ analysis: 'concept-more', only: 'claude' });
    expect(outcome.added).toHaveLength(5);
    expect(outcome.added[0]?.origin).toBe('more');
  });

  test('is refused for a concept of another channel', async () => {
    const id = await firstId();

    await expect(engine.growConcept('twist', OTHER, id, undefined, () => {})).rejects.toThrow(
      /not one of this channel/,
    );
    expect(asked).toHaveLength(1);
  });
});

describe('what a tool is handed', () => {
  test('a concept with its batch and the picked videos, through its own channel only', async () => {
    await engine.makeConcepts(request(), () => {});
    const id = engine.listConcepts(MINE)?.concepts[0]?.id ?? 0;

    const found = engine.findConcept('@mine', id);

    expect(found?.concept.title).toBe('The Machine Nobody Switched Off 1');
    expect(found?.batch.inspiration).toEqual([A, B]);
    expect(found?.picked.map((video) => video.title)).toEqual(['Title of alpha', 'Title of beta']);
    expect(engine.findConcept(OTHER, id)).toBeNull();
    expect(engine.findConcept('not a channel at all', id)).toBeNull();
    expect(engine.findIdeaBrief(OTHER, found?.batch.id ?? 0)).toBeNull();
  });
});

describe('keeping and clearing', () => {
  test('a kept concept survives a clear, and the count of what went is given', async () => {
    await engine.makeConcepts(request(), () => {});
    const id = engine.listConcepts(MINE)?.concepts[0]?.id ?? 0;

    expect(engine.setConceptKept(OTHER, id, true)).toBe(false);
    expect(engine.setConceptKept(MINE, id, true)).toBe(true);
    expect(engine.clearConcepts(MINE)).toBe(9);
    expect(engine.listConcepts(MINE)?.concepts.map((one) => one.id)).toEqual([id]);
  });

  test('a channel with no map has no concept list', () => {
    expect(engine.listConcepts(cid('alike'))).toBeNull();
  });
});

describe('where else this could work', () => {
  test('puts the fixed question for this channel and hands back the answer as text', async () => {
    answer = '1. LANGUAGE MOVE\nNOT CHECKED: Jgtube has not looked for this in Spanish.';
    const { seen, report } = steps();

    const outcome = await engine.whereElse(MINE, 'claude', report);

    expect(asked).toEqual([
      { analysis: 'where-else', channel: MINE, only: 'claude', focus: undefined },
    ]);
    expect(outcome).toEqual({ kind: 'answer', text: answer, engine: 'claude', skipped: [] });
    expect(seen).toHaveLength(1);
  });

  test('is refused for a channel with no map', async () => {
    await expect(engine.whereElse(cid('alike'), undefined, () => {})).rejects.toThrow(/No map/);
  });
});

describe('title formulas', () => {
  const proposal = (formula: string, videos: string): string =>
    [`FORMULA: ${formula}`, 'WHY: It promises a secret.', `VIDEOS: ${videos}`].join('\n');

  test('are stored when they pass the checks, with numbers from the store and the rest listed as dropped', async () => {
    answer = [
      proposal('Why [Thing] Quietly Left', `${A}, ${B}`),
      proposal('The [Thing] Of [Place]', `${A}, ${vid('theirs')}`),
      proposal('Title of alpha', `${A}, ${B}`),
    ].join('\n\n');

    const outcome = await engine.findFormulas(MINE, 90, undefined, () => {});

    expect(asked[0]).toMatchObject({
      analysis: 'title-formulas',
      focus: { kind: 'window', windowDays: 90 },
    });
    expect(outcome).toMatchObject({ kind: 'formulas', proposed: 3, unread: 0, engine: 'claude' });
    expect(outcome.dropped.map((one) => one.formula)).toEqual([
      'The [Thing] Of [Place]',
      'Title of alpha',
    ]);
    expect(outcome.list.formulas).toHaveLength(1);
    expect(outcome.list.formulas[0]).toMatchObject({
      formula: 'Why [Thing] Quietly Left',
      videoCount: 2,
    });
    expect(outcome.list.formulas[0]?.videos.map((video) => video.views)).toEqual([9000, 9000]);
    expect(engine.listFormulas(MINE, 90)).toEqual(outcome.list);
    expect(engine.listFormulas(MINE, 30)?.formulas).toEqual([]);
  });

  test('count only videos inside the window that was asked for', async () => {
    answer = proposal('Why [Thing] Quietly Left', `${A}, ${B}`);

    await expect(engine.findFormulas(MINE, 30, undefined, () => {})).rejects.toThrow(
      /none passed the checks/,
    );
    expect(engine.listFormulas(MINE, 30)?.formulas).toEqual([]);
  });

  test('keep the last run when a new one finds nothing', async () => {
    answer = proposal('Why [Thing] Quietly Left', `${A}, ${B}`);
    await engine.findFormulas(MINE, 90, undefined, () => {});
    answer = 'Nothing stood out.';

    await expect(engine.findFormulas(MINE, 90, undefined, () => {})).rejects.toThrow(
      /not with formulas/,
    );
    expect(engine.listFormulas(MINE, 90)?.formulas).toHaveLength(1);
  });

  test('have no list for a channel with no map', async () => {
    expect(engine.listFormulas(cid('alike'), 90)).toBeNull();
    await expect(engine.findFormulas(cid('alike'), 90, undefined, () => {})).rejects.toThrow(
      /No map/,
    );
  });
});

describe('the hook library', () => {
  test('lists the map’s top breakouts, each as not read until its captions are stored', () => {
    const library = engine.hookLibrary(MINE);

    expect(library).toMatchObject({ centerChannelId: MINE, seconds: 60, cap: 12 });
    expect(library?.hooks.map((hook) => [hook.videoId, hook.captions])).toEqual([
      [A, 'not-read'],
      [B, 'not-read'],
    ]);
    expect(engine.hookLibrary(cid('alike'))).toBeNull();
  });

  test('is built by reading only the captions the store lacks, one video at a time', async () => {
    pages.save(
      A,
      { language: 'en', autoGenerated: false, segments: [{ startMs: 0, text: 'stored words' }] },
      NOW,
    );
    const { seen, report } = steps();

    const outcome = await engine.buildHookLibrary(MINE, report);

    expect(transcriptReads).toEqual([B]);
    expect(seen).toEqual([
      { step: 'captions', text: 'Reading the captions of video 1 of 1: “Title of beta”' },
    ]);
    expect(outcome).toMatchObject({ kind: 'hooks-built', read: 1, failed: [] });
    expect(outcome.library.hooks.map((hook) => hook.text)).toEqual([
      'stored words',
      `the opening words of ${B}`,
    ]);
  });

  test('says which captions could not be read and carries on with the rest', async () => {
    unreadable = [A];

    const outcome = await engine.buildHookLibrary(MINE, () => {});

    expect(transcriptReads).toEqual([A, B]);
    expect(outcome.read).toBe(1);
    expect(outcome.failed).toEqual([{ videoId: A, reason: 'YouTube refused' }]);
  });

  test('stops between videos when Jgtube is closing', async () => {
    closing = true;

    await expect(engine.buildHookLibrary(MINE, () => {})).rejects.toThrow(/closing/);
    expect(transcriptReads).toEqual([]);
  });

  test('has its openings named by an engine, keeping labels only for the videos it holds', async () => {
    await engine.buildHookLibrary(MINE, () => {});
    answer = [
      `VIDEO: ${A}\nSTYLE: Cold Open\nHOW: It starts mid-scene.`,
      `VIDEO: zzzzzzzzzz9\nSTYLE: made up\nHOW: It was never sent.`,
    ].join('\n\n');

    const outcome = await engine.labelHooks(MINE, 'claude', () => {});

    expect(asked[0]).toMatchObject({ analysis: 'hook-styles', channel: MINE, only: 'claude' });
    expect(outcome).toMatchObject({ kind: 'hooks-labelled', labelled: 1, unread: 0 });
    expect(outcome.library.hooks.map((hook) => hook.style)).toEqual(['cold open', null]);
    expect(engine.hookLibrary('@mine')?.hooks[0]?.how).toBe('It starts mid-scene.');
  });

  test('is not sent to an engine before any opening words are stored', async () => {
    await expect(engine.labelHooks(MINE, undefined, () => {})).rejects.toThrow(
      /Build the hook library/,
    );
    expect(asked).toEqual([]);
  });

  test('keeps its labels when an answer names no hook it was sent', async () => {
    await engine.buildHookLibrary(MINE, () => {});
    answer = 'These are all fine hooks.';

    await expect(engine.labelHooks(MINE, undefined, () => {})).rejects.toThrow(
      /Nothing was changed/,
    );
  });
});
