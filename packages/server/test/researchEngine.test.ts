import {
  EMPTY_SCRIPT,
  SqliteConceptRepo,
  SqliteResearchRepo,
  SqliteScriptRepo,
  openDatabase,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import type { WebRunRequest } from '../src/engines/webRun';
import { researchEngine, type ResearchEngine } from '../src/researchEngine';

const NOW = new Date('2026-11-21T12:00:00Z');
const MINE = `UC${'m'.repeat(22)}`;
const OTHER = `UC${'o'.repeat(22)}`;

let engine: ResearchEngine;
let conceptId: number;
let scripts: SqliteScriptRepo;
let asked: WebRunRequest[];
let answer: string;

beforeEach(() => {
  const db = openDatabase(':memory:');
  const concepts = new SqliteConceptRepo(db);
  const batch = concepts.createBatch(
    {
      centerChannelId: MINE,
      inspiration: ['aaaaaaaaaa1'],
      hookModels: [],
      format: null,
      angle: 'machines that outlived us',
      length: 'long',
    },
    NOW,
  );
  const [stored] = concepts.addConcepts(
    batch,
    [
      {
        title: 'The Battery That Runs on Rust',
        altTitles: ['A', 'B'],
        thumbnail: 'x',
        overlay: 'y',
        hook: 'h',
        hookStyle: null,
        restsOn: 'r',
        needs: 'Which company builds it',
        origin: 'batch',
        parentId: null,
        engine: 'claude',
      },
    ],
    NOW,
  );
  conceptId = stored?.id ?? 0;
  scripts = new SqliteScriptRepo(db);
  asked = [];
  answer = 'FACT 1: Form Energy builds it in Weirton, West Virginia.\nSOURCE: https://a.example/b';
  engine = researchEngine({
    now: () => NOW,
    repos: { concepts, scripts, research: new SqliteResearchRepo(db) },
    runWeb: async (request) => {
      asked.push(request);
      return { text: answer, turns: 4 };
    },
  });
});

const quiet = () => undefined;

describe('researching a concept’s subject', () => {
  test('asks a web-only run about the concept’s own words and keeps the fact sheet', async () => {
    const outcome = await engine.researchConcept(MINE, conceptId, undefined, quiet);

    expect(asked[0]?.prompt).toContain('"The Battery That Runs on Rust"');
    expect(asked[0]?.prompt).toContain('"Which company builds it"');
    expect(asked[0]?.prompt).toContain('"machines that outlived us"');
    expect(outcome).toMatchObject({ kind: 'research', conceptId, engine: 'claude' });
    expect(engine.findResearch(MINE, conceptId).sheet?.facts).toHaveLength(1);
    expect(engine.findResearch(OTHER, conceptId).sheet).toBeNull();
  });

  test('sizes the sheet to the script and asks for what its hook and beats still mark to check', async () => {
    scripts.save(
      MINE,
      conceptId,
      {
        wordsPerMinute: 150,
        targetSeconds: 960,
        chosenHook: 'It runs for days [CHECK: how many hours it runs].',
        beats: '1:00 | The wall | Where others stop [CHECK: how long others last] [F3]',
      },
      NOW,
    );

    await engine.researchConcept(MINE, conceptId, undefined, quiet);

    const prompt = asked[0]?.prompt ?? '';
    expect(prompt).toContain('about 2400 spoken words (about 16 minutes)');
    expect(prompt).toContain('about 40 facts');
    expect(prompt).toContain('(1): "how many hours it runs".');
    expect(prompt).toContain('(2): "how long others last".');
  });

  test('says on the sheet how many of the things marked to check one run could not take', async () => {
    const marked = Array.from({ length: 24 }, (_, at) => `Claim ${at} [CHECK: thing ${at}].`);
    scripts.save(MINE, conceptId, { chosenHook: marked.join(' ') }, NOW);

    await engine.researchConcept(MINE, conceptId, undefined, quiet);

    expect(asked[0]?.prompt).toContain('(20): "thing 19".');
    expect(asked[0]?.prompt).not.toContain('"thing 20"');
    expect(engine.findResearch(MINE, conceptId).sheet?.notFound[0]).toMatch(
      /^Not looked up in this run: 4 more of the 24 things/,
    );
  });

  test('a fact too long to keep is left off, and the sheet the owner sees says so', async () => {
    const long = `It ${'was built and opened and '.repeat(30)}closed.`;
    answer = `FACT 1: A short fact.\nSOURCE: https://a.example/1\nFACT 2: ${long}\nSOURCE: https://a.example/2`;

    await engine.researchConcept(MINE, conceptId, undefined, quiet);

    const sheet = engine.findResearch(MINE, conceptId).sheet;
    expect(sheet?.facts.map((fact) => fact.number)).toEqual([1]);
    expect(sheet?.notFound[0]).toMatch(/^Fact 2 was left off the sheet/);
  });

  test('keeps nothing from an answer with no fact sheet in it', async () => {
    answer = 'I could not search the web.';

    await expect(engine.researchConcept(MINE, conceptId, undefined, quiet)).rejects.toThrow(
      /no fact sheet.*Nothing was changed/,
    );
    expect(engine.findResearch(MINE, conceptId).sheet).toBeNull();
  });

  test('is refused for another channel’s concept and for an engine that has no proven web tools', async () => {
    await expect(engine.researchConcept(OTHER, conceptId, undefined, quiet)).rejects.toThrow(
      /concepts/,
    );
    await expect(engine.researchConcept(MINE, conceptId, 'codex', quiet)).rejects.toThrow(
      /Claude Code/,
    );
    expect(asked).toEqual([]);
  });
});

describe('checking a script’s claims', () => {
  const draft = Array.from(
    { length: 12 },
    (_, n) => `Claim ${n} is true [CHECK: claim ${n}].`,
  ).join(' ');

  test('checks the next ten marked claims, keeps a verdict for each and says how many remain', async () => {
    scripts.save(MINE, conceptId, { ...EMPTY_SCRIPT, draft }, NOW);
    answer = 'CLAIM 1: CONFIRMED\nWHY: Yes.\nSOURCE: https://a.example/1';

    const first = await engine.checkClaims(MINE, conceptId, 'draft', undefined, quiet);
    expect(first).toMatchObject({ kind: 'claims', checked: 10, remaining: 2 });
    expect(asked[0]?.prompt).toContain('1. Statement: "Claim 0 is true."');
    const second = await engine.checkClaims(MINE, conceptId, 'draft', undefined, quiet);
    expect(second).toMatchObject({ checked: 2, remaining: 0 });
    // The tightened draft is its own text: its markers are checked only when it is the one asked for.
    scripts.save(MINE, conceptId, { tightened: 'Short [CHECK: short].' }, NOW);
    await engine.checkClaims(MINE, conceptId, 'tightened', undefined, quiet);
    expect(asked.at(-1)?.prompt).toContain('"Short."');
    expect(engine.findResearch(MINE, conceptId).claims.map((claim) => claim.verdict)).toEqual([
      'confirmed',
      ...Array.from({ length: 9 }, () => 'unsure'),
      'confirmed',
      'unsure',
      'confirmed',
    ]);
  });

  test('says so when no claim is marked, without spending anything', async () => {
    scripts.save(MINE, conceptId, { ...EMPTY_SCRIPT, draft: 'No markers here.' }, NOW);

    await expect(engine.checkClaims(MINE, conceptId, 'draft', undefined, quiet)).rejects.toThrow(
      /no claim/i,
    );
    expect(asked).toEqual([]);
  });
});
