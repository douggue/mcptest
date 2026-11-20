/** How moments are written in the store and read back from it. */

const MS_PER_SECOND = 1000;

/** ISO-8601 text in UTC, which sorts in time order. */
export const toText = (moment: Date): string => moment.toISOString();

export const fromText = (text: string): Date => new Date(text);

export const fromTextOrNull = (text: string | null): Date | null =>
  text === null ? null : new Date(text);

/** Whole seconds since 1970, as readings are kept: the part of a second is dropped. */
export const toSeconds = (moment: Date): number => Math.floor(moment.getTime() / MS_PER_SECOND);

export const fromSeconds = (seconds: number): Date => new Date(seconds * MS_PER_SECOND);
