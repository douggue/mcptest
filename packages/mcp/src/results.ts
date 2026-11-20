import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** A successful answer as one line of JSON; the reader pays for every character. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** A failed call, as the protocol's error result carrying one plain sentence. */
export function failureResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Drops the keys whose value is null or undefined, so absent optional data
 * costs nothing. The input is not changed.
 */
export function withoutAbsent<T extends Record<string, unknown>>(
  record: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
  ) as { [K in keyof T]?: NonNullable<T[K]> };
}

/** The first `limit` items and how many were left out. */
export function capped<T>(
  items: readonly T[],
  limit: number,
): { readonly shown: readonly T[]; readonly more: number } {
  return { shown: items.slice(0, limit), more: Math.max(0, items.length - limit) };
}

const ONE_DECIMAL = 10;

/** Scores are multiples such as 8.3; more digits than that is noise. */
export const oneDecimal = (value: number): number => Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
