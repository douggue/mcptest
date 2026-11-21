/**
 * What `npm run engines` prints: which AI engines are on this computer and,
 * with `--try`, what each says when asked one small question. This is how the
 * owner finds out on their own computer what works, since none of the engines
 * but Claude Code could be run where this was written.
 */
import { cleanMessage } from '../jobs';
import type { EngineReport } from './catalog';
import { EngineRunError } from './failure';
import type { EngineId, EngineRunResult, EngineStatus } from './types';
import { isVideoId } from './videoId';

export interface EnginesCommand {
  /** Ask each engine a question, which spends a little of each plan's allowance. */
  readonly try: boolean;
  /** A small video file for Antigravity to watch. */
  readonly video: string | null;
  /** The id of a YouTube video for Antigravity to try from its link alone. */
  readonly youtube: string | null;
  /** Add the one line Antigravity's settings need to use Jgtube's tools, then stop. */
  readonly allowAntigravity: boolean;
}

/** What `--try` can do; the command line program supplies the real thing. */
export interface TrialActions {
  /** One question that needs one of Jgtube's tools, through one engine. */
  ask(engine: EngineId): Promise<EngineRunResult>;
  /** One question in words to the Gemini API. */
  askGemini(): Promise<EngineRunResult>;
  /** Antigravity watching a video file. */
  watchFile(path: string): Promise<EngineRunResult>;
  /** Antigravity asked about a YouTube video from its link alone. */
  watchLink(videoId: string): Promise<EngineRunResult>;
}

export type Trial =
  | { readonly intro: string; readonly run: () => Promise<EngineRunResult> }
  | { readonly skipped: string };

const YOUTUBE_HOSTS: readonly string[] = ['www.youtube.com', 'youtube.com', 'm.youtube.com'];
const SHORT_HOST = 'youtu.be';
const SHORTS_PATH = /^\/shorts\/([\w-]{11})$/;
const UNKNOWN_SIGN_IN = 'sign-in is only known once it is used';

/** The video id in a YouTube link, or in an id given bare. Null for anything else. */
export function videoIdOf(link: string): string | null {
  if (isVideoId(link)) return link;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const candidate =
    url.hostname === SHORT_HOST
      ? url.pathname.slice(1)
      : YOUTUBE_HOSTS.includes(url.hostname)
        ? (url.searchParams.get('v') ?? SHORTS_PATH.exec(url.pathname)?.[1] ?? '')
        : '';
  return isVideoId(candidate) ? candidate : null;
}

const ALLOW_ANTIGRAVITY = '--allow-antigravity';

