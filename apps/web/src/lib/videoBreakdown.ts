import { apiCaller, type Fetch } from './api';
import type { EngineChoice } from './analyses';
import { engineName, formatBytes } from './breakdown';
import type { CandidateFacts } from './breakdownPicks';
import { AUTOMATIC } from './analyses';
import type { TeardownView } from './teardown';

/**
 * The deep breakdown of one video as the page reads it, from a YouTube link
 * or a file the owner gives: checking what was typed or chosen, saying how
 * the video was seen, and the Markdown file to download. The shapes are the
 * server's.
 */

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
  readonly problem: string | null;
  /** The production teardown; null for a breakdown made before teardowns. */
  readonly teardown: TeardownView | null;
}

export interface VideoBreakdownSummary {
  readonly videoId: string;
  readonly source: 'youtube' | 'file';
  readonly title: string;
  readonly writtenAt: string;
  readonly written: boolean;
}

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
  const measured = seen.frames === null ? null : `${seen.frames} frames measured in code`;
  if (seen.watchedBy !== null) {
    const from = seen.file === 'uploaded' ? 'the file you gave' : 'a copy on this computer';
    return `Watched, picture and sound, by ${name(seen.watchedBy)} from ${from}${measured ? `; ${measured}` : ''}.`;
  }
  if (measured !== null) {
    const looked = seen.framesBy === null ? '' : `; its pictures studied by ${name(seen.framesBy)}`;
    return `Not watched with sound: ${measured}${looked}.`;
  }
  return 'Not watched and nothing measured: judged from its captions alone.';
}

/** What the teardown could and could not rest on, one plain line each. */
export function seenLines(seen: VideoSeen): {
  readonly could: readonly string[];
  readonly couldNot: readonly string[];
} {
  const watched = seen.watchedBy !== null;
  const measured = seen.frames !== null;
  const could = [
    ...(measured ? ['Every frame, measured in code: cuts, colours, transitions, motion.'] : []),
    ...(measured ? ['Its loudness, measured in code.'] : []),
    ...(watched ? ['The sound itself: voice, music and sound effects.'] : []),
    ...(seen.captions === 'read' ? ['What is said, from its captions.'] : []),
  ];
  const couldNot = [
    ...(watched
      ? []
      : ['The sound itself: nothing heard it, so sound rests on the measured loudness.']),
    ...(measured ? [] : ['The pictures: there was no file to measure.']),
    ...(seen.captions === 'none' ? ['Captions: YouTube has none for it.'] : []),
    ...(seen.captions === 'failed' ? ['Captions: they could not be read this time.'] : []),
    ...(seen.fileNote === null ? [] : [`File: ${seen.fileNote}`]),
    ...seen.notes,
  ];
  return { could, couldNot };
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const writtenText = (iso: string): string => DATE.format(new Date(iso));

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
