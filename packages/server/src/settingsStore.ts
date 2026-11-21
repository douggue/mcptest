import { loadConfig, readEnvText, updateEnvText } from '@jgtube/core';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { loadEngineSettings } from './engines/settings';
import { cleanMessage } from './jobs';
import { SETTINGS, type SettingSpec } from './settingsCatalog';

/**
 * The owner's settings, read from and written to the project's `.env` file.
 *
 * A key's value never leaves this module towards the page: a view says only
 * whether one is set. A new value is checked with the rule the configuration
 * is read with, and a refusal names the setting, never the value. Writing
 * keeps every other line of the file, goes through a temporary file that is
 * then renamed over it, and keeps one copy of the file as it was.
 */

const OWNER_ONLY = 0o600;
const BACKUP_SUFFIX = '.backup';

export interface SettingView {
  readonly name: string;
  readonly label: string;
  readonly help: string;
  readonly secret: boolean;
  readonly effect: 'now' | 'restart';
  /** Whether a value is in force. */
  readonly set: boolean;
  /** The value in force; always null for a key, and null when nothing is set. */
  readonly value: string | null;
  /**
   * Given to Jgtube from outside the `.env` file when it was started, which
   * wins over the file: a change here is written but has no effect until
   * that is removed.
   */
  readonly outside: boolean;
}

export interface SettingsView {
  readonly settings: readonly SettingView[];
  /** Whether there is a `.env` file yet; saving makes one. */
  readonly fileFound: boolean;
}

export type SaveOutcome =
  | {
      readonly ok: true;
      readonly view: SettingsView;
      /** The labels of the changed settings that need Jgtube started again. */
      readonly restart: readonly string[];
    }
  | { readonly ok: false; readonly problem: string };

export interface SettingsStoreDeps {
  /** The full path of the `.env` file. */
  readonly envPath: string;
  /** The environment the running program reads its settings from; a save changes it. */
  readonly env: Record<string, string | undefined>;
  /** The settings the environment held before the file was read. */
  readonly outside: ReadonlySet<string>;
  /** Told after a save, so settings that can change while Jgtube runs are read again. */
  readonly onSaved?: () => void;
}

export interface SettingsStore {
  view(): SettingsView;
  /** Saves new values by setting name; an empty value or null clears a setting. */
  save(changes: Readonly<Record<string, string | null>>): SaveOutcome;
}

/** The names of the settings an environment already holds. Call it before the `.env` file is read. */
export function namesSetOutside(
  env: Readonly<Record<string, string | undefined>>,
): ReadonlySet<string> {
  return new Set(SETTINGS.map((setting) => setting.name).filter((name) => env[name]?.trim()));
}

const refused = (problem: string): SaveOutcome => ({ ok: false, problem });

/** Why a value does not pass its setting's rule, without the value; null when it does. */
function valueProblem(setting: SettingSpec, value: string): string | null {
  const parsed = setting.rule.safeParse(value);
  if (parsed.success) return null;
  const message = parsed.error.issues[0]?.message ?? 'is not valid';
  return `${setting.label}: ${message.includes(value) ? 'is not valid' : message}`;
}

/** The changes with names checked and values trimmed; an empty value clears. A string is the refusal. */
function checked(
  changes: Readonly<Record<string, string | null>>,
): Readonly<Record<string, string | null>> | string {
  const entries = Object.entries(changes);
  if (entries.length === 0) return 'Give at least one setting to change';
  const cleaned: Array<[string, string | null]> = [];
  for (const [name, raw] of entries) {
    const setting = SETTINGS.find((candidate) => candidate.name === name);
    if (!setting) return 'That is not a setting Jgtube knows';
    const value = raw === null || raw.trim() === '' ? null : raw.trim();
    const problem = value === null ? null : valueProblem(setting, value);
    if (problem) return problem;
    cleaned.push([name, value]);
  }
  return Object.fromEntries(cleaned);
}

/** Why Jgtube would not start with these settings; null when it would. */
function startProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  try {
    loadConfig(env);
    loadEngineSettings(env);
    return null;
  } catch (error) {
    return cleanMessage(error);
  }
}

/** Replaces the file with `text` through a temporary file, keeping one copy of it as it was. */
function writeKeepingBackup(path: string, text: string): void {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', mode: OWNER_ONLY });
    if (existsSync(path)) copyFileSync(path, `${path}${BACKUP_SUFFIX}`);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function settingsStore(deps: SettingsStoreDeps): SettingsStore {
  const { envPath, env, outside } = deps;
  const fileText = (): string | null =>
    existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;

  const view = (): SettingsView => ({
    fileFound: existsSync(envPath),
    settings: SETTINGS.map(({ rule: _rule, ...setting }) => {
      const value = env[setting.name]?.trim() || null;
      return {
        ...setting,
        set: value !== null,
        value: setting.secret ? null : value,
        outside: outside.has(setting.name),
      };
    }),
  });

  return {
    view,

    save(changes) {
      const wanted = checked(changes);
      if (typeof wanted === 'string') return refused(wanted);
      try {
        const next = updateEnvText(fileText(), wanted);
        // What a fresh start would read: the file, under whatever was given from outside it.
        const kept = Object.entries(env).filter(([name]) => outside.has(name) || !(name in wanted));
        const problem = startProblem({ ...readEnvText(next), ...Object.fromEntries(kept) });
        if (problem) return refused(problem);
        writeKeepingBackup(envPath, next);
      } catch (error) {
        return refused(`The settings could not be written: ${cleanMessage(error)}`);
      }
      for (const [name, value] of Object.entries(wanted)) {
        if (outside.has(name)) continue;
        if (value === null) delete env[name];
        else env[name] = value;
      }
      deps.onSaved?.();
      const restart = SETTINGS.filter(
        (setting) => setting.name in wanted && setting.effect === 'restart',
      ).map((setting) => setting.label);
      return { ok: true, view: view(), restart };
    },
  };
}