/** The value that follows a flag. Throws, in plain words, when there is none. */
function valueAfter(argv: readonly string[], flag: string, what: string): string | null {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs ${what}`);
  return value;
}

/** Reads the command line. Throws an Error with a plain reason when it makes no sense. */
export function parseEnginesArgs(argv: readonly string[]): EnginesCommand {
  const video = valueAfter(argv, '--video', 'the path of a small MP4 file');
  const link = valueAfter(argv, '--youtube', 'a YouTube link');
  const known = ['--try', '--video', '--youtube', ALLOW_ANTIGRAVITY, video, link];
  const stray = argv.find((argument) => !known.includes(argument));
  if (stray !== undefined) throw new Error(`Not understood: ${stray}`);
  const wantsTry = argv.includes('--try');
  if (!wantsTry && (video !== null || link !== null)) {
    throw new Error('--video and --youtube work only with --try');
  }
  const youtube = link === null ? null : videoIdOf(link);
  if (link !== null && youtube === null) throw new Error('--youtube needs a YouTube link');
  const allowAntigravity = argv.includes(ALLOW_ANTIGRAVITY);
  if (allowAntigravity && argv.length > 1) {
    throw new Error(`${ALLOW_ANTIGRAVITY} is used on its own`);
  }
  return { try: wantsTry, video, youtube, allowAntigravity };
}

function signInWords(signedIn: boolean | null): string {
  if (signedIn === null) return UNKNOWN_SIGN_IN;
  return signedIn ? 'signed in' : 'nobody is signed in';
}

function statusLine(status: EngineStatus): string {
  const name = `  ${status.label} (${status.id})`;
  const note = status.note ? ` ${status.note}` : '';
  if (status.id === 'gemini-api') {
    return `${name}: ${status.installed ? 'key set.' : 'no key set.'}${note}`;
  }
  if (!status.installed) return `${name}: not installed`;
  const facts = [
    'installed',
    ...(status.version ? [`version ${status.version}`] : []),
    signInWords(status.signedIn),
  ].join(', ');
  return `${name}: ${facts}${note ? `.${note}` : ''}`;
}

/** The report as lines of plain text. */
export function reportLines({ engines, order }: EngineReport): readonly string[] {
  return [
    `AI engines on this computer (tried in this order: ${order.join(', ')})`,
    ...engines.map(statusLine),
  ];
}

/** Where each helper program is on this computer; null when it is not installed. */
export interface HelperPrograms {
  readonly ytDlp: string | null;
  readonly ffmpeg: string | null;
}

/** Whether the two helper programs a deep breakdown uses are installed, as lines of plain text. */
export function helperLines({ ytDlp, ffmpeg }: HelperPrograms): readonly string[] {
  const found = (path: string | null): string => (path === null ? 'not found' : `found at ${path}`);
  const missing = [
    ...(ytDlp === null ? ['JGTUBE_YT_DLP_PATH'] : []),
    ...(ffmpeg === null ? ['JGTUBE_FFMPEG_PATH'] : []),
  ];
  return [
    'Helper programs for a deep channel breakdown',
    `yt-dlp: ${found(ytDlp)}. Downloads a video so that it can be watched and its frames cut.`,
    `ffmpeg: ${found(ffmpeg)}. Cuts one frame a second from a video file.`,
    ...(missing.length > 0
      ? [
          'Jgtube looks in the folders on your PATH and, on Windows, where winget, scoop, Chocolatey and Python put programs.',
          `If you have the program somewhere else, add a line to the .env file with its full path, for example ${missing[0]}=C:\\Tools\\${missing[0] === 'JGTUBE_YT_DLP_PATH' ? 'yt-dlp' : 'ffmpeg'}.exe${missing.length > 1 ? ` (and ${missing[1]} for the other)` : ''}, then start Jgtube again.`,
          'Without them a breakdown still runs, on YouTube’s own preview frames.',
        ]
      : []),
  ];
}

/** Why an engine is left alone, or null when it can be tried. */
function leftAlone(status: EngineStatus): string | null {
  if (status.id === 'gemini-api') return status.installed ? null : 'no key set';
  if (!status.installed) return 'not installed';
  return status.signedIn === false ? 'nobody is signed in' : null;
}

type Run = () => Promise<EngineRunResult>;

const LINK_WARNING =
  'the YouTube link alone. If the answer does not match the video, links do not work and the setting should stay off...';

function engineTrial(status: EngineStatus, how: string, run: Run): Trial {
  const why = leftAlone(status);
  return why === null
    ? { intro: `Trying ${status.label} with ${how}...`, run }
    : { skipped: `Not trying ${status.label}: ${why}.` };
}

function videoTrial(agy: EngineStatus | undefined, what: string, on: string, run: Run): Trial {
  return agy?.installed
    ? { intro: `Trying ${agy.label} on ${on}`, run }
    : { skipped: `Not trying ${what}: Antigravity CLI is not installed.` };
}

/** What `--try` will do, in order: each engine that can be tried, then the video checks asked for. */
export function planTrials(
  command: EnginesCommand,
  { engines, order }: EngineReport,
  actions: TrialActions,
): readonly Trial[] {
  if (!command.try) return [];
  const find = (id: EngineStatus['id']) => engines.find((status) => status.id === id);
  const agy = find('agy');
  const gemini = find('gemini-api');
  const { video, youtube } = command;
  const withTools = order.flatMap((id) => {
    const status = find(id);
    const how = 'one question that needs one Jgtube tool';
    return status ? [engineTrial(status, how, () => actions.ask(id))] : [];
  });
  const inWords = gemini
    ? [
        engineTrial(gemini, 'one question in words, to prove the key works', () =>
          actions.askGemini(),
        ),
      ]
    : [];
  const file =
    video === null
      ? []
      : [videoTrial(agy, 'the video file', 'the video file...', () => actions.watchFile(video))];
  const link =
    youtube === null
      ? []
      : [videoTrial(agy, 'the YouTube link', LINK_WARNING, () => actions.watchLink(youtube))];
  return [...withTools, ...inWords, ...file, ...link];
}

function answerLines(text: string): readonly string[] {
  const [first = '', ...rest] = text.trim().split('\n');
  return [`  It answered: ${first}`, ...rest.map((line) => `    ${line}`)];
}

const failureLine = (error: unknown): string =>
  error instanceof EngineRunError
    ? `  It failed (${error.reason}): ${error.message}`
    : `  It failed (failed): ${cleanMessage(error)}`;

/** Runs the trials one after another, printing what each engine said or why it could not. */
export async function runTrials(
  trials: readonly Trial[],
  print: (line: string) => void,
): Promise<void> {
  if (trials.length > 0) print('');
  for (const trial of trials) {
    if ('skipped' in trial) {
      print(trial.skipped);
      continue;
    }
    print(trial.intro);
    try {
      answerLines((await trial.run()).text).forEach(print);
    } catch (error) {
      print(failureLine(error));
    }
  }
}
