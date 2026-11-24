import {
  FFMPEG_PROGRAM,
  YT_DLP_PROGRAM,
  checkYouTubeProxy,
  findProgram,
  youtubeProxyOf,
  type ProxyCheck,
} from '@jgtube/core';
import { SERVER_NAME } from './analyses';
import { allowAntigravity } from './engines/allowAgy';
import type { EngineReport } from './engines/catalog';
import { helperLines, reportLines } from './engines/report';
import type { ProxyTest, SettingsEngine } from './settingsRoutes';

type Env = Readonly<Record<string, string | undefined>>;
import type { SettingsStore } from './settingsStore';

export interface SettingsEngineDeps {
  readonly store: SettingsStore;
  /** What is known about the AI engines; `fresh` asks the programs again now. */
  readonly engineStatus: (fresh?: boolean) => Promise<EngineReport>;
  /** Where the helper programs are looked for; the running program's own environment by default. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Replaces the owner's home folder; used by tests. */
  readonly homeDir?: string;
  /** Fetches one public YouTube page through a proxy; tests replace it. */
  readonly checkProxy?: (proxy: string) => Promise<ProxyCheck>;
}

const NOT_SET: ProxyTest = {
  verdict: 'not-set',
  reason: 'No proxy is saved yet. Save one, then test it.',
};

/** The saved proxy for YouTube, tested with one page; a bad or missing one is said, not thrown. */
async function testProxy(deps: SettingsEngineDeps, env: Env): Promise<ProxyTest> {
  let proxy: string | null;
  try {
    proxy = youtubeProxyOf(env);
  } catch (error) {
    return { verdict: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
  if (proxy === null) return NOT_SET;
  return (deps.checkProxy ?? checkYouTubeProxy)(proxy);
}

/** Everything the settings screen can do: the `.env` settings and what `npm run engines` does. */
export function settingsEngine(deps: SettingsEngineDeps): SettingsEngine {
  const env = deps.env ?? process.env;
  return {
    view: () => deps.store.view(),
    save: (changes) => deps.store.save(changes),

    async programs() {
      // Asked afresh: the owner is looking at this right after changing a setting.
      const report = await deps.engineStatus(true);
      return {
        engines: reportLines(report),
        helpers: helperLines({
          ytDlp: await findProgram(YT_DLP_PROGRAM, env),
          ffmpeg: await findProgram(FFMPEG_PROGRAM, env),
        }),
      };
    },

    allowAntigravity: () => allowAntigravity(SERVER_NAME, deps.homeDir),

    testYouTubeProxy: () => testProxy(deps, env),
  };
}
