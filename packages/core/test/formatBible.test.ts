import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { checkBible, unbackedNumbers } from '../src/format/bible';
import { bibleFacts, knownNumbers } from '../src/format/bibleFacts';
import { bibleFiles, bibleMarkdown } from '../src/format/bibleMarkdown';
import type { Format } from '../src/format/formats';
import { palettePng, PALETTE_STRIP_HEIGHT, PALETTE_STRIP_WIDTH } from '../src/format/paletteStrip';
import type { Ingredient, MeasuredNumber } from '../src/format/types';

const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-24T10:00:00Z');

const number = (label: string, value: number, unit = '', method = 'm'): MeasuredNumber => ({
  label,
  value,
  unit,
  method,
});

const item = (id: number, parts: Partial<Ingredient> = {}): Ingredient => ({
  id,
  layer: 'title',
  name: `Item ${id}`,
  source: 'formula',
  sourceKey: String(id),
  sourceLabel: `Source ${id}`,
  centerChannelId: null,
  channelIds: [A],
  details: {},
  evidence: { score: null, scoredVideos: 0, videos: 1, channels: 1, measured: [] },
  media: [],
  note: '',
  addedAt: NOW.toISOString(),
  proven: false,
  ...parts,
});

const shelf: Ingredient[] = [
  item(1, {
    layer: 'title',
    name: 'Why [thing] failed in [year]',
    details: { formula: 'Why [thing] failed in [year]' },
    evidence: { score: 4.3, scoredVideos: 5, videos: 6, channels: 3, measured: [] },
    proven: true,
  }),
  item(2, {
    layer: 'hook',
    name: 'Cold open',
    evidence: {
      score: 6.1,
      scoredVideos: 3,
      videos: 3,
      channels: 2,
      measured: [
        number('Words in the first minute', 148, 'words'),
        number('Pace of the opening', 153, 'words a minute'),
      ],
    },
    media: [{ kind: 'quote', text: 'In 1962 a plane vanished.', videoId: 'aaaaaaaaaa4' }],
  }),
  item(3, {
    layer: 'visual',
    name: 'Palette',
    source: 'teardown',
    details: {
      section: 'palette',
      palette: [
        { hex: '#0A0B0E', share: 0.52 },
        { hex: '#E63946', share: 0.12 },
      ],
    },
    evidence: {
      score: null,
      scoredVideos: 0,
      videos: 1,
      channels: 1,
      measured: [number('#0A0B0E', 52, '% of runtime', 'k-means')],
    },
    media: [{ kind: 'keyframe', videoId: 'seedVideo01', file: 'k-001.jpg' }],
  }),
  item(4, {
    layer: 'pacing',
    name: 'Pacing',
    evidence: {
      score: null,
      scoredVideos: 0,
      videos: 1,
      channels: 1,
      measured: [
        number('Cuts a minute', 11.4, 'a minute', 'ffmpeg scene > 0.3'),
        number('Words a minute', 162, 'words a minute', 'counted in the captions'),
      ],
    },
  }),
  item(5, {
    layer: 'visual',
    name: 'Typography',
    details: {
      section: 'typography',
      reading: [{ role: 'Title', style: 'Heavy condensed sans', casing: 'upper', examples: [] }],
    },
  }),
  item(6, { layer: 'sound', name: 'Not in a slot' }),
];

