/**
 * `npm run engines`: says which AI engines are on this computer and signed in.
 * With `-- --try` it also asks each one a small question, which uses a little
 * of each plan's allowance, and prints what came back or why it failed.
 * With `-- --try --video <file>` Antigravity is also given a video file to
 * watch, and with `-- --try --youtube <link>` a YouTube link.
 */
import { FFMPEG_PROGRAM, YT_DLP_PROGRAM, findProgram, loadConfig } from '@jgtube/core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_NAME, VIDEO_SYSTEM_PROMPT, connectionCheck } from './analyses';
import { allowAntigravity } from './engines/allowAgy';
import { WATCH_TIMEOUT_MS, watchLinkWithAgy, watchWithAgy } from './engines/agyVideo';
import { checkEngines, createEngines } from './engines/catalog';
import { EngineRunError } from './engines/failure';
import { askGemini } from './engines/geminiVideo';
import { spawnProcess } from './engines/process';
import {
  helperLines,
  parseEnginesArgs,
  planTrials,
  reportLines,
  runTrials,
  type TrialActions,
} from './engines/report';
import { loadEngineSettings, type EngineSettings } from './engines/settings';
import type { EngineDeps, VideoQuestion } from './engines/types';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const FILE_QUESTION =
  'Say in three short lines what happens in this video, including any on-screen text and any sounds.';
const LINK_QUESTION =
  'Quote the first sentence spoken, word for word, and describe what is on screen in the first three seconds.';

const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** Reads settings from a `.env` file beside where Jgtube is started, if there is one. */
function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: settings come from the environment or their defaults.
  }
}

/** The real thing behind each trial, each in a folder of its own inside `workDir`. */
function trialActions(settings: EngineSettings, deps: EngineDeps, workDir: string): TrialActions {
  const engines = createEngines(settings, SERVER_NAME);
  const dbPath = resolve(loadConfig().dbPath);
  const watching = (question: string): VideoQuestion => ({
    question,
    systemPrompt: VIDEO_SYSTEM_PROMPT,
    timeoutMs: WATCH_TIMEOUT_MS,
    cwd: join(workDir, 'video'),
  });
  return {
    ask: (id) => {
      // A program cannot be started in a folder that is not there.
      const folder = join(workDir, id);
      mkdirSync(folder, { recursive: true });
      return engines[id].run(
        connectionCheck({ projectRoot: PROJECT_ROOT, dbPath, workDir: folder }),
        deps,
      );
    },
    askGemini: () =>
      settings.gemini
        ? askGemini('Reply with the one word: ready', settings.gemini)
        : Promise.reject(new EngineRunError('not-installed', 'No GEMINI_API_KEY is set.')),
    watchFile: (path) =>
      watchWithAgy(
        { ...watching(FILE_QUESTION), videoPath: resolve(path) },
        deps,
        settings.agyModel,
      ),
    watchLink: (videoId) =>
      watchLinkWithAgy({ ...watching(LINK_QUESTION), videoId }, deps, settings.agyModel),
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const command = parseEnginesArgs(process.argv.slice(2));
  if (command.allowAntigravity) {
    const report = allowAntigravity(SERVER_NAME);
    report.lines.forEach(print);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  const settings = loadEngineSettings();
  const deps: EngineDeps = { spawn: spawnProcess, env: process.env };
  const engines = await checkEngines(createEngines(settings, SERVER_NAME), settings, deps);
  const report = { engines, order: settings.order };
  reportLines(report).forEach(print);
  print('');
  helperLines({
    ytDlp: await findProgram(YT_DLP_PROGRAM),
    ffmpeg: await findProgram(FFMPEG_PROGRAM),
  }).forEach(print);
  if (!command.try) {
    print('');
    print(
      'To ask each one a small question (uses a little of each plan): npm run engines -- --try',
    );
    return;
  }
  // Owner-only and with a name nobody can guess, as for the app's own runs.
  const workDir = mkdtempSync(join(tmpdir(), 'jgtube-engines-try-'));
  try {
    await runTrials(planTrials(command, report, trialActions(settings, deps, workDir)), print);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
