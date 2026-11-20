/**
 * The engines Jgtube knows, and what is known about each on this computer.
 * A new engine is one more entry in `createEngines`.
 */
import { createAgyEngine } from './agy';
import { claudeEngine } from './claude';
import { codexEngine } from './codex';
import { ENGINE_IDS, type EngineSettings } from './settings';
import type { AnalysisEngine, EngineDeps, EngineId, EngineStatus } from './types';

export type Engines = Readonly<Record<EngineId, AnalysisEngine>>;

/** What is known about the AI engines on this computer, and the order they are tried in. */
export interface EngineReport {
  readonly engines: readonly EngineStatus[];
  readonly order: readonly EngineId[];
}

const GEMINI_LABEL = 'Gemini API';

/** Every engine that answers with Jgtube's tools. `toolServer` is the connector's name. */
export function createEngines(settings: EngineSettings, toolServer: string): Engines {
  return {
    agy: createAgyEngine({ toolServer, model: settings.agyModel }),
    claude: claudeEngine,
    codex: codexEngine,
  };
}

/**
 * The Gemini API is not a program on the computer: it is there when the owner
 * has set a key. Whether Google accepts the key is only known by using it.
 */
export function geminiStatus({ gemini }: EngineSettings): EngineStatus {
  const hasKey = gemini !== undefined;
  return {
    id: 'gemini-api',
    label: GEMINI_LABEL,
    installed: hasKey,
    signedIn: null,
    version: null,
    ready: hasKey,
    note: hasKey
      ? `Watches public YouTube videos with the model ${gemini.model}.`
      : 'Put GEMINI_API_KEY in the .env file to let Gemini watch videos.',
  };
}

/** What is known about every engine, in a fixed order. Starts nothing that spends allowance. */
export async function checkEngines(
  engines: Engines,
  settings: EngineSettings,
  deps: EngineDeps,
): Promise<readonly EngineStatus[]> {
  const programs = await Promise.all(ENGINE_IDS.map((id) => engines[id].check(deps)));
  return [...programs, geminiStatus(settings)];
}
