/**
 * What every call in the official-API reader shares: how the API writes
 * counts and moments, how a reply's entries are read against a schema, and
 * how many ids are asked for in requests of fifty.
 */
import { z } from 'zod';
import type { Page } from './client';

/** The API's own limit on ids per request, and on results per page. */
export const MAX_PER_REQUEST = 50;
const MAX_TEXT_LENGTH = 300;
const MAX_SHOWN_ID_LENGTH = 40;

/** A count as the API writes it: digits in text. One too large to hold exactly is refused. */
export const count = z
  .string()
  .regex(/^\d+$/)
  .transform((text) => Number(text))
  .refine((value) => Number.isSafeInteger(value));

/** A timestamp as the API writes it, read as a date; unreadable ones fail validation. */
export const timestamp = z
  .string()
  .transform((text) => new Date(text))
  .refine((date) => !Number.isNaN(date.getTime()));

export const shortText = z.string().transform((text) => text.slice(0, MAX_TEXT_LENGTH));

export interface Readable<T> {
  readonly items: readonly T[];
  /** How many entries did not fit the schema and were left out. */
  readonly skipped: number;
}

/** Reads each raw item against the schema, leaving out and counting the ones that do not fit it. */
export function readable<T>(raw: readonly unknown[], schema: z.ZodType<T>): Readable<T> {
  const items = raw.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { items, skipped: raw.length - items.length };
}

/**
 * What a read of many ids gave. The ids are asked for fifty at a time, and a
 * request that fails does not lose the ones before it: `items` holds what was
 * read, `failedIds` what was not asked for or not answered, `error` why.
 */
export interface ListResult<T> {
  readonly items: readonly T[];
  /** Entries the API sent that could not be read. Not the same as ids it left out. */
  readonly skipped: number;
  /** The ids of the request that failed and of every request after it. */
  readonly failedIds: readonly string[];
  /** Null when every request was answered. */
  readonly error: Error | null;
}

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** Asks for the ids fifty at a time, keeping what was read when a request fails. */
export async function readInBatches<T>(
  ids: readonly string[],
  schema: z.ZodType<T>,
  ask: (batch: readonly string[]) => Promise<Page>,
): Promise<ListResult<T>> {
  const batches = batchesOf(ids);
  let result: ListResult<T> = { items: [], skipped: 0, failedIds: [], error: null };
  for (const [index, batch] of batches.entries()) {
    try {
      const page = readable((await ask(batch)).items, schema);
      result = {
        ...result,
        items: [...result.items, ...page.items],
        skipped: result.skipped + page.skipped,
      };
    } catch (error) {
      return { ...result, failedIds: batches.slice(index).flat(), error: asError(error) };
    }
  }
  return result;
}

const batchesOf = (ids: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(ids.length / MAX_PER_REQUEST) }, (_, index) =>
    ids.slice(index * MAX_PER_REQUEST, (index + 1) * MAX_PER_REQUEST),
  );

export function requireIds(
  ids: readonly string[],
  pattern: RegExp,
  what: string,
): readonly string[] {
  const invalid = ids.find((id) => !pattern.test(id));
  if (invalid !== undefined) {
    throw new Error(`Not a valid YouTube ${what} id: "${invalid.slice(0, MAX_SHOWN_ID_LENGTH)}"`);
  }
  return [...new Set(ids)];
}
