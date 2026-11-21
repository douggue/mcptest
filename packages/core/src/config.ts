import { z } from 'zod';

/** A refresh more often than hourly reads nothing new; a week is the longest gap that still builds history. */
const MIN_REFRESH_HOURS = 1;
const MAX_REFRESH_HOURS = 168;

const envSchema = z.object({
  JGTUBE_DB_PATH: z.string().min(1).default('jgtube.db'),
  JGTUBE_REGION: z
    .string()
    .regex(/^[A-Z]{2}$/, 'must be a two-letter country code such as US')
    .default('US'),
  // Checked for shape only; the message below never repeats the value.
  YOUTUBE_API_KEY: z.string().min(20, 'is too short to be an API key').max(200).optional(),
  JGTUBE_REFRESH_HOURS: z
    .string()
    .regex(/^\d{1,3}$/, 'must be a whole number of hours')
    .transform((text) => Number(text))
    .refine((hours) => hours >= MIN_REFRESH_HOURS && hours <= MAX_REFRESH_HOURS, {
      message: `must be from ${MIN_REFRESH_HOURS} to ${MAX_REFRESH_HOURS} hours`,
    })
    .optional(),
  JGTUBE_DOWNLOADS_PATH: z.string().min(1).max(1000).optional(),
  JGTUBE_MARK_FACTS: z.enum(['on', 'off'], 'must be on or off').optional(),
});

/**
 * The rule each setting must pass, by the name it has in `.env`. The settings
 * screen checks a new value with the same rule before it writes it.
 */
export const CONFIG_ENV_RULES = envSchema.shape;

export interface Config {
  /** Where the SQLite store lives. */
  readonly dbPath: string;
  /** Country that recommendations and listings are read from. */
  readonly region: string;
  /** The owner's key for the official YouTube API; keyword search needs it. Never logged. */
  readonly youtubeApiKey?: string;
  /**
   * Hours between scheduled refreshes of the stored channels while the server
   * runs. Absent means off: channels are read again only when asked.
   */
  readonly refreshHours?: number;
  /**
   * The folder that downloaded files (thumbnails, temporary video copies) are
   * saved under. Absent means a "downloads" folder beside the store.
   */
  readonly downloadsPath?: string;
  /**
   * Whether a script's writer is asked to mark each fact it cannot vouch for,
   * for the owner to check. On unless the owner turns it off: checking facts
   * is their choice. Absent means on.
   */
  readonly markFacts?: boolean;
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
    ...(parsed.data.JGTUBE_REFRESH_HOURS === undefined
      ? {}
      : { refreshHours: parsed.data.JGTUBE_REFRESH_HOURS }),
    ...(parsed.data.JGTUBE_DOWNLOADS_PATH
      ? { downloadsPath: parsed.data.JGTUBE_DOWNLOADS_PATH }
      : {}),
    ...(parsed.data.JGTUBE_MARK_FACTS === 'off' ? { markFacts: false } : {}),
  };
}
