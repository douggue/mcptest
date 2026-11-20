import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_MAX_ALERTS_PER_DAY } from './alerts/alertCycle';
import { isTimeZone } from './alerts/localTime';
import {
  DEFAULT_FOLLOW_MAX_ACCOUNT_AGE_DAYS,
  DEFAULT_FOLLOW_MAX_SUBSCRIBERS,
  type FollowSettings,
} from './discover/follow';
import { DEFAULT_ENGAGED_SHARE, DEFAULT_SHORTS_RATE, type RateRange } from './scoring/earnings';

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
/** A store that lives only in memory; not a file name, so it is left as it is. */
const IN_MEMORY = ':memory:';
/**
 * The folder this project lives in. A relative store path is taken from here,
 * not from wherever the program was started, so a service started by systemd
 * and a command run by hand from another folder open the same store.
 */
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Dollars per 1,000 views. Above this a rate is a typing mistake, not a rate. */
const MAX_RATE = 100;
/** Six in the evening: the day's findings are mostly in, and the owner is likely awake. */
const DEFAULT_DIGEST_HOUR = 18;
const LAST_HOUR = 23;
const DEFAULT_TIME_ZONE = 'UTC';
/** More alerts than this in a day would not be read. */
const MAX_ALERTS_PER_DAY = 100;
/** A bot token as @BotFather gives it: the bot's number, a colon, a long secret. */
const BOT_TOKEN_PATTERN = /^\d{5,15}:[\w-]{30,60}$/;
/** A chat's number; a group's or a channel's is negative. */
const CHAT_ID_PATTERN = /^-?\d{1,20}$/;

const storePath = (path: string): string =>
  path === IN_MEMORY || isAbsolute(path) ? path : resolve(PROJECT_ROOT, path);

const rate = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, 'must be dollars per 1,000 views, such as 0.10')
  .transform((text) => Number(text))
  .refine((value) => value <= MAX_RATE, { message: `must be at most ${MAX_RATE}` });

/** A share from 0 to 1, written with up to three decimals. */
const share = z
  .string()
  .regex(/^(0(\.\d{1,3})?|1(\.0{1,3})?)$/, 'must be a share from 0 to 1, such as 0.6')
  .transform((text) => Number(text));

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

/** A whole number from `min` to `max`, written in digits. */
const wholeNumber = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d{1,3}$/, `must be a whole number from ${min} to ${max}`)
    .transform((text) => Number(text))
    .refine((value) => value >= min && value <= max, {
      message: `must be a whole number from ${min} to ${max}`,
    });

/** A whole number from 0 to `max`, written in up to ten digits. */
const count = (max: number) =>
  z
    .string()
    .regex(/^\d{1,10}$/, `must be a whole number from 0 to ${max}`)
    .transform((text) => Number(text))
    .refine((value) => value <= max, { message: `must be a whole number from 0 to ${max}` });

/** More subscribers than any channel has: above this the number is a typing mistake. */
const MAX_SUBSCRIBERS = 1_000_000_000;
/** A hundred years: older than YouTube, so anything above is a typing mistake. */
const MAX_ACCOUNT_AGE_DAYS = 36_500;

/** A setting left empty in the file ("NAME=") counts as not set. */
const optionalSecret = (schema: z.ZodString) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** What a command run by hand needs: where the store is and how it is used. No secrets. */
const storeSchema = z.object({
  SHORTS_DB_PATH: z.string().min(1, 'must not be empty').default(DEFAULT_DB_PATH),
  SHORTS_REGIONS: regions.default(DEFAULT_REGIONS),
  SHORTS_LANGUAGE: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, 'must be a language code such as en or es')
    .default(DEFAULT_LANGUAGE),
  SHORTS_DAILY_UNITS: dailyUnits.default(DEFAULT_DAILY_UNITS),
});

const envSchema = storeSchema.extend({
  // Checked for shape only; the messages never repeat the value.
  YOUTUBE_API_KEY: z
    .string({ error: 'is missing' })
    .min(20, 'is too short to be an API key')
    .max(200, 'is too long to be an API key'),
  SHORTS_RATE_LOW: rate.default(DEFAULT_SHORTS_RATE.low),
  SHORTS_RATE_HIGH: rate.default(DEFAULT_SHORTS_RATE.high),
  SHORTS_ENGAGED_SHARE: share.default(DEFAULT_ENGAGED_SHARE),
  TELEGRAM_BOT_TOKEN: optionalSecret(
    z.string().regex(BOT_TOKEN_PATTERN, 'is not shaped like a bot token from @BotFather'),
  ),
  TELEGRAM_CHAT_ID: optionalSecret(
    z.string().regex(CHAT_ID_PATTERN, 'must be a chat number such as 123456789 or -1001234567890'),
  ),
  SHORTS_FOLLOW_MAX_SUBSCRIBERS: count(MAX_SUBSCRIBERS).default(DEFAULT_FOLLOW_MAX_SUBSCRIBERS),
  SHORTS_FOLLOW_MAX_ACCOUNT_AGE_DAYS: count(MAX_ACCOUNT_AGE_DAYS).default(
    DEFAULT_FOLLOW_MAX_ACCOUNT_AGE_DAYS,
  ),
  SHORTS_MAX_ALERTS_PER_DAY: wholeNumber(1, MAX_ALERTS_PER_DAY).default(DEFAULT_MAX_ALERTS_PER_DAY),
  SHORTS_DIGEST_HOUR: wholeNumber(0, LAST_HOUR).default(DEFAULT_DIGEST_HOUR),
  SHORTS_TIMEZONE: z
    .string()
    .refine(isTimeZone, { message: 'must be a time zone such as UTC or Europe/London' })
    .default(DEFAULT_TIME_ZONE),
});

