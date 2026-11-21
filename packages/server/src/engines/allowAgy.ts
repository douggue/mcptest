import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SETTINGS_FILE, allowServerInSettings } from './agy';

/** What allowing Antigravity did, as the lines the owner is told. */
export interface AllowReport {
  /** False when the settings could not be changed. */
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/**
 * Adds to the owner's Antigravity settings the one line that lets a run
 * started by Jgtube use its tools: what `npm run engines -- --allow-antigravity`
 * and the button on the settings screen both do. The file as it was is kept
 * beside it the first time, and settings that cannot be read are left alone.
 */
export function allowAntigravity(server: string, homeDir: string = homedir()): AllowReport {
  const file = join(homeDir, ...SETTINGS_FILE);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const outcome = allowServerInSettings(before, server);
  if (!outcome.ok) {
    return { ok: false, lines: [`Nothing was changed. ${outcome.problem}`, `The file is ${file}`] };
  }
  if (!outcome.changed) {
    return {
      ok: true,
      lines: [`Antigravity may already use Jgtube's tools. Nothing was changed in ${file}`],
    };
  }
  mkdirSync(dirname(file), { recursive: true });
  const backup = `${file}.before-jgtube`;
  const keptCopy = before !== null && !existsSync(backup);
  if (keptCopy) writeFileSync(backup, before, 'utf8');
  writeFileSync(file, outcome.text, 'utf8');
  return {
    ok: true,
    lines: [
      ...(keptCopy ? [`Your settings as they were are kept in ${backup}`] : []),
      `Done. Antigravity may now use Jgtube's tools: one line was added to ${file}`,
      'Choose Antigravity in the AI switch to try it.',
    ],
  };
}
