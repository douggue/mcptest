import {
  CONCEPTS_PER_BATCH,
  bibleAnswerSchema,
  markerLines,
  parseClaimVerdicts,
  parseConcepts,
  parseFactSheet,
  parseFormulas,
  parseHookLabels,
  parseHooksAndBeats,
  stageSchemas,
  wordBudget,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  PROMPT_SECTIONS,
  REQUIRED_SECTIONS,
  TAGS_NOTE,
  buildPrompt,
  sectionOf,
  type PromptSection,
} from '../src/promptParts';
import { promptCatalog, type CatalogEntry } from './promptCatalog';

/**
 * The structure every question must have, checked without asking an engine
 * anything: who the engine is, the task, the rule on evidence, the form of
 * the answer; nothing that contradicts the code that reads the answer;
 * nothing fitted to a niche; and lengths that add up.
 */

const catalog = promptCatalog();
const questions = catalog.filter((entry) => !entry.check);
const named = (entries: readonly CatalogEntry[]) =>
  entries.map((entry) => [entry.name, entry] as const);
const find = (name: string): CatalogEntry => {
  const entry = catalog.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`No question is called ${name}`);
  return entry;
};
const part = (entry: CatalogEntry, name: PromptSection): string =>
  sectionOf(entry.prompt, name) ?? '';

const TAG = /<\/?([a-z_]+)>/g;

describe('the parts a question is built from', () => {
  test('sets the sections out in one fixed order and leaves out an empty one', () => {
    const prompt = buildPrompt({
      output_format: ['The form.'],
      task: ['The task.'],
      craft: [],
      rules: ['A rule.', '', false, null],
    });

    expect(prompt).toBe(
      '<task>\nThe task.\n</task>\n\n<rules>\nA rule.\n</rules>\n\n<output_format>\nThe form.\n</output_format>',
    );
    expect(sectionOf(prompt, 'rules')).toBe('A rule.');
    expect(sectionOf(prompt, 'craft')).toBeNull();
  });
});

describe.each(named(questions))('%s', (_name, entry) => {
  test('says who the engine is', () => {
    expect(entry.systemPrompt).toMatch(/^You are /);
  });

  test('has a task, rules on evidence and an output form, each with something in it', () => {
    for (const name of REQUIRED_SECTIONS) {
      expect(part(entry, name).trim(), `<${name}>`).not.toBe('');
    }
  });

  test('uses only the known sections, each once, closed, and in the fixed order', () => {
    const tags = [...entry.prompt.matchAll(TAG)]
      .map((match) => match[0])
      .filter((tag) => (PROMPT_SECTIONS as readonly string[]).includes(tag.replace(/[</>]/g, '')));
    const opened = tags.filter((tag) => !tag.startsWith('</')).map((tag) => tag.slice(1, -1));

    expect(new Set(opened).size).toBe(opened.length);
    expect(opened).toEqual(PROMPT_SECTIONS.filter((name) => opened.includes(name)));
    expect(tags).toEqual(opened.flatMap((name) => [`<${name}>`, `</${name}>`]));
  });

  test('is told that the tags are not part of the answer', () => {
    expect(entry.systemPrompt).toContain(TAGS_NOTE);
  });

  test('carries a rule on evidence: what may be said, and what to do when it is missing', () => {
    const both = `${entry.systemPrompt}\n${part(entry, 'rules')}`;

    expect(both).toMatch(/\bonly\b|\bnever\b/i);
    expect(`${both}\n${part(entry, 'output_format')}`).toMatch(
      /say so|said to be missing|could not (tell|find|see)|not seen|NOT FOUND|NOT HEARD|UNSURE|NOTHING|left out|leave .{0,40}out|or none|or nothing|give fewer/i,
    );
  });

  test('is fitted to no niche and names no AI product', () => {
    const text = `${entry.systemPrompt}\n${entry.prompt}`;

    expect(text).not.toMatch(
      /\b(america|britain|british|finance|gaming|cooking|aviation|crypto|military|true crime)\b/i,
    );
    expect(text).not.toMatch(
      /elevenlabs|midjourney|runway|capcut|chatgpt|gemini|claude|openai|dall-e|sora\b|\bveo\b|kling|premiere|davinci/i,
    );
  });

  test('forbids forecasts wherever it could give a number about views', () => {
    const text = `${entry.systemPrompt}\n${entry.prompt}`;
    if (!/\bviews\b/.test(text)) return;

    expect(text).toMatch(/forecast|predict/i);
  });

  test('closes every marker line it opens', () => {
    const opened = [...entry.prompt.matchAll(/=== ([A-Z ]+) START ===/g)].map((match) => match[1]);

    for (const name of opened) {
      expect(entry.prompt).toContain(markerLines(name ?? '').end);
    }
  });

  test('asks for one form of answer: JSON, or plain text, never both', () => {
    const plain = /Put section titles in CAPITALS/.test(entry.systemPrompt);
    const allowsJson = /When the question asks for JSON/.test(entry.systemPrompt);

    if (entry.json) {
      expect(part(entry, 'output_format')).toMatch(/JSON/);
      expect(plain && !allowsJson, 'a JSON answer under a plain-text system prompt').toBe(false);
    } else {
      expect(part(entry, 'output_format')).not.toMatch(/one JSON object|JSON list/);
    }
  });
});

