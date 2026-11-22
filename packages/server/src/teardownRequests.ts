/**
 * One teardown stage as a boxed-in run of an engine. A stage that looks at
 * pictures reaches Claude Code and Codex through the tool that shows a
 * teardown's pictures, and an engine that passed the picture check
 * (Antigravity) as files in its own folder named in the question. Every
 * stage reads its data through `get_video_teardown`; none is handed text from
 * outside in its question.
 */
import { readFile } from 'node:fs/promises';
import { SERVER_NAME, connectorServer, seesFiles, tool, type AnalysisSettings } from './analyses';
import type { EngineId, EngineRunRequest, RunFile } from './engines/types';
import {
  PICTURE_STAGES,
  TEARDOWN_SYSTEM_PROMPT,
  stageQuestion,
  type JudgedStage,
} from './teardownQuestions';

export const TEARDOWN_DATA_TOOL = 'get_video_teardown';
export const TEARDOWN_PICTURE_TOOL = 'view_teardown_images';
/** The most pictures one call of the picture tool shows. */
export const PICTURES_PER_CALL = 8;

const TEXT_LIMITS = { maxTurns: 8, timeoutMs: 6 * 60 * 1000 };
const PICTURE_LIMITS = { maxTurns: 14, timeoutMs: 10 * 60 * 1000 };

export interface TeardownPicture {
  readonly name: string;
  readonly path: string;
}

export interface TeardownAsk {
  readonly stage: JudgedStage;
  readonly videoId: string;
  readonly heard: boolean;
  readonly chapterCount: number;
  /** The pictures this stage looks at, chosen and capped in code; none for a text stage. */
  readonly pictures: readonly TeardownPicture[];
}

export const looksAtPictures = (ask: TeardownAsk): boolean =>
  PICTURE_STAGES.includes(ask.stage) && ask.pictures.length > 0;

/** How the tool route is told to look: the names in calls of at most eight. */
export function toolLook(videoId: string, names: readonly string[]): string {
  const calls: string[] = [];
  for (let at = 0; at < names.length; at += PICTURES_PER_CALL) {
    calls.push(JSON.stringify(names.slice(at, at + PICTURES_PER_CALL)));
  }
  return `Look at every picture with ${TEARDOWN_PICTURE_TOOL} (video "${videoId}"), in ${calls.length} call${calls.length === 1 ? '' : 's'} with these names: ${calls.join(', then ')}.`;
}

/** How the files route is told to look. */
export const filesLook = (names: readonly string[]): string =>
  `The pictures are files in your folder. Open each with your own file-reading tool and look at it: ${names.map((name) => `@${name}`).join(' ')}.`;

/** The run for one stage and one engine. */
export async function teardownRequest(
  ask: TeardownAsk,
  engine: EngineId,
  settings: AnalysisSettings,
): Promise<EngineRunRequest> {
  const pictures = looksAtPictures(ask);
  const asFiles = pictures && seesFiles(engine);
  const names = ask.pictures.map((picture) => picture.name);
  const look = !pictures ? '' : asFiles ? filesLook(names) : toolLook(ask.videoId, names);
  const allowedTools = [
    tool(TEARDOWN_DATA_TOOL),
    ...(pictures && !asFiles ? [tool(TEARDOWN_PICTURE_TOOL)] : []),
  ];
  const files: RunFile[] = asFiles
    ? await Promise.all(
        ask.pictures.map(async (picture) => ({
          name: picture.name,
          bytes: new Uint8Array(await readFile(picture.path)),
        })),
      )
    : [];
  const limits = pictures ? PICTURE_LIMITS : TEXT_LIMITS;
  return {
    prompt: stageQuestion(ask.stage, {
      videoId: ask.videoId,
      look,
      heard: ask.heard,
      chapterCount: ask.chapterCount,
    }),
    systemPrompt: TEARDOWN_SYSTEM_PROMPT,
    mcpServers: { [SERVER_NAME]: connectorServer(settings, allowedTools) },
    allowedTools,
    maxTurns: limits.maxTurns,
    timeoutMs: limits.timeoutMs,
    cwd: settings.workDir,
    ...(asFiles ? { files } : {}),
  };
}
