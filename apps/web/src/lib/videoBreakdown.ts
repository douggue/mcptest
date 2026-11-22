import { apiCaller, type Fetch } from './api';
import type { EngineChoice } from './analyses';
import { engineName, formatBytes } from './breakdown';
import type { CandidateFacts } from './breakdownPicks';
import { AUTOMATIC } from './analyses';

/**
 * The deep breakdown of one video as the page reads it, from a YouTube link
 * or a file the owner gives: checking what was typed or chosen, saying how
 * the video was seen, and the Markdown file to download. The shapes are the
 * server's.
 */

export type PromptId = 'script' | 'visual' | 'thumbnail';

export interface VideoSeen {
  readonly file: 'own' | 'downloaded' | 'uploaded' | 'none';
  readonly fileNote: string | null;
  readonly watchedBy: string | null;
  readonly framesBy: string | null;
  readonly frameSource: 'file' | 'preview' | null;
  readonly frames: number | null;
  readonly captions: 'read' | 'none' | 'failed' | 'not-asked';
  readonly notes: readonly string[];
}

export interface VideoBreakdownView {
  readonly videoId: string;
  readonly source: 'youtube' | 'file';
  readonly title: string;
  readonly channelId: string | null;
  readonly writtenAt: string;
  readonly seen: VideoSeen;
  readonly engine: string | null;
  readonly body: string | null;
  readonly prompts: Readonly<Record<PromptId, string | null>>;
  readonly problem: string | null;
}

export interface VideoBreakdownSummary {
  readonly videoId: string;
  readonly source: 'youtube' | 'file';
  readonly title: string;
  readonly writtenAt: string;
  readonly written: boolean;
}

export const PROMPT_LABELS: Readonly<Record<PromptId, string>> = {
  script: 'script prompt',
  visual: 'visual style prompt',
  thumbnail: 'thumbnail prompt',
};
export const PROMPT_IDS: readonly PromptId[] = ['script', 'visual', 'thumbnail'];

const VIDEO_ID = /^[\w-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);

/** The video id a link or id names; null when it names none. */
export function videoIdFrom(text: string): string | null {
  const typed = text.trim();
  if (VIDEO_ID.test(typed)) return typed;
  let url: URL;
  try {
    url = new URL(typed.includes('://') ? typed : `https://${typed}`);
  } catch {
    return null;
  }
  const path = url.pathname.split('/').filter(Boolean);
  const id =
    url.hostname === 'youtu.be'
      ? path[0]
      : YOUTUBE_HOSTS.has(url.hostname)
        ? (url.searchParams.get('v') ??
          (['shorts', 'embed', 'live'].includes(path[0] ?? '') ? path[1] : undefined))
        : undefined;
  return id !== undefined && VIDEO_ID.test(id) ? id : null;
}

/** Why a typed link cannot be broken down, in one line; null when it can. */
export function linkProblem(text: string): string | null {
  if (text.trim() === '') return 'Paste a YouTube video link first.';
  return videoIdFrom(text) === null
    ? 'That is not a YouTube video link. Paste a link like youtube.com/watch?v=… or youtu.be/….'
    : null;
}

/** The kinds of file taken, by what the browser says they are. */
export const FILE_TYPES: Readonly<Record<string, string>> = {
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
  'video/quicktime': 'MOV',
};
const FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
/** The largest file taken, the same cap as the owner's own copies. */
export const MAX_FILE_BYTES = 2_000_000_000;

/** The type to send a file as: what the browser says, else what its name ends in; null when not taken. */
export function fileType(file: { readonly name: string; readonly type: string }): string | null {
  if (FILE_TYPES[file.type] !== undefined) return file.type;
  const dot = file.name.lastIndexOf('.');
  return dot < 0 ? null : (FILE_EXTENSIONS[file.name.slice(dot).toLowerCase()] ?? null);
}

/** Why a chosen file cannot be sent, in one line; null when it can. */
export function fileProblem(file: {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}): string | null {
  if (fileType(file) === null) return 'Choose an MP4, WebM or MOV video file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_FILE_BYTES) {
    return `That file is ${formatBytes(file.size)}, more than the ${formatBytes(MAX_FILE_BYTES)} a video file may be.`;
  }
  return null;
}

const name = (engine: string | null): string => (engine === null ? '' : engineName(engine));

/** Which route was used to see the video, in one line. */
export function routeLine(seen: VideoSeen): string {
  if (seen.watchedBy !== null) {
    const from =
      seen.watchedBy === 'gemini-api'
        ? 'from its YouTube link'
        : seen.file === 'uploaded'
          ? 'from the file you gave'
          : 'from a copy on this computer';
    return `Watched, picture and sound, by ${name(seen.watchedBy)} ${from}.`;
  }
  if (seen.framesBy !== null) {
    const frames = seen.frames === null ? 'its frames' : `${seen.frames} frames`;
    const source =
      seen.frameSource === 'file'
        ? 'cut from the video, one a second'
        : 'from YouTube’s small preview pictures';
    const captions = seen.captions === 'read' ? ' and its captions' : '';
    return `Not watched: ${name(seen.framesBy)} went through ${frames} ${source}${captions}.`;
  }
  return 'Not watched and no frames seen: written from its captions alone.';
}