describe('the one-line checks', () => {
  test('are the only entries not held to the structure', () => {
    expect(catalog.filter((entry) => entry.check).map((entry) => entry.name)).toEqual([
      'connection-check',
    ]);
  });
});

/** An answer written exactly as a question's output form says, read by the real parser. */
describe('no output form contradicts the code that reads the answer', () => {
  const form = (name: string): string => part(find(name), 'output_format');
  const V1 = 'video000001';
  const V2 = 'video000002';

  test('a batch of concepts written to the form is read whole', () => {
    const labels = [
      'TITLE',
      'ALT',
      'THUMBNAIL',
      'OVERLAY',
      'HOOK',
      'HOOK STYLE',
      'RESTS ON',
      'NEEDS',
    ];
    for (const name of ['concepts', 'concept-twist', 'concept-more']) {
      for (const label of labels) expect(form(name)).toContain(`${label}:`);
      expect(form(name)).toContain('"CONCEPT 1"');
    }
    const answer = Array.from({ length: CONCEPTS_PER_BATCH }, (_, at) =>
      [
        `CONCEPT ${at + 1}`,
        `TITLE: A title for subject ${at + 1}`,
        'ALT: A first alternate',
        'ALT: A second alternate',
        'THUMBNAIL: One subject filling half the frame. A dark ground behind it. The overlay top left.',
        'OVERLAY: THREE SHORT WORDS',
        'HOOK: The opening sentence of the video.',
        `HOOK STYLE: ${V1}: a style name`,
        `RESTS ON: ${V1} its structure`,
        'NEEDS: nothing',
      ].join('\n'),
    ).join('\n\n');

    const read = parseConcepts(answer, CONCEPTS_PER_BATCH);

    expect(read.problems).toEqual([]);
    expect(read.concepts).toHaveLength(CONCEPTS_PER_BATCH);
  });

  test('three hooks and a beat sheet written to the form are read', () => {
    expect(form('script-hooks')).toContain('"HOOK 1"');
    for (const label of ['WAY:', 'MODEL:', 'TEXT:', 'BEAT:', '"BEATS"']) {
      expect(form('script-hooks')).toContain(label);
    }
    const answer = [
      ...[1, 2, 3].flatMap((n) => [
        `HOOK ${n}`,
        'WAY: a way of opening',
        `MODEL: ${V1}`,
        'TEXT: The hook, on one line [CHECK: a fact].',
      ]),
      'BEATS',
      'BEAT: 1:00 | First beat | What happens, and what it holds back.',
      'BEAT: 4:00 | Second beat | What happens next.',
    ].join('\n');

    const read = parseHooksAndBeats(answer);

    expect(read.problem).toBeNull();
    expect(read.hooks).toHaveLength(3);
    expect(read.beats).toHaveLength(2);
  });

  test('formulas, hook styles, a fact sheet and a claims check written to their forms are read', () => {
    for (const label of ['FORMULA:', 'WHY:', 'VIDEOS:']) {
      expect(form('title-formulas')).toContain(label);
    }
    for (const label of ['VIDEO:', 'STYLE:', 'HOW:']) expect(form('hook-styles')).toContain(label);
    for (const label of ['"FACT 1:"', '"SOURCE:"', '"NOT FOUND:"', '"DISPUTED:"']) {
      expect(form('research')).toContain(label);
    }
    for (const label of ['"CLAIM 1: CONFIRMED, WRONG or UNSURE"', '"WHY:"', '"CORRECTION:"']) {
      expect(form('research-claims')).toContain(label);
    }

    const formulas = parseFormulas(
      `FORMULA: Fixed words with a [slot]\nWHY: Why it works.\nVIDEOS: ${V1}, ${V2}`,
    );
    const styles = parseHookLabels(`VIDEO: ${V1}\nSTYLE: two words\nHOW: One sentence.`, [V1]);
    const sheet = parseFactSheet(
      'FACT 1: One sentence.\nSOURCE: https://a.example/page\nNOT FOUND: A thing.\nDISPUTED: A point.',
    );
    const verdicts = parseClaimVerdicts(
      'CLAIM 1: WRONG\nWHY: The page says otherwise.\nCORRECTION: The right sentence.\nSOURCE: https://a.example/page',
      1,
    );

    expect(formulas).toMatchObject({ unread: 0, formulas: [{ videoIds: [V1, V2] }] });
    expect(styles).toMatchObject({ unread: 0, labels: [{ videoId: V1, style: 'two words' }] });
    expect(sheet).toMatchObject({ facts: [{ sources: ['https://a.example/page'] }] });
    expect(sheet.notFound).toHaveLength(1);
    expect(verdicts).toMatchObject([{ verdict: 'wrong', correction: 'The right sentence.' }]);
  });

  test('the script draft and the tighten pass keep the headings and cue lines code reads', () => {
    expect(form('script-draft')).toContain('"## HOOK"');
    expect(part(find('script-draft'), 'craft')).toContain(
      '[B-ROLL: what to show | a phrase to search stock footage with',
    );
    expect(part(find('script-tighten'), 'rules')).toMatch(/Keep every heading line/);
  });

  /** A text of exactly the length a question says is allowed. */
  const chars = (count: number): string => 'x'.repeat(count);
  const limit = (text: string, what: RegExp): number => {
    const found = what.exec(text)?.[1];
    if (found === undefined) throw new Error(`The question states no limit matching ${what}`);
    return Number(found.replace(/,/g, ''));
  };

  test('a teardown stage filled to the lengths its question allows is accepted', () => {
    const rules = part(find('teardown-structure'), 'rules');
    const short = limit(rules, /a camera note at most (\d+) characters/);
    const line = limit(rules, /any other one-field text at most (\d+) characters/);
    const long = limit(rules, /of the whole stage at most (\d+) characters/);
    const prompt = limit(rules, /a ready prompt at most (\d+) characters/);
    const times = limit(rules, /A list of times holds at most (\d+)/);
    const at = Array.from({ length: times }, (_, n) => n);

    const accepted = [
      stageSchemas.structure.safeParse({
        format: chars(line),
        summary: chars(long),
        chapters: [
          { title: chars(short), role: chars(short), start: 0, end: 9, summary: chars(line) },
        ],
      }),
      stageSchemas.hook.safeParse({
        summary: chars(long),
        rows: [{ start: 0, end: 1, visual: chars(line), camera: chars(short), onScreenText: '' }],
      }),
      stageSchemas.archetypes.safeParse({
        items: [
          {
            name: chars(short),
            description: chars(line),
            keyframe: 'k-001',
            at,
            buildWith: chars(short),
          },
        ],
      }),
      stageSchemas.techniques.safeParse({
        items: [
          { name: chars(short), description: chars(line), quotes: [{ text: chars(line), at: 3 }] },
        ],
      }),
      stageSchemas.plan.safeParse({
        layers: [{ layer: chars(short), toolType: chars(short), produces: chars(line) }],
        components: [],
        workflow: [chars(line)],
        prompts: { script: chars(prompt), visuals: [], thumbnail: chars(prompt) },
        avoid: [chars(line)],
      }),
    ];

    expect(accepted.map((result) => result.success)).toEqual([true, true, true, true, true]);
  });

  test('every teardown stage states the limits, and a stage with lists states theirs', () => {
    for (const stage of [
      'structure',
      'hook',
      'design',
      'archetypes',
      'motion',
      'techniques',
      'sound',
      'plan',
    ]) {
      expect(part(find(`teardown-${stage}`), 'rules')).toMatch(/or the whole answer is refused/);
    }
    expect(part(find('teardown-techniques'), 'rules')).toMatch(/At most 6 quotes/);
    expect(part(find('teardown-plan'), 'rules')).toMatch(/16 workflow steps/);
  });

  test('a Format Bible filled to the lengths its question allows is accepted', () => {
    const rules = part(find('format-bible'), 'rules');
    const n = (what: RegExp): number => limit(rules, what);
    const bible = {
      coreRules: [chars(n(/what a beat does at most (\d+)/))],
      visualSystem: {
        summary: chars(n(/the look in at most ([\d,]+)/)),
        roles: [{ hex: '#000000', role: chars(n(/a title formula at most (\d+)/)) }],
      },
      components: [
        {
          name: chars(n(/a name or a beat at most (\d+)/)),
          purpose: chars(n(/a thing not to copy at most (\d+)/)),
          build: chars(n(/a motion recipe at most (\d+)/)),
        },
      ],
      thumbnails: [
        {
          name: 'a layout',
          layout: chars(n(/a layout at most (\d+)/)),
          prompt: chars(n(/a thumbnail prompt at most ([\d,]+)/)),
        },
      ],
      masterPrompt: chars(n(/the master prompt at most ([\d,]+)/)),
    };

    expect(bibleAnswerSchema.safeParse(bible).success).toBe(true);
  });
});

