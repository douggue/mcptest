/**
 * The Format Bible as files: one Markdown file in the shape of a production
 * teardown, the measured palette as JSON and a PNG strip, and a font list.
 * Numbers in tables come from the facts code took from the slots, each with
 * its method; the AI's words are marked as its reading. Pictures are linked
 * relative to the file, so the exported folder opens anywhere.
 */
import type { FormatBible, BibleWritten } from './bible';
import type { BibleMeasured } from './bibleFacts';
import { palettePng } from './paletteStrip';
import type { IngredientLayer } from './types';
import type { ZipEntry } from '../teardown/zip';

export const LAYER_TITLES: Readonly<Record<IngredientLayer, string>> = {
  title: 'Title formula',
  hook: 'Hook',
  structure: 'Structure',
  pacing: 'Pacing',
  visual: 'Visual style',
  motion: 'Motion and transitions',
  thumbnail: 'Thumbnail layout',
  sound: 'Sound',
  other: 'Other',
};

const cell = (value: string | number | null | undefined): string =>
  String(value ?? '—')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim() || '—';
const table = (head: readonly string[], rows: readonly (readonly (string | number | null)[])[]) =>
  rows.length === 0
    ? '_Nothing to show._'
    : [
        `| ${head.join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n');
const bullets = (lines: readonly string[]) =>
  lines.length === 0 ? '_Nothing written._' : lines.map((one) => `- ${one}`).join('\n');
const fenced = (words: string) => ['```text', words.replace(/```/g, "'''"), '```'].join('\n');
const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;

/** A measured number as written: "11.4 a minute", "52% of runtime", "-14 LUFS". */
export function valueText(number: Pick<BibleMeasured, 'value' | 'unit'>): string {
  const value = String(Math.round(number.value * 10) / 10);
  if (number.unit === '') return value;
  return number.unit.startsWith('%') ? `${value}${number.unit}` : `${value} ${number.unit}`;
}

function lengthText(seconds: number | null): string {
  if (seconds === null) return 'not set';
  return seconds < 60
    ? `${seconds} s`
    : `${Math.round((seconds / 60) * 10) / 10} min (${seconds} s)`;
}

const measuredRows = (bible: FormatBible, layers: readonly IngredientLayer[]) =>
  table(
    ['Slot', 'Number', 'Value', 'Method', 'From'],
    bible.facts.measured
      .filter((number) => layers.includes(number.layer))
      .filter((number) => !number.label.startsWith('#'))
      .map((number) => [
        LAYER_TITLES[number.layer],
        number.label,
        valueText(number),
        number.method,
        number.from,
      ]),
  );

function visual(bible: FormatBible): string {
  const { facts, written } = bible;
  const roles = new Map(written.visualSystem.roles.map((role) => [role.hex, role.role]));
  const palette =
    facts.palette.length === 0
      ? "_No palette was measured in this format's slots._"
      : [
          table(
            ['Hex', 'Share of runtime', 'From', "Role (AI's reading)"],
            facts.palette.map((c) => [c.hex, percent(c.share), c.from, roles.get(c.hex) ?? null]),
          ),
          '',
          '![Palette strip](palette.png)',
        ].join('\n');
  const seen =
    facts.typography.length === 0
      ? ''
      : `\n\nSeen in the slots' teardowns (AI's reading): ${facts.typography
          .map((t) => `${t.role}: ${t.style}${t.casing ? `, ${t.casing}` : ''}`)
          .join('; ')}.`;
  return [
    written.visualSystem.summary || '_No summary written._',
    '### Palette (measured)',
    palette,
    '### Typography',
    table(
      ['Role', 'Font', 'Weight', 'Casing', 'Use'],
      written.typography.map((t) => [t.role, t.font, t.weight, t.casing, t.use]),
    ) + seen,
  ].join('\n\n');
}

function hookAndChapters(bible: FormatBible): string {
  const { facts, written } = bible;
  const hook = facts.slots.find((slot) => slot.layer === 'hook');
  const length =
    hook?.hookSeconds == null
      ? ''
      : `Hook in the slot runs about ${hook.hookSeconds} s (worked out in code from its counted words and pace).\n\n`;
  const beats = (rows: BibleWritten['hook']) =>
    table(
      ['Beat', 'What it does'],
      rows.map((row) => [row.beat, row.does]),
    );
  return `${length}### Hook\n\n${beats(written.hook)}\n\n### Chapters\n\n${beats(written.chapters)}`;
}

function titles(bible: FormatBible): string {
  const measured = bible.facts.titleFormulas.map((formula) => {
    const parts = [
      formula.videos === null ? null : `${formula.videos} videos`,
      formula.channels === null ? null : `${formula.channels} channels`,
      formula.score === null ? null : `${formula.score}×`,
    ].filter((part): part is string => part !== null);
    return `\`${formula.formula}\`${parts.length === 0 ? '' : ` — ${parts.join(' · ')} (measured)`}`;
  });
  return [
    measured.length === 0 ? '_No title formula in the slots._' : bullets(measured),
    '### Formulas to write with',
    table(
      ['Formula', 'Example'],
      bible.written.titleFormulas.map((t) => [t.formula, t.example]),
    ),
  ].join('\n\n');
}

function thumbnails(written: BibleWritten): string {
  if (written.thumbnails.length === 0) return '_Nothing written._';
  return written.thumbnails
    .map((t) => `### ${t.name}\n\n${t.layout}\n\n${fenced(t.prompt)}`)
    .join('\n\n');
}

function pipeline(written: BibleWritten): string {
  if (written.pipeline.length === 0) return '_Nothing written._';
  return written.pipeline
    .map(
      (part) =>
        `### ${LAYER_TITLES[part.layer]}\n\n${part.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    )
    .join('\n\n');
}

function evidence(bible: FormatBible, imageFolder: string): string {
  const { facts } = bible;
  const slots = table(
    ['Slot', 'Ingredient', 'From', 'Evidence', 'Your note'],
    facts.slots.map((slot) => [
      LAYER_TITLES[slot.layer],
      slot.name,
      slot.from,
      [
        slot.proven ? 'Proven' : 'Not proven',
        slot.evidence.videos === null ? null : `${slot.evidence.videos} videos`,
        slot.evidence.channels === null ? null : `${slot.evidence.channels} channels`,
        slot.evidence.score === null ? null : `${slot.evidence.score}×`,
      ]
        .filter(Boolean)
        .join(' · '),
      slot.note || null,
    ]),
  );
  const pictures = facts.pictures.map((p) => `![${p.name}](${imageFolder}/${p.name})`).join('\n');
  return [
    slots,
    '### Measured',
    measuredRows(bible, [
      'title',
      'hook',
      'structure',
      'pacing',
      'visual',
      'motion',
      'thumbnail',
      'sound',
      'other',
    ]),
    ...(pictures === '' ? [] : ['### Pictures', pictures]),
  ].join('\n\n');
}

function caveats(bible: FormatBible): string {
  const parts = [
    ...(bible.unbacked.length === 0
      ? []
      : [
          '### Numbers in the AI text that no measurement holds',
          bullets(bible.unbacked.map((u) => `${u.where}: ${u.number}`)),
        ]),
    ...(bible.dropped.length === 0 ? [] : ['### Left out by the checks', bullets(bible.dropped)]),
  ];
  return parts.length === 0 ? '' : `## Caveats\n\n${parts.join('\n\n')}`;
}

export function bibleMarkdown(name: string, bible: FormatBible, imageFolder = 'images'): string {
  const { written, facts } = bible;
  const ai = `_AI's reading (${bible.engine})._`;
  const wpm =
    facts.wordsPerMinute === null ? '' : ` · Words a minute: ${facts.wordsPerMinute} (measured)`;
  return [
    `# Format Bible: ${name}`,
    `_Written ${bible.writtenAt.slice(0, 10)} by an AI (${bible.engine}) from this format's slots. Numbers in tables were measured in code, each with its method and source; text marked "AI's reading" is the AI's words, not a measurement._`,
    `Planned length: ${lengthText(facts.format.targetSeconds)}${wpm}`,
    ...(facts.format.notes === '' ? [] : [`Your notes: ${facts.format.notes}`]),
    '## 1. Core rules',
    ai,
    bullets(written.coreRules),
    '## 2. Visual system',
    ai,
    visual(bible),
    '## 3. Component kit',
    ai,
    table(
      ['Component', 'Purpose', 'How to build it'],
      written.components.map((c) => [c.name, c.purpose, c.build]),
    ),
    '## 4. Motion recipes',
    ai,
    table(
      ['Move', 'Recipe'],
      written.motion.map((m) => [m.name, m.recipe]),
    ),
    measuredRows(bible, ['motion']),
    '## 5. Pacing rules',
    ai,
    bullets(written.pacing),
    measuredRows(bible, ['pacing']),
    '## 6. Hook & chapter template',
    ai,
    hookAndChapters(bible),
    '## 7. Title formulas',
    titles(bible),
    '## 8. Thumbnail layouts',
    ai,
    thumbnails(written),
    '## 9. Sound & mix targets',
    ai,
    bullets(written.sound),
    measuredRows(bible, ['sound']),
    '## 10. Production pipeline, layer by layer',
    ai,
    pipeline(written),
    '## 11. Master prompt',
    ai,
    fenced(written.masterPrompt),
    '## 12. What not to copy',
    ai,
    bullets(written.doNotCopy),
    '## Evidence: the slots and what code measured',
    evidence(bible, imageFolder),
    caveats(bible),
  ]
    .filter((part) => part !== '')
    .join('\n\n')
    .concat('\n');
}

const utf8 = (words: string): Uint8Array => Buffer.from(words, 'utf8');

function fontList(name: string, bible: FormatBible): string {
  const named = bible.written.typography.map(
    (t) =>
      `${t.font}${t.weight ? ` ${t.weight}` : ''}${t.casing ? `, ${t.casing}` : ''} — ${t.role}`,
  );
  const seen = bible.facts.typography.map(
    (t) => `${t.role}: ${t.style}${t.casing ? `, ${t.casing}` : ''}`,
  );
  return [
    `Fonts for ${name}`,
    "AI's reading: the fonts the Bible names. Check each one's licence before you use it.",
    '',
    ...(named.length === 0 ? ['(none named)'] : named),
    ...(seen.length === 0 ? [] : ['', "Seen in the slots' teardowns (AI's reading):", ...seen]),
    '',
  ].join('\n');
}

/** The Bible's own files; the pictures are added by whoever reads them from disk. */
export function bibleFiles(name: string, bible: FormatBible): readonly ZipEntry[] {
  const roles = new Map(bible.written.visualSystem.roles.map((role) => [role.hex, role.role]));
  const palette = {
    measured: true,
    note: 'Colours and shares measured in code from the slots’ teardowns; roles are the AI’s reading.',
    colours: bible.facts.palette.map((c) => ({
      hex: c.hex,
      share: c.share,
      role: roles.get(c.hex) ?? null,
      from: c.from,
    })),
  };
  return [
    { name: 'format-bible.md', bytes: utf8(bibleMarkdown(name, bible)) },
    { name: 'palette.json', bytes: utf8(`${JSON.stringify(palette, null, 2)}\n`) },
    ...(bible.facts.palette.length === 0
      ? []
      : [{ name: 'palette.png', bytes: palettePng(bible.facts.palette) }]),
    { name: 'fonts.txt', bytes: utf8(fontList(name, bible)) },
  ];
}
