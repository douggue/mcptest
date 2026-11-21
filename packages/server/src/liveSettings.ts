import { loadConfig, type Config } from '@jgtube/core';
import { loadEngineSettings, type EngineSettings } from './engines/settings';

/**
 * The configuration of a running Jgtube, in which the settings that are cheap
 * to change can change without a restart: the two API keys, the order of the
 * AI engines and whether scripts mark facts to check. Everything else stays as it was read at start.
 *
 * `config` and `engines` are single objects whose changeable fields are read
 * from the latest settings each time they are looked at. The engine reads a
 * key at the moment it uses it, so a key saved from the settings screen is
 * used by the next request. Hand these objects on as they are: a copy made
 * with `{ ...config }` freezes the fields at the values they had then.
 */
export interface LiveSettings {
  readonly config: Config;
  readonly engines: EngineSettings;
  /** Reads the environment again. Settings that fail their rules leave everything as it was. */
  reload(): void;
}

/** Defines a field that is read from `read` every time it is looked at. */
function liveField<T extends object, K extends keyof T>(target: T, key: K, read: () => T[K]): void {
  Object.defineProperty(target, key, { get: read, enumerable: true, configurable: false });
}

export function liveSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LiveSettings {
  let latestConfig = loadConfig(env);
  let latestEngines = loadEngineSettings(env);
  // Copies of what was read at start; the fields below are then read afresh at each look.
  const config: Config = { ...latestConfig };
  const engines: EngineSettings = { ...latestEngines };
  liveField(config, 'youtubeApiKey', () => latestConfig.youtubeApiKey);
  liveField(config, 'markFacts', () => latestConfig.markFacts);
  liveField(engines, 'order', () => latestEngines.order);
  liveField(engines, 'gemini', () => latestEngines.gemini);
  return {
    config,
    engines,
    reload() {
      try {
        const nextConfig = loadConfig(env);
        const nextEngines = loadEngineSettings(env);
        latestConfig = nextConfig;
        latestEngines = nextEngines;
      } catch {
        // The settings screen checks every value before it saves, so this is
        // an environment changed by hand into something unusable: keep what works.
      }
    },
  };
}
