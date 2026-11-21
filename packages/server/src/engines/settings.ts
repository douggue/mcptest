/**
 * The owner's settings for the engines, read from the environment (which
 * `.env` fills in) and checked before anything is started. A bad value stops
 * Jgtube with the name of the setting, never with the value itself.
 */
import { z } from 'zod';
import { DEFAULT_GEMINI_MODEL, type GeminiSettings } from './geminiVideo';
import type { EngineId } from './types';

export const ENGINE_IDS = ['agy', 'claude', 'codex'] as const satisfies readonly EngineId[];
/**
 * The owner's stated preference: Claude is the main engine, with Antigravity
 * and then Codex as its backups. Watching a video is the exception, where
 * Antigravity goes first whatever this order says (see `videoWatch`).
 */
export const DEFAULT_ENGINE_ORDER: readonly EngineId[] = ['claude', 'agy', 'codex'];

export interface EngineSettings {
  /** The engines Jgtube may use, most preferred first. One left out is never started. */
  readonly order: readonly EngineId[];
  /** A model for Antigravity to use; absent, it uses the owner's own choice. */
  readonly agyModel?: string;
  /** Whether Antigravity may be asked to watch a YouTube link when it has no file. Unproven; off unless set. */
  readonly agyYouTubeLinks: boolean;
  /** Present when the owner has set a Gemini API key. */
  readonly gemini?: GeminiSettings;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  order: DEFAULT_ENGINE_ORDER,
  agyYouTubeLinks: false,
};

const isEngineId = (name: string): name is EngineId =>
  (ENGINE_IDS as readonly string[]).includes(name);

const engineOrder = z
  .string()
  .transform((text) => text.split(',').map((name) => name.trim().toLowerCase()))
  .refine((names) => names.every(isEngineId), {
    message: `must be a list of ${ENGINE_IDS.join(', ')} separated by commas`,
  })
  .refine((names) => new Set(names).size === names.length, {
    message: 'must not name an engine twice',
  })
  .transform((names) => names.filter(isEngineId));

const envSchema = z.object({
  JGTUBE_ENGINES: engineOrder.optional(),
  // Passed to `agy --model`, so it must not be able to pass for another flag.
  JGTUBE_AGY_MODEL: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/, 'must be a model name such as Gemini 3.8 Flash')
    .optional(),
  JGTUBE_AGY_YOUTUBE_LINKS: z.enum(['on', 'off'], 'must be on or off').optional(),
  // Checked for shape only: it goes into a request header. The message never repeats the value.
  GEMINI_API_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,200}$/, 'does not look like a Gemini API key')
    .optional(),
  JGTUBE_GEMINI_MODEL: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{2,60}$/, 'must be a model name such as gemini-4-hydrogen')
    .optional(),
});

const SETTING_NAMES = Object.keys(envSchema.shape);

/** The settings that are set to something: an empty line in `.env` counts as not set. */
function present(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(
    SETTING_NAMES.flatMap((name) => {
      const value = env[name]?.trim();
      return value ? [[name, value]] : [];
    }),
  );
}

/** Reads the engine settings and fails fast, naming the bad setting. */
export function loadEngineSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EngineSettings {
  const parsed = envSchema.safeParse(present(env));
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration. ${problems}`);
  }
  const { data } = parsed;
  return {
    order: data.JGTUBE_ENGINES ?? DEFAULT_ENGINE_ORDER,
    agyYouTubeLinks: data.JGTUBE_AGY_YOUTUBE_LINKS === 'on',
    ...(data.JGTUBE_AGY_MODEL ? { agyModel: data.JGTUBE_AGY_MODEL } : {}),
    ...(data.GEMINI_API_KEY
      ? {
          gemini: {
            apiKey: data.GEMINI_API_KEY,
            model: data.JGTUBE_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
          },
        }
      : {}),
  };
}