/** What the engines could and could not see, one plain line each. */
export function seenLines(seen: VideoSeen): {
  readonly could: readonly string[];
  readonly couldNot: readonly string[];
} {
  const watched = seen.watchedBy !== null;
  const pictures = watched || seen.framesBy !== null;
  const could = [
    ...(pictures ? ['The pictures: footage, text on screen, how often it changes.'] : []),
    ...(watched ? ['The sound: voice, music and sound effects, and the cuts.'] : []),
    ...(seen.captions === 'read' ? ['What is said, from its captions.'] : []),
  ];
  const couldNot = [
    ...(watched ? [] : ['The sound: voice, music, sound effects. Nothing that heard it said so.']),
    ...(pictures ? [] : ['The pictures.']),
    ...(seen.captions === 'none' ? ['Captions: YouTube has none for it.'] : []),
    ...(seen.captions === 'failed' ? ['Captions: they could not be read this time.'] : []),
    ...(seen.fileNote === null ? [] : [`No video file: ${seen.fileNote}`]),
    ...seen.notes,
  ];
  return { could, couldNot };
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const writtenText = (iso: string): string => DATE.format(new Date(iso));

/** A section title in capitals on its own line becomes a Markdown heading; list items stay. */
function bodyMarkdown(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const text = line.trim();
      const heading = /^[A-Z0-9][A-Z0-9 ,'’&/()-]{2,}:?$/.test(text) && /[A-Z]{3}/.test(text);
      return heading ? `\n## ${text.replace(/:$/, '')}\n` : line;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The whole breakdown as a Markdown file: what it is of, how it was seen, the answer and the prompts. */
export function videoMarkdown(view: VideoBreakdownView): string {
  const { could, couldNot } = seenLines(view.seen);
  const link = view.source === 'youtube' ? `https://www.youtube.com/watch?v=${view.videoId}` : null;
  const prompts = PROMPT_IDS.flatMap((id) => {
    const text = view.prompts[id];
    return text === null ? [] : [`### The ${PROMPT_LABELS[id]}`, '', '```text', text, '```', ''];
  });
  return [
    `# ${view.title}`,
    '',
    link === null ? 'A video file you gave Jgtube.' : link,
    `Broken down ${writtenText(view.writtenAt)}${view.engine ? `, written by ${name(view.engine)}` : ''}.`,
    '',
    '## How it was seen',
    '',
    routeLine(view.seen),
    ...could.map((line) => `- Could see: ${line}`),
    ...couldNot.map((line) => `- Could not: ${line}`),
    '',
    view.body === null
      ? `It could not be written: ${view.problem ?? 'no reason was given'}`
      : bodyMarkdown(view.body),
    '',
    ...(prompts.length > 0 ? ['## Ready prompts', '', ...prompts] : []),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n');
}

/** A file name for the Markdown download. */
export const markdownName = (view: VideoBreakdownView): string =>
  `${
    view.title
      .replace(/[^\w .()-]/g, '_')
      .slice(0, 80)
      .trim() || 'video'
  } - breakdown.md`;

/** The Breakdown view's own requests. */
export function createBreakdownViewApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  return {
    async candidates(ids: readonly string[]): Promise<readonly CandidateFacts[]> {
      if (ids.length === 0) return [];
      return unwrap<{ candidates: CandidateFacts[] }>(
        await send('/api/breakdowns/candidates', { ids }),
      ).candidates;
    },
    async readChannel(channel: string): Promise<CandidateFacts> {
      return unwrap<{ candidate: CandidateFacts }>(
        await send('/api/breakdowns/channel', { channel }),
      ).candidate;
    },
    async startVideo(
      target: { readonly video: string } | { readonly file: string; readonly name: string },
      choice: EngineChoice,
      fresh: boolean,
    ): Promise<{ readonly jobId: string; readonly video: string }> {
      const engine = choice === AUTOMATIC ? {} : { engine: choice };
      return unwrap(await send('/api/video-breakdowns', { ...target, ...engine, fresh }));
    },
    async videoBreakdowns(): Promise<readonly VideoBreakdownSummary[]> {
      return unwrap<{ items: VideoBreakdownSummary[] }>(await call('/api/video-breakdowns')).items;
    },
    async videoBreakdown(videoId: string): Promise<VideoBreakdownView | null> {
      return unwrap<VideoBreakdownView | null>(
        await call(`/api/video-breakdowns?video=${encodeURIComponent(videoId)}`),
      );
    },
    async job(id: string): Promise<{
      readonly status: 'running' | 'done' | 'failed';
      readonly progress: { readonly text: string } | null;
      readonly result: VideoBreakdownView | null;
      readonly error: string | null;
    }> {
      return unwrap(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type BreakdownViewApi = ReturnType<typeof createBreakdownViewApi>;
