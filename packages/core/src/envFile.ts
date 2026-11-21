import { parseEnv } from 'node:util';

/**
 * Reading and changing the text of a `.env` file, as pure functions.
 *
 * Reading uses the parser Node itself reads the file with at start, so what
 * is shown is what will be in force. Writing changes only the lines that set
 * the names asked for: every other line, comment and blank is kept as it is,
 * and each value written is read back through the same parser before it is
 * accepted, so a value can never be written in a form that reads differently.
 */

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A value that needs no quotes: nothing a parser treats specially. */
const BARE = /^[A-Za-z0-9_.,:/@+-]*$/;
const QUOTES = ["'", '"', '`'] as const;

/** The settings a `.env` text holds, by name. A missing file (null) holds none. */
export function readEnvText(text: string | null): Readonly<Record<string, string>> {
  if (text === null) return {};
  const parsed = parseEnv(text);
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
  );
}

/** A value as it is written after `NAME=`, in the first form that reads back the same. */
function written(name: string, value: string): string {
  const candidates = [
    ...(BARE.test(value) ? [value] : []),
    ...QUOTES.map((quote) => `${quote}${value}${quote}`),
  ];
  // A value on two lines would be taken apart by the line-by-line changes below.
  const fits = /[\r\n]/.test(value)
    ? undefined
    : candidates.find((candidate) => parseEnv(`${name}=${candidate}\n`)[name] === value);
  if (fits === undefined) {
    // The value is never repeated: it may be a key.
    throw new Error(`${name} holds characters that cannot be written to the .env file`);
  }
  return fits;
}

/** Whether a line sets `name`, commented lines aside. */
function sets(line: string, name: string): boolean {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  return match?.[1] === name;
}

/** Whether a line is the commented example of `name`, as `.env.example` writes them. */
const isExampleOf = (line: string, name: string): boolean =>
  new RegExp(`^\\s*#\\s*${name}\\s*=`).test(line);

function setOne(lines: readonly string[], name: string, value: string): readonly string[] {
  const line = `${name}=${written(name, value)}`;
  const last = lines.findLastIndex((existing) => sets(existing, name));
  if (last !== -1) return lines.map((existing, index) => (index === last ? line : existing));
  const example = lines.findLastIndex((existing) => isExampleOf(existing, name));
  if (example !== -1) return [...lines.slice(0, example + 1), line, ...lines.slice(example + 1)];
  // The text ends with a line break, so its last "line" is empty: the new one goes before it.
  const body = lines.at(-1) === '' ? lines.slice(0, -1) : lines;
  return [...body, line, ''];
}

/**
 * The text with each named setting given its new value, or removed when the
 * value is null. `text` is null when there is no file yet. Throws, naming the
 * setting and never its value, for a name or a value that cannot be written.
 */
export function updateEnvText(
  text: string | null,
  changes: Readonly<Record<string, string | null>>,
): string {
  const lineBreak = text?.includes('\r\n') ? '\r\n' : '\n';
  const start: readonly string[] = text === null || text === '' ? [] : text.split(/\r?\n/);
  const lines = Object.entries(changes).reduce((now, [name, value]) => {
    if (!NAME.test(name)) throw new Error('That is not the name of a setting');
    return value === null ? now.filter((line) => !sets(line, name)) : setOne(now, name, value);
  }, start);
  const joined = lines.join(lineBreak);
  return joined === '' || joined.endsWith(lineBreak) ? joined : `${joined}${lineBreak}`;
}
