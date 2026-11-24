import {
  CONCEPTS_PER_BATCH,
  MAX_FACTS,
  MAX_FACT_CHARS,
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
  MISSING_EVIDENCE,
  OWNER,
  PROMPT_SECTIONS,
  REQUIRED_SECTIONS,
  TAGS_NOTE,
  buildPrompt,
  sectionOf,
  type PromptSection,
} from '../src/promptParts';
import { factsAsked, researchQuestion } from '../src/researchQuestions';
import { SCRIPT_DRAFT_TOOLS } from '../src/scriptQuestions';
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

  test('says a thing once: who the owner is, and what to do when evidence is missing', () => {
    const text = `${entry.systemPrompt}\n${entry.prompt}`;
    const times = (needle: string): number => text.split(needle).length - 1;

    expect(times(OWNER)).toBeLessThanOrEqual(1);
    expect(times(MISSING_EVIDENCE)).toBeLessThanOrEqual(1);
  });

  test('keeps rules on what to write out of the list of tool calls', () => {
    expect(part(entry, 'gather')).not.toMatch(/When there is an active format/);
    expect(part(entry, 'gather')).not.toMatch(/write HOOK STYLE/);
  });

  test('never asks for length for its own sake', () => {
    const text = `${entry.systemPrompt}\n${entry.prompt}`;

    expect(text).not.toMatch(/never stop short of the length/);
    expect(text).not.toMatch(/far shorter than that has left out/);
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

  test('a beat of the length the question asks for, and one three times as long, is kept whole', () => {
    const asked = Number(/what happens, in at most (\d+) words/.exec(form('script-hooks'))?.[1]);
    const beat = (words: number): string =>
      `BEAT: 1:00 | A beat | ${Array.from({ length: words }, () => 'happen').join(' ')}.`;
    const answer = (words: number): string =>
      ['HOOK 1', 'WAY: a way', 'MODEL: none', 'TEXT: A hook.', 'BEATS', beat(words)].join('\n');

    expect(asked).toBeGreaterThan(0);
    for (const words of [asked, asked * 3]) {
      const read = parseHooksAndBeats(answer(words));

      expect(read.beats).toHaveLength(1);
      expect(read.notes).toEqual([]);
    }
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

  /** The room an ordinary English word takes, with its space: longer than the average of five or six. */
  const WORD_CHARS = 7;

  /** A text of exactly the length a question says is allowed. */
  const chars = (count: number): string => 'x'.repeat(count);
  const limit = (text: string, what: RegExp): number => {
    const found = what.exec(text)?.[1];
    if (found === undefined) throw new Error(`The question states no limit matching ${what}`);
    return Number(found.replace(/,/g, ''));
  };

  test('a teardown stage filled to the lengths its question allows is accepted', () => {
    const rules = part(find('teardown-structure'), 'rules');
    // The limits are said in words; a text of that many ordinary words must fit as written.
    const worded = (what: RegExp): number => limit(rules, what) * WORD_CHARS;
    const short = worded(/a camera note in at most (\d+) words/);
    const line = worded(/any other one-field text in about (\d+) words/);
    const long = worded(/of the whole stage in about (\d+) words/);
    const prompt = worded(/a ready prompt in about (\d+) words/);
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
      const rules = part(find(`teardown-${stage}`), 'rules');
      expect(rules).toMatch(/A text that runs over is cut to fit/);
      expect(rules).toMatch(/In a list of times, hexes or strips, leave the list empty/);
      expect(rules).toMatch(/for a keyframe write null/);
      expect(find(`teardown-${stage}`).prompt).not.toMatch(/e\.g\./);
    }
    expect(find('teardown-motion').prompt).toMatch(
      /exactly one of these four words: code, ai-video, editor, stock/,
    );
    expect(part(find('teardown-techniques'), 'rules')).toMatch(/At most 6 quotes/);
    expect(part(find('teardown-plan'), 'rules')).toMatch(/16 workflow steps/);
  });

  test('a Format Bible filled to the lengths its question allows is accepted', () => {
    const rules = part(find('format-bible'), 'rules');
    // The limits are said in words; a text of that many ordinary words must fit as written.
    const n = (what: RegExp): string => chars(limit(rules, what) * WORD_CHARS);
    const bible = {
      coreRules: [n(/what a beat does in about (\d+) words/)],
      visualSystem: {
        summary: n(/the look in about (\d+) words/),
        roles: [{ hex: '#000000', role: n(/a title formula in about (\d+) words/) }],
      },
      components: [
        {
          name: n(/a name or a beat in at most (\d+) words/),
          purpose: n(/a thing not to copy in about (\d+) words/),
          build: n(/a motion recipe in about (\d+) words/),
        },
      ],
      thumbnails: [
        {
          name: 'a layout',
          layout: n(/a layout in about (\d+) words/),
          prompt: n(/a thumbnail prompt in about (\d+) words/),
        },
      ],
      titleFormulas: [{ formula: n(/a title formula in about (\d+) words/), example: '' }],
      masterPrompt: n(/the master prompt in about (\d+) words/),
    };

    expect(bibleAnswerSchema.safeParse(bible).success).toBe(true);
    expect(rules).toMatch(/A text that runs over is cut to fit/);
    expect(rules).not.toMatch(/the whole Bible is refused/);
  });
});

describe('what the first real runs found, kept fixed', () => {
  const BREAKDOWN_PARTS = [
    'titles',
    'thumbnails',
    'scripts',
    'picture',
    'strategy',
    'plan',
    'master',
  ];

  test('a script prompt an answer hands on always has a slot for the length', () => {
    for (const name of [
      'breakdown-scripts',
      'breakdown-plan',
      'breakdown-master',
      'one-video',
      'teardown-plan',
    ]) {
      expect(find(name).prompt, name).toContain('[LENGTH IN MINUTES]');
    }
  });

  test('the Format Bible is given no times of its own for the opening: they come from the shelf', () => {
    const craft = part(find('format-bible'), 'craft');

    expect(craft).toMatch(/with times taken from the hook ingredient on the shelf/);
    expect(craft).toMatch(/where the shelf gives no times, say the order only/);
    expect(craft).not.toMatch(/\b(15|30)\b/);
  });

  test('where a question judges by the 5, 15 and 30 second marks, it says they are its own yardstick', () => {
    for (const name of ['teardown-plan', 'teardown-hook', 'one-video']) {
      expect(find(name).prompt, name).toMatch(/yardstick, not measurements/);
    }
  });

  test('every breakdown part reads the measurements as its first step, and calls no tool from its output form', () => {
    for (const name of BREAKDOWN_PARTS) {
      const entry = find(`breakdown-${name}`);

      expect(part(entry, 'gather').startsWith('1. Call get_channel_measurements'), name).toBe(true);
      expect(part(entry, 'output_format'), name).not.toMatch(/view_teardown_images|\bCall get_/);
      expect(entry.prompt, name).not.toMatch(/get_channel_measurements for the channel first/);
    }
    expect(part(find('breakdown-picture'), 'gather')).toMatch(/view_teardown_images/);
  });

  test('the scripts part asks for the hook and the skeleton once each, and its cap leaves out what is quoted', () => {
    const form = part(find('breakdown-scripts'), 'output_format');

    expect(form).not.toMatch(/HOOK SECOND BY SECOND|SCRIPT TEMPLATE/);
    expect(form).toMatch(/the quoted openings and endings and the script prompt are not counted/);
    expect(part(find('breakdown-plan'), 'output_format')).toMatch(
      /the ready prompts are not counted/,
    );
  });

  test('a ready title marks what no tool returned', () => {
    expect(part(find('breakdown-titles'), 'output_format')).toMatch(
      /any fact, name or number in a ready title that no tool returned is followed by \(check\)/,
    );
  });
});

describe('what the second round of real runs found, kept fixed', () => {
  const CONCEPTS = [
    'concepts',
    'concept-twist',
    'concept-more',
    'concepts (shorts, an angle, a format, formulas, a hook model)',
  ];

  test('an idea’s opening may be two short sentences, and the reader takes them', () => {
    for (const name of CONCEPTS) {
      expect(part(find(name), 'output_format'), name).toContain(
        'HOOK: the opening, at most two short sentences, about 25 words: the promise first, then the open question.',
      );
    }
    const hook = 'A promise is made here in a dozen plain words. Then what is left open?';
    const answer = [
      'CONCEPT 1',
      'TITLE: A title',
      'ALT: One',
      'ALT: Two',
      'THUMBNAIL: A subject.',
      'OVERLAY: TWO WORDS',
      `HOOK: ${hook}`,
      'HOOK STYLE: none',
      'RESTS ON: video000001 its structure',
      'NEEDS: nothing',
    ].join('\n');

    expect(parseConcepts(answer, 1)).toMatchObject({ problems: [], concepts: [{ hook }] });
  });

  test('a batch is shown the ideas already stored, told never to repeat one, and told to vary', () => {
    for (const name of CONCEPTS) {
      const entry = find(name);

      expect(part(entry, 'gather'), name).toMatch(/get_idea_brief[^\n]*storedIdeas/);
      expect(part(entry, 'craft'), name).toMatch(/Never repeat a stored subject/);
      expect(part(entry, 'craft'), name).toMatch(
        /Vary the title’s opening word and the overlay’s position/,
      );
      expect(entry.prompt, name).not.toMatch(/a number a tool gave, a stake/);
    }
  });

  test('a script is aimed at its numbers, and stays short only when the facts run out', () => {
    const system = find('script-draft').systemPrompt;
    const craft = part(find('script-draft'), 'craft');

    expect(system).not.toMatch(/unfinished/);
    expect(system).toMatch(/a section stays short only when the facts have nothing more to give/);
    expect(craft).not.toMatch(/is not finished/);
    expect(craft).toMatch(
      /A section stays short only when the sheet and the tools have nothing more/,
    );
  });

  test('the draft is offered only tools one of its lines uses', () => {
    const draft = find('script-draft').prompt;

    for (const tool of SCRIPT_DRAFT_TOOLS) expect(draft, tool).toContain(tool);
  });

  test('a teardown stage never asks for a null in a text, and its tool calls only call', () => {
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
      const entry = find(`teardown-${stage}`);

      expect(part(entry, 'rules'), stage).toMatch(/Never write null in a text field/);
      expect(part(entry, 'gather'), stage).not.toMatch(
        /\b(Write|Find|Build|Name|Split|Give|Group|Go through) /,
      );
    }
    expect(part(find('teardown-hook'), 'craft')).toMatch(
      /Start "summary" with the reusable pattern/,
    );
  });

  test('every thumbnail prompt an answer hands on keeps clear of the corner and offers the editor', () => {
    for (const name of [
      'one-video',
      'teardown-plan',
      'format-bible',
      'thumbnails',
      'concept-thumbnail',
    ]) {
      const prompt = find(name).prompt;

      expect(prompt, name).toMatch(/bottom-right corner/);
      expect(prompt, name).toMatch(/image editor/);
    }
  });

  test('the Format Bible gives a beat its place in the order, and a second only from the shelf', () => {
    const bible = find('format-bible').prompt;

    expect(bible).toContain('a second only when the hook ingredient gives one');
    expect(bible).not.toContain('by what second');
    expect(bible).not.toMatch(/ends so that the next is needed/);
    expect(find('breakdown-master').prompt).not.toMatch(/must end so that the next is needed/);
    expect(find('breakdown-scripts').prompt).toMatch(/yardstick, not measurements/);
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
    // One anchor for the tighten pass: each section against its own current length.
    expect(tighten).toMatch(
      /Tightening is not shortening: keep each section within a tenth of its current length/,
    );
    expect(tighten).not.toMatch(/wordBudget|the draft’s, section by section/);
  });

  test('the draft never touches the hook, and a section it cannot fill honestly stays short', () => {
    const draft = part(find('script-draft'), 'craft');

    expect(draft).toMatch(/The HOOK is fixed: never lengthen or cut it/);
    expect(draft).toMatch(/a true short section beats a padded one/);
    expect(part(find('script-draft'), 'rules')).not.toMatch(/get_hooks/);
    expect(find('script-draft').prompt).not.toMatch(/library hook/);
  });

  test('the tighten pass reads no fact sheet and is told about none', () => {
    const tighten = find('script-tighten').prompt;

    expect(tighten).not.toMatch(/fact sheet/);
    expect(tighten).toMatch(/no point made twice unless the repeat is a deliberate callback/);
  });

  test('writing short sections again names them only through the tool, and writes no other', () => {
    const lengthen = find('script-lengthen');

    expect(part(lengthen, 'gather')).toMatch(/shortSections/);
    expect(part(lengthen, 'rules')).toMatch(/Write only the sections listed under shortSections/);
    expect(part(lengthen, 'rules')).toMatch(/Never write the HOOK/);
    expect(part(lengthen, 'output_format')).toMatch(/exactly as shortSections gives it/);
  });

  test('a fact sheet is sized to the script, and a fact is held to a length code keeps', () => {
    const sized = researchQuestion({ title: 'T', needs: null, angle: null, targetWords: 2400 });
    const unsized = part(find('research'), 'output_format');
    const words = Number(/of at most (\d+) words/.exec(unsized)?.[1]);

    expect(sized).toMatch(/about 2400 spoken words \(about 16 minutes\)/);
    expect(sized).toMatch(/about one fact for every 60 spoken words, at least 12: about 40 facts/);
    expect(unsized).toMatch(/about one fact for every 60 spoken words of the video, at least 12/);
    expect(factsAsked(null)).toBe(12);
    expect(factsAsked(100_000)).toBeLessThanOrEqual(MAX_FACTS);
    // A fact of that many long words still fits what the reader keeps.
    expect(words * 8).toBeLessThanOrEqual(MAX_FACT_CHARS);
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
