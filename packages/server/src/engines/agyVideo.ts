/**
 * Has the Antigravity CLI watch one video and answer a question about it:
 * picture, on-screen text and sound.
 *
 * NOT RUN FROM HERE: `agy` was not installed where this was written. Headless
 * video is not in `agy`'s documentation at all, so every assumption about it
 * is listed here, and nothing outside this file depends on any of them.
 *
 * 1. A headless run watches a local file whose path is in the prompt. The
 *    owner has done it on their own computer with
 *    `agy -p "Watch @clip.mp4 and say ..." --output-format json`, and other
 *    users report the same. `@name` only points at the file; the agent opens
 *    it with its own file-reading tool, which hands picture and sound to the
 *    model. There is no flag that attaches a file.
 * 2. MP4 is the format users report working, so only `.mp4` is taken.
 * 3. A file over 100 MB is refused by `agy` (changelog v1.2.2); `MAX_VIDEO_BYTES`
 *    stays a little under.
 * 4. A file cut short used to hang the run and is now refused when read
 *    (v1.2.14, v1.3.4). A download that stopped part-way is never handed
 *    over: `isWholeMp4` checks first.
 * 5. Long videos are the weak point: an early version stuck on 19 minutes of
 *    720p, and people who wrap `agy` advise splitting beyond 15 to 30
 *    minutes. Nothing is split here (that would need ffmpeg, which Jgtube
 *    does not require). A run that times out says the video may be too long.
 * 6. A YouTube link in the prompt, with no file, is claimed by one wrapper
 *    and confirmed by nobody: `agy` has a tool that reads a link as a web
 *    page, which would give it the page's text and not the video.
 *    `watchLinkWithAgy` exists so the owner can try it (`npm run engines --
 *    --try --youtube <link>`), and is used for real only when a setting turns
 *    it on.
 *
 * The file is copied into a fresh folder made for the one run, under a fixed
 * name, and the prompt names only that copy, so nothing from outside (a file
 * name, a folder) reaches the prompt. The copy is removed afterwards.
 *
 * The box, and its holes. The run is given none of Jgtube's tools, is not
 * given `--dangerously-skip-permissions` (which other wrappers pass), and is
 * not given any folder but its own. A headless run cannot ask, so whatever
 * the owner's own settings do not allow (commands, web pages, files outside
 * the folder) is refused. What cannot be prevented from here: the owner's
 * other tool servers, plugins and hooks load as in any `agy` session; since
 * v1.5.7 a run may write inside its working folder, which is why the folder
 * is new each time and removed; and whatever the owner's settings allow
 * everywhere is allowed here too.
 */
import { copyFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { AGY, ONE_LINE, inRunFolder, printTimeout } from './agy';
import { readAgyReply } from './agyReply';
import { EngineRunError, promptWithInstructions } from './failure';
import { isWholeMp4 } from './mp4';
import { NOT_A_VIDEO_ID, isVideoId, videoLink } from './videoId';
import { runProcess } from './process';
import type {
  EngineDeps,
  EngineRunResult,
  VideoLinkRequest,
  VideoQuestion,
  VideoWatchRequest,
} from './types';

/** The one kind of video file taken; see assumption 2. */
const VIDEO_TYPE = '.mp4';
const BYTES_PER_MB = 1024 * 1024;
const MAX_VIDEO_MB = 95;
/** See assumption 3. */
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * BYTES_PER_MB;
/**
 * How long one watch may take. Watching is slower than reading: people who
 * wrap `agy` allow twelve minutes, and so does this.
 */
export const WATCH_TIMEOUT_MS = 12 * 60 * 1000;
/** The copy's name. The prompt names this and nothing else. */
const CLIP = `clip${VIDEO_TYPE}`;
const STOP_MARGIN_MS = 15_000;
const TOO_LONG = 'The video may be too long to watch in one pass.';

const refuse = (message: string): EngineRunError => new EngineRunError('failed', message);

/** The command line for one run that watches. The prompt is an argument, never shell text. */
export function buildAgyVideoArgs(
  prompt: string,
  timeoutMs: number,
  model?: string,
): readonly string[] {
  return [
    '-p',
    prompt,
    '--output-format',
    'json',
    // What is said or shown in a video is not to be trusted with commands.
    '--sandbox',
    '--print-timeout',
    printTimeout(timeoutMs),
    ...(model ? ['--model', model] : []),
  ];
}

/** Rejects, before anything is started, when `agy` could not watch the file. */
export async function checkVideoFile(videoPath: string): Promise<void> {
  if (extname(videoPath).toLowerCase() !== VIDEO_TYPE) {
    throw refuse('Antigravity is only given MP4 files to watch, and this is not one.');
  }
  const found = await stat(videoPath).catch(() => null);
  if (!found?.isFile()) throw refuse('The video file could not be found on this computer.');
  if (found.size > MAX_VIDEO_BYTES) {
    throw refuse(
      `The video file is larger than ${MAX_VIDEO_MB} MB, which is more than Antigravity can open. Use a shorter or smaller copy.`,
    );
  }
  if (!(await isWholeMp4(videoPath))) {
    throw refuse('The video file is not a complete MP4: the download may have stopped part-way.');
  }
}

/** One watching run in a fresh folder, which `prepare` may put a file into first. */
function watch(
  request: VideoQuestion,
  subject: string,
  deps: EngineDeps,
  model: string | undefined,
  prepare: (folder: string) => Promise<void>,
): Promise<EngineRunResult> {
  const prompt = promptWithInstructions(
    request.systemPrompt,
    `Watch ${subject} from start to end, picture and sound. ${request.question}`,
    ONE_LINE,
  );
  return inRunFolder(request.cwd, async (folder) => {
    await prepare(folder);
    const output = await runProcess(
      {
        program: AGY,
        args: buildAgyVideoArgs(prompt, request.timeoutMs, model),
        cwd: folder,
        timeoutMs: request.timeoutMs + STOP_MARGIN_MS,
      },
      deps,
    );
    return readAgyReply(output, []);
  }).catch((error: unknown) => {
    if (!(error instanceof EngineRunError) || error.reason !== 'timeout') throw error;
    throw new EngineRunError('timeout', `${error.message} ${TOO_LONG}`);
  });
}

/** Has `agy` watch one video file on this computer. Rejects with an EngineRunError. */
export async function watchWithAgy(
  request: VideoWatchRequest,
  deps: EngineDeps,
  model?: string,
): Promise<EngineRunResult> {
  await checkVideoFile(request.videoPath);
  return watch(request, `@${CLIP}`, deps, model, async (folder) => {
    const copy = join(folder, CLIP);
    await copyFile(request.videoPath, copy);
    // Checked again as copied, in case the file changed after the first look.
    await checkVideoFile(copy);
  });
}

/**
 * Asks `agy` to watch a public YouTube video from its link alone. Unproven
 * (assumption 6): the answer may come from the page's text instead of the
 * video. The link is built here from the video's id, never taken as typed.
 */
export async function watchLinkWithAgy(
  request: VideoLinkRequest,
  deps: EngineDeps,
  model?: string,
): Promise<EngineRunResult> {
  if (!isVideoId(request.videoId)) throw refuse(NOT_A_VIDEO_ID);
  return watch(
    request,
    `the YouTube video at ${videoLink(request.videoId)}`,
    deps,
    model,
    async () => undefined,
  );
}