/** Where alerts go. Both settings or neither. */
export interface TelegramSettings {
  /** The bot's token. Never logged. */
  readonly botToken: string;
  readonly chatId: string;
}

/** What every program that opens the store needs to know. Holds no secret. */
export interface StoreConfig {
  /** Where the SQLite store lives: an absolute path, or ":memory:". */
  readonly dbPath: string;
  /** Two-letter countries each subject is searched in. */
  readonly regions: readonly string[];
  /** The language searches lean towards. */
  readonly language: string;
  /** The key's daily allowance, which the plan is split from. */
  readonly dailyUnits: number;
}

export interface Config extends StoreConfig {
  /** The owner's key for the official YouTube API. Never logged. */
  readonly youtubeApiKey: string;
  /** What 1,000 Shorts views are taken to be worth, in US dollars, low to high. */
  readonly shortsRate: RateRange;
  /**
   * The share of counted views taken as paid for, 0 to 1. At 1 the earnings
   * range is an upper bound and is labelled so; see `scoring/earnings.ts`.
   */
  readonly engagedShare: number;
  /** Which channels are followed for their new uploads; starting values, to be revisited. */
  readonly follow: FollowSettings;
  /** Null when neither Telegram setting is given: alerts are off. */
  readonly telegram: TelegramSettings | null;
  /** The most findings told of one by one in a day; the rest go in the summary. */
  readonly maxAlertsPerDay: number;
  /** The hour (0 to 23, in `timeZone`) from which the daily messages go out. */
  readonly digestHour: number;
  /** The owner's time zone, which decides where a day starts and ends for alerts. */
  readonly timeZone: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** A wrong setting: the service cannot start until the owner corrects it. */
export class ConfigError extends Error {
  constructor(problems: string) {
    super(`Invalid configuration. ${problems}`);
    this.name = 'ConfigError';
  }
}

const problemsOf = (error: z.ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');

const storeConfigOf = (data: z.output<typeof storeSchema>): StoreConfig => ({
  dbPath: storePath(data.SHORTS_DB_PATH),
  regions: data.SHORTS_REGIONS,
  language: data.SHORTS_LANGUAGE,
  dailyUnits: data.SHORTS_DAILY_UNITS,
});

/** The settings a command run by hand needs. Asks for no key and no token. */
export function loadStoreConfig(env: Env = process.env): StoreConfig {
  const parsed = storeSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(problemsOf(parsed.error));
  return storeConfigOf(parsed.data);
}

/** Both Telegram settings, or null for neither. One without the other is a mistake. */
function telegramOf(
  token: string | undefined,
  chatId: string | undefined,
): TelegramSettings | null {
  if (token === undefined && chatId === undefined) return null;
  if (token === undefined) {
    throw new ConfigError('TELEGRAM_BOT_TOKEN: is missing, though TELEGRAM_CHAT_ID is set');
  }
  if (chatId === undefined) {
    throw new ConfigError('TELEGRAM_CHAT_ID: is missing, though TELEGRAM_BOT_TOKEN is set');
  }
  return { botToken: token, chatId };
}

/** Reads settings from the environment and fails fast, naming the bad variable. */
export function loadConfig(env: Env = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(problemsOf(parsed.error));
  const shortsRate = { low: parsed.data.SHORTS_RATE_LOW, high: parsed.data.SHORTS_RATE_HIGH };
  if (shortsRate.low > shortsRate.high) {
    throw new ConfigError('SHORTS_RATE_LOW: must not be above SHORTS_RATE_HIGH');
  }
  return {
    ...storeConfigOf(parsed.data),
    youtubeApiKey: parsed.data.YOUTUBE_API_KEY,
    shortsRate,
    engagedShare: parsed.data.SHORTS_ENGAGED_SHARE,
    follow: {
      maxSubscribers: parsed.data.SHORTS_FOLLOW_MAX_SUBSCRIBERS,
      maxAccountAgeDays: parsed.data.SHORTS_FOLLOW_MAX_ACCOUNT_AGE_DAYS,
    },
    telegram: telegramOf(parsed.data.TELEGRAM_BOT_TOKEN, parsed.data.TELEGRAM_CHAT_ID),
    maxAlertsPerDay: parsed.data.SHORTS_MAX_ALERTS_PER_DAY,
    digestHour: parsed.data.SHORTS_DIGEST_HOUR,
    timeZone: parsed.data.SHORTS_TIMEZONE,
  };
}
