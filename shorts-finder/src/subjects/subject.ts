/**
 * A subject: one keyword searched for in one country, in one language (or in
 * none in particular), every so many hours, in two ways (see `sweep.ts`). The owner's list of subjects is
 * what decides where the finder looks, so each one is checked on the way in.
 */
import { z } from 'zod';

export const MAX_KEYWORD_LENGTH = 200;
/** Once a day: the plan's 60 searches a day cover about 15 keywords in four countries. */
export const DEFAULT_EVERY_HOURS = 24;
/**
 * The newest sweep starts at once a day too. It is the search that finds a
 * video in its first hours, and how often a subject needs it is measured, not
 * guessed: a sweep that comes back full shortens that subject's own interval
 * (see `sweep.ts`). A starting value, to be revisited on evidence.
 */
export const DEFAULT_NEWEST_EVERY_HOURS = 24;
/** A subject searched less often than once in thirty days is not being watched. */
export const MAX_EVERY_HOURS = 24 * 30;

const subjectSchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(1, 'the keyword must not be empty')
    .max(MAX_KEYWORD_LENGTH, `the keyword must be at most ${MAX_KEYWORD_LENGTH} characters`),
  region: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'the country must be a two-letter code such as US'),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'the language must be a code such as en')
    .nullable()
    .default(null),
  everyHours: z
    .number()
    .int('the hours between searches must be a whole number')
    .min(1, 'the hours between searches must be at least 1')
    .max(MAX_EVERY_HOURS, `the hours between searches must be at most ${MAX_EVERY_HOURS}`)
    .default(DEFAULT_EVERY_HOURS),
  newestEveryHours: z
    .number()
    .int('the hours between newest sweeps must be a whole number')
    .min(1, 'the hours between newest sweeps must be at least 1')
    .max(MAX_EVERY_HOURS, `the hours between newest sweeps must be at most ${MAX_EVERY_HOURS}`)
    .default(DEFAULT_NEWEST_EVERY_HOURS),
});

/** A subject as the owner gives it: the language and the hours may be left out. */
export type SubjectInput = z.input<typeof subjectSchema>;

/** A checked subject, ready to be stored. A null language means none in particular. */
export interface NewSubject {
  readonly keyword: string;
  readonly region: string;
  readonly language: string | null;
  /** The hours between its top-recent searches. */
  readonly everyHours: number;
  /** The hours between its newest sweeps, at the longest. */
  readonly newestEveryHours: number;
}

/** Checks a subject, tidying the keyword's spaces and the country's case. Throws naming every fault. */
export function createSubject(input: SubjectInput): NewSubject {
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid subject. ${problems}`);
  }
  return parsed.data;
}

export interface ExpandOptions {
  readonly language?: string | null;
  readonly everyHours?: number;
  readonly newestEveryHours?: number;
}

/**
 * One keyword as a subject in each of the given countries, each country once.
 * Every country is a search of its own (100 units), so the list of countries
 * is the caller's to choose: the configured regions, usually.
 */
export function expandAcrossRegions(
  keyword: string,
  regions: readonly string[],
  options: ExpandOptions = {},
): readonly NewSubject[] {
  const subjects = regions.map((region) => createSubject({ keyword, region, ...options }));
  const seen = new Set<string>();
  return subjects.filter((subject) => {
    if (seen.has(subject.region)) return false;
    seen.add(subject.region);
    return true;
  });
}
