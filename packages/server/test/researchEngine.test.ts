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

    const first = await engine.checkClaims(MINE, conceptId, undefined, quiet);
    expect(first).toMatchObject({ kind: 'claims', checked: 10, remaining: 2 });
    expect(asked[0]?.prompt).toContain('1. Statement: "Claim 0 is true."');
    const second = await engine.checkClaims(MINE, conceptId, undefined, quiet);
    expect(second).toMatchObject({ checked: 2, remaining: 0 });
    expect(engine.findResearch(MINE, conceptId).claims.map((claim) => claim.verdict)).toEqual([
      'confirmed',
      ...Array.from({ length: 9 }, () => 'unsure'),
      'confirmed',
      'unsure',
    ]);
  });

  test('says so when no claim is marked, without spending anything', async () => {
    scripts.save(MINE, conceptId, { ...EMPTY_SCRIPT, draft: 'No markers here.' }, NOW);

    await expect(engine.checkClaims(MINE, conceptId, undefined, quiet)).rejects.toThrow(
      /no claim/i,
    );
    expect(asked).toEqual([]);
  });
});
