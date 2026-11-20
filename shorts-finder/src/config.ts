import { z } from 'zod';

/** The countries watched first: English-speaking ones where ads pay most. */
export const DEFAULT_REGIONS: readonly string[] = ['US', 'GB', 'CA', 'AU'];
/** What Google gives a new API key each day. */
export const DEFAULT_DAILY_UNITS = 10_000;
const DEFAULT_LANGUAGE = 'en';
const DEFAULT_DB_PATH = 'shorts-finder.db';
/** Every country multiplies the searches, so a list longer than this is a mistake. */
const MAX_REGIONS = 20;
const REGION_PATTERN = /^[A-Z]{2}$/;
const MAX_DAILY_UNITS = 10_000_000;

const regions = z
  .string()
  .transform((text) => text.split(',').map((code) => code.trim().toUpperCase()))
  .refine((codes) => codes.every((code) => REGION_PATTERN.test(code)), {
    message: 'must be two-letter country codes separated by commas, such as US,GB',
  })
  .transform((codes): readonly string[] => [...new Set(codes)])
  .refine((codes) => codes.length <= MAX_REGIONS, {
    message: `must name at most ${MAX_REGIONS} countries`,
  });

const dailyUnits = z
  .string()
  .regex(/^\d{1,8}$/, 'must be a whole number of units')
  .transform((text) => Number(text))
  .refine((units) => units >= 1 && units <= MAX_DAILY_UNITS, {
    message: `must be from 1 to ${MAX_DAILY_UNITS} units`,
  });

const envSchema = z.object({
  SHORTS_DB_PATH: z.string().min(1, 'must not be empty').default(DEFAULT_DB_PATH),
  // Checked for shape only; the messages never repeat the value.
  YOUTUBE_API_KEY: z
    .string({ error: 'is missing' })
    .min(20, 'is too short to be an API key')
    .max(200, 'is too long to be an API key'),
  SHORTS_REGIONS: regions.default(DEFAULT_REGIONS),
  SHORTS_LANGUAGE: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'must be a language code such as en or es')
    .default(DEFAULT_LANGUAGE),
  SHORTS_DAILY_UNITS: dailyUnits.default(DEFAULT_DAILY_UNITS),
});

export interface Config {
  /** Where the SQLite store lives. */
  readonly dbPath: string;
  /** The owner's key for the official YouTube API. Never logged. */
  readonly youtubeApiKey: string;
  /** Two-letter countries each subject is searched in. */
  readonly regions: readonly string[];
  /** The language searches lean towards. */
  readonly language: string;
  /** The key's daily allowance, which the plan is split from. */
  readonly dailyUnits: number;
}

/** Reads settings from the environment and fails fast, naming the bad variable. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration. ${problems}`);
  }
  return {
    dbPath: parsed.data.SHORTS_DB_PATH,
    youtubeApiKey: parsed.data.YOUTUBE_API_KEY,
    regions: parsed.data.SHORTS_REGIONS,
    language: parsed.data.SHORTS_LANGUAGE,
    dailyUnits: parsed.data.SHORTS_DAILY_UNITS,
  };
}
