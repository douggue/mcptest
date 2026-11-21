/**
 * A fact sheet: what a web research run found about one concept's subject,
 * read strictly from its fixed form. Each fact is one sentence with one or
 * two https sources; a fact with no https source is not kept as a fact. Code
 * only keeps the addresses: it never opens them.
 *
 * In a script, a fact from the sheet is written with a marker such as [F3]
 * after it. The page turns the marker into a link to its sources, and the
 * clean voiceover leaves it out.
 */

export const MAX_FACTS = 40;
export const MAX_SOURCES_PER_FACT = 2;
const MAX_FACT_CHARS = 500;
const MAX_URL_CHARS = 500;
const MAX_NOTES = 20;

export interface Fact {
  readonly number: number;
  readonly text: string;
  /** One or two https addresses. */
  readonly sources: readonly string[];
}

export interface FactSheet {
  readonly facts: readonly Fact[];
  /** What the run looked for and could not find, or found only without a source. */
  readonly notFound: readonly string[];
  /** What sources disagree on. */
  readonly disputed: readonly string[];
}

const FACT_LINE = /^FACT\s+(\d{1,3})\s*:\s*(\S.*)$/i;
const SOURCE_LINE = /^SOURCE\s*:\s*(\S+)/i;
const NOT_FOUND_LINE = /^NOT FOUND\s*:\s*(\S.*)$/i;
const DISPUTED_LINE = /^DISPUTED\s*:\s*(\S.*)$/i;
/** Marks a model may put round a line or an address. */
const DECORATION = /^[-*•\s]+|[*`<>]/g;

/** The address when it is plain https with a host and nothing hidden in it; else null. */
export function httpsSource(text: string): string | null {
  const trimmed = text.trim().replace(/[).,;]+$/, '');
  if (trimmed.length > MAX_URL_CHARS) return null;
  try {
    const url = new URL(trimmed);
    const plain =
      url.protocol === 'https:' && url.hostname.includes('.') && !url.username && !url.password;
    return plain ? url.toString() : null;
  } catch {
    return null;
  }
}

const clean = (line: string): string => line.replace(DECORATION, '').trim();
const capped = (text: string): string => text.slice(0, MAX_FACT_CHARS);

interface Reading {
  readonly facts: readonly Fact[];
  readonly notFound: readonly string[];
  readonly disputed: readonly string[];
}

/** One line read into the sheet so far. */
function readLine(sheet: Reading, raw: string): Reading {
  const line = clean(raw);
  const fact = FACT_LINE.exec(line);
  if (fact) {
    const number = Number(fact[1]);
    if (sheet.facts.some((one) => one.number === number)) return sheet;
    return {
      ...sheet,
      facts: [...sheet.facts, { number, text: capped(fact[2] ?? ''), sources: [] }],
    };
  }
  const source = SOURCE_LINE.exec(line);
  const last = sheet.facts.at(-1);
  if (source && last) {
    const url = httpsSource(source[1] ?? '');
    if (url === null || last.sources.length >= MAX_SOURCES_PER_FACT || last.sources.includes(url)) {
      return sheet;
    }
    return {
      ...sheet,
      facts: [...sheet.facts.slice(0, -1), { ...last, sources: [...last.sources, url] }],
    };
  }
  const missing = NOT_FOUND_LINE.exec(line);
  if (missing) return { ...sheet, notFound: [...sheet.notFound, capped(missing[1] ?? '')] };
  const disputed = DISPUTED_LINE.exec(line);
  if (disputed) return { ...sheet, disputed: [...sheet.disputed, capped(disputed[1] ?? '')] };
  return sheet;
}

/** The sheet in an answer. A fact with no https source moves to what could not be found. */
export function parseFactSheet(answer: string): FactSheet {
  const read = answer.split(/\r?\n/).reduce(readLine, { facts: [], notFound: [], disputed: [] });
  const sourced = read.facts.filter((fact) => fact.sources.length > 0);
  const unsourced = read.facts.filter((fact) => fact.sources.length === 0).map((fact) => fact.text);
  return {
    facts: sourced.slice(0, MAX_FACTS),
    notFound: [...read.notFound, ...unsourced].slice(0, MAX_NOTES),
    disputed: read.disputed.slice(0, MAX_NOTES),
  };
}

/** A marker in a script naming a fact of the sheet by its number. */
export const FACT_REF = /\[F(\d{1,3})\]/g;
const CHECK = /\[CHECK:[^\]]*\]/g;
const HEADING_OR_CUE = /^(##\s|\[B-ROLL:)/;
/** Stands in for a marker while a line is cut into sentences. */
const SOURCED = '\u2062';
const UNCHECKED = '\u2063';

/** The numbers of the facts a script names, each once, in the order first named. */
export function factRefs(script: string): readonly number[] {
  return [...new Set([...script.matchAll(FACT_REF)].map((match) => Number(match[1])))];
}

/** How many spoken sentences rest on a sourced fact, and how many still hold a check marker. */
export function sentencesOnFacts(script: string): {
  readonly sourced: number;
  readonly unchecked: number;
} {
  const sentences = script
    .split('\n')
    .filter((line) => !HEADING_OR_CUE.test(line.trim()))
    .flatMap(
      (line) =>
        line
          .replace(FACT_REF, SOURCED)
          .replace(CHECK, UNCHECKED)
          .match(/[^.!?]+[.!?]*/g) ?? [],
    );
  return {
    sourced: sentences.filter((sentence) => sentence.includes(SOURCED)).length,
    unchecked: sentences.filter((sentence) => sentence.includes(UNCHECKED)).length,
  };
}
