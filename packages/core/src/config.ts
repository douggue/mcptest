import { z } from 'zod';

const envSchema = z.object({
  JGTUBE_DB_PATH: z.string().min(1).default('jgtube.db'),
  JGTUBE_REGION: z
    .string()
    .regex(/^[A-Z]{2}$/, 'must be a two-letter country code such as US')
    .default('US'),
  // Checked for shape only; the message below never repeats the value.
  YOUTUBE_API_KEY: z.string().min(20, 'is too short to be an API key').max(200).optional(),
});

export interface Config {
  /** Where the SQLite store lives. */
  readonly dbPath: string;
  /** Country that recommendations and listings are read from. */
  readonly region: string;
  /** The owner's key for the official YouTube API; keyword search needs it. Never logged. */
  readonly youtubeApiKey?: string;
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
    dbPath: parsed.data.JGTUBE_DB_PATH,
    region: parsed.data.JGTUBE_REGION,
    ...(parsed.data.YOUTUBE_API_KEY ? { youtubeApiKey: parsed.data.YOUTUBE_API_KEY } : {}),
  };
}
