import { z } from 'zod';

const envSchema = z.object({
  SCOUT_DB_PATH: z.string().min(1).default('scout.db'),
  SCOUT_REGION: z
    .string()
    .regex(/^[A-Z]{2}$/, 'must be a two-letter country code such as US')
    .default('US'),
});

export interface Config {
  /** Where the SQLite store lives. */
  readonly dbPath: string;
  /** Country that recommendations and listings are read from. */
  readonly region: string;
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
    dbPath: parsed.data.SCOUT_DB_PATH,
    region: parsed.data.SCOUT_REGION,
  };
}
