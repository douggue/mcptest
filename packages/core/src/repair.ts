import type { z } from 'zod';
import { shortened } from './script/stages';

/**
 * Keeps an engine's JSON answer that has one thing wrong instead of refusing
 * the whole of it. An answer is checked against its schema; what does not
 * fit is repaired where that can be done honestly, and it is checked again:
 * a text too long is shortened at the end of a sentence, a list too long
 * keeps its first entries, an entry that cannot be read is left out, a null
 * where a text may be left out is taken as left out.
 *
 * Nothing is made up. A required part that is missing stays missing, and the
 * answer is then refused, naming the field. Every repair is said in words,
 * for the owner to read beside what was kept.
 */

export type Path = readonly PropertyKey[];

/** One thing a schema found wrong, as zod reports it. */
export interface Issue {
  readonly code?: string;
  readonly path: Path;
  readonly message: string;
  readonly maximum?: number | bigint;
  readonly minimum?: number | bigint;
}

/** A repair to make: an entry taken out of its list, a key taken away, or a value set. */
export type Repair =
  | { readonly drop: Path; readonly note: string | null }
  | { readonly remove: Path; readonly note: string | null }
  | { readonly set: Path; readonly value: unknown; readonly note: string | null };

export interface RepairRules {
  /** Lists whose entries are checked one by one: a bad entry is dropped, the list stays. */
  readonly typedLists?: readonly string[];
  /**
   * The repairs only this kind of answer knows: tried first. Undefined
   * leaves the issue to the general repairs; null says it cannot be repaired.
   */
  readonly special?: (root: unknown, issue: Issue) => Repair | null | undefined;
  /** Whether a required text left empty at this path may be kept as "not stated". */
  readonly mayBeUnstated?: (path: Path) => boolean;
}

export type Fitted<T> =
  | { readonly ok: true; readonly data: T; readonly repaired: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/** What stands in a required text an answer left empty, where that is safe. */
export const NOT_STATED = 'not stated';
/** How many times an answer is repaired and checked again: a repair can uncover the next thing wrong. */
const REPAIR_ROUNDS = 6;
const MAX_ISSUES = 3;

export const isIndex = (key: PropertyKey | undefined): key is number => typeof key === 'number';

/** Where in the answer something is, in words: "items 2, description". */
export const placeOf = (path: Path): string =>
  path
    .map((key, index) =>
      isIndex(key) ? ` ${key + 1}` : `${index === 0 ? '' : ', '}${String(key)}`,
    )
    .join('');

/** What sits at a path of the answer; undefined when the path leads nowhere. */
export function valueAt(root: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined,
    root,
  );
}

function holderOf(root: unknown, path: Path): Record<PropertyKey, unknown> | null {
  const holder = valueAt(root, path.slice(0, -1));
  return typeof holder === 'object' && holder !== null
    ? (holder as Record<PropertyKey, unknown>)
    : null;
}

/** The repair any answer may have: for a text or a list too long, a null, an empty text, a bad list entry. */
function generalRepair(root: unknown, issue: Issue, rules: RepairRules): Repair | null {
  const { path } = issue;
  const last = path.at(-1);
  const parent = path.at(-2);
  const value = valueAt(root, path);
  const where = placeOf(path);
  const max = Number(issue.maximum);
  if (issue.code === 'too_big' && typeof value === 'string' && Number.isFinite(max)) {
    return { set: path, value: shortened(value, max), note: `${where}: shortened to fit.` };
  }
  if (issue.code === 'too_big' && Array.isArray(value) && Number.isFinite(max)) {
    return {
      set: path,
      value: value.slice(0, max),
      note: `${where}: only the first ${max} are kept.`,
    };
  }
  if (isIndex(last) && typeof parent === 'string' && rules.typedLists?.includes(parent)) {
    return {
      drop: path,
      note: `${placeOf(path.slice(0, -1))}: one entry could not be read, so it was left out.`,
    };
  }
  // A null where a text may be left out is a text left out: said nowhere, since nothing was lost.
  if (value === null && !isIndex(last)) return { remove: path, note: null };
  const empty = typeof value === 'string' && value.trim() === '' && issue.code === 'too_small';
  if (empty && isIndex(last)) {
    return { drop: path, note: `${placeOf(path.slice(0, -1))}: an empty entry was left out.` };
  }
  if (empty && rules.mayBeUnstated?.(path)) {
    return {
      set: path,
      value: NOT_STATED,
      note: `${where}: left empty, so it reads “${NOT_STATED}”.`,
    };
  }
  return null;
}

const key = (path: Path): string => path.map(String).join('/');

/** Makes one round of repairs in place; the notes of what was done, or null when an issue has no repair. */
function repairedOnce(
  root: unknown,
  issues: readonly Issue[],
  rules: RepairRules,
): readonly string[] | null {
  const repairs = issues.map((issue) => {
    const special = rules.special?.(root, issue);
    return special === undefined ? generalRepair(root, issue, rules) : special;
  });
  if (repairs.some((repair) => repair === null)) return null;
  const made = repairs as readonly Repair[];
  for (const repair of made) {
    if ('set' in repair) {
      const holder = holderOf(root, repair.set);
      const at = repair.set.at(-1);
      if (holder && at !== undefined) holder[at] = repair.value;
    }
    if ('remove' in repair) {
      const holder = holderOf(root, repair.remove);
      const at = repair.remove.at(-1);
      if (holder && at !== undefined) delete holder[at];
    }
  }
  // Entries are taken out from the end of a list first, so the places of the others hold.
  const drops = made
    .flatMap((repair) => ('drop' in repair ? [repair.drop] : []))
    .filter((path, index, all) => all.findIndex((other) => key(other) === key(path)) === index)
    .sort((a, b) => b.length - a.length || Number(b.at(-1)) - Number(a.at(-1)));
  for (const path of drops) {
    const list = valueAt(root, path.slice(0, -1));
    const index = path.at(-1);
    if (Array.isArray(list) && isIndex(index)) list.splice(index, 1);
  }
  return [...new Set(made.flatMap((repair) => (repair.note === null ? [] : [repair.note])))];
}

/** Why an answer was refused: the first things wrong, each with the field it is in. */
export const refusalOf = (issues: readonly Issue[]): string =>
  `the answer did not fit the form asked for (${issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${issue.path.join('.') || 'the answer'}: ${issue.message}`)
    .join('; ')})`;

/**
 * An answer fitted to its schema: as it is when it fits; repaired and kept,
 * with what was done, when it can be; refused, naming where it first went
 * wrong, when nothing honest can repair it.
 */
export function fitToSchema<S extends z.ZodType>(
  schema: S,
  value: unknown,
  rules: RepairRules = {},
): Fitted<z.output<S>> {
  const first = schema.safeParse(value);
  if (first.success) return { ok: true, data: first.data, repaired: [] };
  const refused = { ok: false as const, reason: refusalOf(first.error.issues) };
  if (typeof value !== 'object' || value === null) return refused;
  const working: unknown = structuredClone(value);
  let issues: readonly Issue[] = first.error.issues;
  const repaired: string[] = [];
  for (let round = 0; round < REPAIR_ROUNDS; round += 1) {
    const notes = repairedOnce(working, issues, rules);
    if (notes === null) return refused;
    repaired.push(...notes);
    const again = schema.safeParse(working);
    if (again.success) return { ok: true, data: again.data, repaired: [...new Set(repaired)] };
    issues = again.error.issues;
  }
  return refused;
}