const format: Format = {
  id: 7,
  channelId: A,
  name: 'Long-form',
  targetSeconds: 720,
  notes: 'Calm explainers.',
  slots: {
    title: { ingredientId: 1, note: '' },
    hook: { ingredientId: 2, note: 'Open on the plane.' },
    visual: { ingredientId: 3, note: '' },
    pacing: { ingredientId: 4, note: '' },
  },
  suggestion: null,
  bible: null,
  copiedFrom: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

const answer = {
  coreRules: ['One idea a video.', 'Cut about 11.4 times a minute.'],
  visualSystem: {
    summary: 'Dark ground, one red accent.',
    roles: [
      { hex: '#0a0b0e', role: 'Background' },
      { hex: '#123456', role: 'Made up' },
    ],
  },
  typography: [{ role: 'Title', font: 'Inter Tight', weight: '800', casing: 'upper', use: 'On maps' }],
  components: [{ name: 'Map pin', purpose: 'Place', build: 'Code it.' }],
  motion: [{ name: 'Line draws', recipe: 'Stroke over 15 frames.' }],
  pacing: ['A cut every 5 seconds.'],
  hook: [{ beat: 'Cold open', does: 'Starts mid-scene.' }],
  chapters: [{ beat: 'Setup', does: 'Who and where.' }],
  titleFormulas: [{ formula: 'Why [thing] failed in [year]', example: 'Why Concorde failed in 2003' }],
  thumbnails: [{ name: 'Object on dark', layout: 'Left object, right word', prompt: 'A plane on black.' }],
  sound: ['Voice on top of a low drone.'],
  pipeline: [{ layer: 'visual', steps: ['Draw the map.', 'Grade it dark.'] }],
  masterPrompt: 'Make a calm explainer.',
  doNotCopy: ['Their logo.'],
};

describe('the facts of a format, from code', () => {
  test('lists the filled slots with their evidence, measured numbers, palette and formulas', () => {
    const facts = bibleFacts(format, shelf);
    expect(facts.format).toEqual({ name: 'Long-form', targetSeconds: 720, notes: 'Calm explainers.' });
    expect(facts.slots.map((slot) => slot.layer)).toEqual(['title', 'hook', 'visual', 'pacing']);
    expect(facts.slots[1]).toMatchObject({
      name: 'Cold open',
      from: 'Source 2',
      proven: false,
      note: 'Open on the plane.',
      hookSeconds: 58,
    });
    expect(facts.palette).toEqual([
      { hex: '#0A0B0E', share: 0.52, from: 'Source 3' },
      { hex: '#E63946', share: 0.12, from: 'Source 3' },
    ]);
    expect(facts.measured).toContainEqual({
      layer: 'pacing',
      from: 'Source 4',
      label: 'Cuts a minute',
      value: 11.4,
      unit: 'a minute',
      method: 'ffmpeg scene > 0.3',
    });
    expect(facts.titleFormulas).toEqual([
      { formula: 'Why [thing] failed in [year]', videos: 6, channels: 3, score: 4.3 },
    ]);
    expect(facts.wordsPerMinute).toBe(162);
    expect(facts.pictures).toEqual([{ name: 'i3-1.jpg', ingredientId: 3, ref: { kind: 'teardown', videoId: 'seedVideo01', file: 'k-001.jpg' } }]);
    expect(facts.typography).toEqual([]);
  });

  test('a format with nothing measured has no palette, no pace and no hook length', () => {
    const facts = bibleFacts({ ...format, slots: { visual: { ingredientId: 5, note: '' } } }, shelf);
    expect(facts.palette).toEqual([]);
    expect(facts.wordsPerMinute).toBeNull();
    expect(facts.typography).toEqual([{ role: 'Title', style: 'Heavy condensed sans', casing: 'upper' }]);
    expect(bibleFacts({ ...format, slots: {} }, shelf).slots).toEqual([]);
  });

  test('the numbers the facts hold, as shares too', () => {
    const known = knownNumbers(bibleFacts(format, shelf));
    for (const value of [11.4, 162, 720, 12, 52, 6, 3, 4.3, 148, 153, 58]) {
      expect(known.has(value)).toBe(true);
    }
  });
});

describe('the Bible an AI writes, as code keeps it', () => {
  test('keeps what fits, drops colours not measured and flags numbers no fact holds', () => {
    const facts = bibleFacts(format, shelf);
    const checked = checkBible(`Here it is: ${JSON.stringify(answer)}`, facts, 'claude', NOW);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const { bible } = checked;
    expect(bible.engine).toBe('claude');
    expect(bible.writtenAt).toBe(NOW.toISOString());
    expect(bible.written.visualSystem.roles).toEqual([{ hex: '#0A0B0E', role: 'Background' }]);
    expect(bible.dropped).toEqual(['#123456 was not measured in any slot, so its role was left out.']);
    expect(bible.unbacked).toEqual([
      { where: 'Pacing rules', number: 5 },
      { where: 'Typography', number: 800 },
      { where: 'Title formulas', number: 2003 },
      { where: 'Motion recipes', number: 15 },
    ].sort((a, b) => a.where.localeCompare(b.where)));
    expect(bible.facts).toEqual(facts);
  });

  test('refuses an answer that is not a Bible', () => {
    const facts = bibleFacts(format, shelf);
    expect(checkBible('no json', facts, 'claude', NOW)).toEqual({
      ok: false,
      reason: 'the answer held no Format Bible in the form asked for',
    });
    expect(checkBible(JSON.stringify({ coreRules: [] }), facts, 'claude', NOW).ok).toBe(false);
  });

  test('numbers: hex codes, small counts and known values are fine', () => {
    const known = new Set([11.4, 162]);
    expect(unbackedNumbers('Use #E63946 and 3 beats at 11.4 cuts; 162 wpm', known)).toEqual([]);
    expect(unbackedNumbers('About 40% faster, 1,200 views, -14 LUFS', known)).toEqual([40, 1200, -14]);
  });
});

describe('the Bible as files', () => {
  const facts = bibleFacts(format, shelf);
  const checked = checkBible(JSON.stringify(answer), facts, 'claude', NOW);
  if (!checked.ok) throw new Error('fixture');
  const bible = checked.bible;

  test('one Markdown file in the production-teardown shape, measured and AI text labelled', () => {
    const text = bibleMarkdown('Long-form', bible);
    for (const heading of [
      '# Format Bible: Long-form',
      '## 1. Core rules',
      '## 2. Visual system',
      '### Palette (measured)',
      '### Typography',
      '## 3. Component kit',
      '## 4. Motion recipes',
      '## 5. Pacing rules',
      '## 6. Hook & chapter template',
      '## 7. Title formulas',
      '## 8. Thumbnail layouts',
      '## 9. Sound & mix targets',
      '## 10. Production pipeline, layer by layer',
      '## 11. Master prompt',
      '## 12. What not to copy',
      '## Evidence: the slots and what code measured',
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("_AI's reading (claude)._");
    expect(text).toContain('| #0A0B0E | 52% | Source 3 |');
    expect(text).toContain('| Pacing | Cuts a minute | 11.4 a minute | ffmpeg scene > 0.3 | Source 4 |');
    expect(text).toContain('6 videos · 3 channels · 4.3× (measured)');
    expect(text).toContain('Numbers in the AI text that no measurement holds');
    expect(text).toContain('![i3-1.jpg](images/i3-1.jpg)');
    expect(text).not.toContain('#123456');
  });

  test('palette JSON, a font list and the Markdown, ready to zip', () => {
    const files = bibleFiles('Long-form', bible);
    expect(files.map((file) => file.name)).toEqual([
      'format-bible.md',
      'palette.json',
      'palette.png',
      'fonts.txt',
    ]);
    const palette = JSON.parse(Buffer.from(files[1]!.bytes).toString('utf8'));
    expect(palette).toMatchObject({
      measured: true,
      colours: [
        { hex: '#0A0B0E', share: 0.52, role: 'Background', from: 'Source 3' },
        { hex: '#E63946', share: 0.12, role: null, from: 'Source 3' },
      ],
    });
    const fonts = Buffer.from(files[3]!.bytes).toString('utf8');
    expect(fonts).toContain('Inter Tight');
    expect(fonts).toContain("AI's reading");
  });

  test('a Bible with no palette has an empty strip note and no PNG', () => {
    const plain = { ...bible, facts: { ...bible.facts, palette: [] } };
    expect(bibleFiles('A', plain).map((file) => file.name)).toEqual([
      'format-bible.md',
      'palette.json',
      'fonts.txt',
    ]);
    expect(bibleMarkdown('A', plain)).toContain('No palette was measured');
  });
});

describe('the palette strip', () => {
  test('a PNG strip with each colour as wide as its share', () => {
    const png = palettePng([
      { hex: '#FF0000', share: 0.75 },
      { hex: '#0000FF', share: 0.25 },
    ]);
    const buffer = Buffer.from(png);
    expect(buffer.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(buffer.readUInt32BE(16)).toBe(PALETTE_STRIP_WIDTH);
    expect(buffer.readUInt32BE(20)).toBe(PALETTE_STRIP_HEIGHT);
    const idatLength = buffer.readUInt32BE(33);
    const pixels = inflateSync(buffer.subarray(41, 41 + idatLength));
    const row = pixels.subarray(1, 1 + PALETTE_STRIP_WIDTH * 3);
    expect([...row.subarray(0, 3)]).toEqual([255, 0, 0]);
    expect([...row.subarray(row.length - 3)]).toEqual([0, 0, 255]);
    const firstBlue = PALETTE_STRIP_WIDTH * 0.75;
    expect([...row.subarray(firstBlue * 3, firstBlue * 3 + 3)]).toEqual([0, 0, 255]);
  });

  test('refuses no colours or a colour that is not a hex code', () => {
    expect(() => palettePng([])).toThrow();
    expect(() => palettePng([{ hex: 'red', share: 1 }])).toThrow(/hex/);
  });
});