describe('lengths add up', () => {
  test('the draft is written to a budget per section that code works out, and the tighten pass keeps it', () => {
    const draft = part(find('script-draft'), 'craft');
    const tighten = part(find('script-tighten'), 'craft');

    expect(draft).toMatch(/wordBudget/);
    expect(draft).toMatch(/adding up to targetWords/);
    expect(draft).toMatch(/Write every section to its own number, within a tenth/);
    expect(draft).toMatch(/under nine tenths of targetWords/);
    expect(tighten).toMatch(/Tightening is not shortening/);
    expect(tighten).toMatch(/within a tenth of the draft’s, section by section/);
  });

  test('whatever the beats, the budget adds up to the length asked and every section gets words', () => {
    // Arrange: many beat sheets, with times that climb by uneven steps.
    const sheets = Array.from({ length: 60 }, (_, at) => {
      const count = 2 + (at % 9);
      const starts = Array.from(
        { length: count },
        (_, n) => 30 + n * (17 + ((at * 7 + n * 13) % 90)),
      );
      const beats = starts
        .map(
          (start, n) =>
            `${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')} | Beat ${n + 1} | x`,
        )
        .join('\n');
      return { beats, targetSeconds: (starts.at(-1) ?? 0) + 45, targetWords: 400 + at * 37 };
    });

    for (const sheet of sheets) {
      // Act
      const budget = wordBudget({ ...sheet, hookWords: 60 }) ?? [];

      // Assert
      expect(budget.reduce((sum, section) => sum + section.words, 0)).toBe(sheet.targetWords);
      expect(budget.every((section) => section.words > 0)).toBe(true);
    }
  });

  test('every question that caps its answer in words says so in the output form, once', () => {
    for (const entry of questions) {
      const caps = [...entry.prompt.matchAll(/(?:At most|up to) [\d,]+ words/g)];
      const inForm = [...part(entry, 'output_format').matchAll(/(?:At most|up to) [\d,]+ words/g)];

      expect(caps.length - inForm.length, entry.name).toBe(0);
      expect(inForm.length, entry.name).toBeLessThanOrEqual(1);
    }
  });
});
