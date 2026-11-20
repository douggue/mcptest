/**
 * Writes one value the way TOML spells it, for Codex's `-c key=value`
 * settings. Values are built here instead of glued together as text because
 * Windows paths are full of backslashes, which TOML reads as escapes.
 */

export type TomlValue =
  string | number | boolean | readonly TomlValue[] | { readonly [key: string]: TomlValue };

/** A key that needs no quotes. */
const BARE_KEY = /^[A-Za-z0-9_-]+$/;
/** Characters a TOML string cannot hold as they are. */
const NEEDS_ESCAPE = /[\u0000-\u001f\u007f"\\]/g;
const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
};
const HEX = 16;
const CODE_DIGITS = 4;

const escapeCharacter = (character: string): string =>
  SHORT_ESCAPES[character] ??
  `\\u${character.charCodeAt(0).toString(HEX).toUpperCase().padStart(CODE_DIGITS, '0')}`;

const tomlString = (text: string): string => `"${text.replace(NEEDS_ESCAPE, escapeCharacter)}"`;

function tomlNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Only a finite number can be written as TOML');
  return String(value);
}

function tomlTable(table: { readonly [key: string]: TomlValue }): string {
  const entries = Object.entries(table).map(
    ([key, value]) => `${BARE_KEY.test(key) ? key : tomlString(key)} = ${tomlValue(value)}`,
  );
  return entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`;
}

/** A string, number, true or false, list or table, as one line of TOML. */
export function tomlValue(value: TomlValue): string {
  if (typeof value === 'string') return tomlString(value);
  if (typeof value === 'number') return tomlNumber(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  return tomlTable(value as { readonly [key: string]: TomlValue });
}
