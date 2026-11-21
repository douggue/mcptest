import { open, rm } from 'node:fs/promises';
import { asArray, at, isRecord } from '../sources/mappers';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { pathInside } from './folder';
import {
  VIDEO_MIN_HEIGHT,
  type VideoDownload,
  type VideoFailure,
  type VideoFetcher,
} from './videoFile';

/**
 * Fetches a video file with the YouTube library Jgtube already uses, for a
 * computer without yt-dlp. It asks the player for the video's files, picks
 * the smallest single file with picture and sound, and uses the library's
 * own download call on it.
 *
 * This is the route most likely to stop working: it depends on YouTube
 * answering the library's player request in full, which changes without
 * notice. When it fails the answer says so, and installing yt-dlp is the fix.
 */

const PLAYABLE = 'OK';
const BITS_PER_BYTE = 8;
const BYTES_PER_MB = 1_000_000;
const MAX_REASON_LENGTH = 200;
/** How the library words an answer from YouTube's video servers that is not the file. */
const TURNED_AWAY = /non 2xx|status code|\b40[13]\b|\b429\b/i;
const REFUSED_MESSAGE = 'YouTube refused to send the video file to the download built into Jgtube.';

/** A failed fetch as a failure: a refusal by YouTube in plain words, anything else with its reason. */
function fetchFailure(error: unknown): VideoFailure {
  const reason = firstLine(error);
  return TURNED_AWAY.test(reason)
    ? failure('refused', REFUSED_MESSAGE)
    : failure('unreadable', `The file could not be fetched: ${reason}.`);
}
/** What the player says about a video it will not give to anyone signed out. */
const NOT_AVAILABLE =
  /\b(unavailable|private|removed|not available|confirm your age|age-restricted|members|sign in)\b/i;

/** The player's answer for one video, as the library returns it; read with care. */
export interface VideoPlayerSource {
  /** One request. The answer lists the video's files and carries the library's download call. */
  fetchPlayer(videoId: string): Promise<unknown>;
}

/** One file the player offers that holds both picture and sound. */
export interface MuxedFormat {
  readonly itag: number;
  readonly height: number;
  /** The file's size as the player gives it; null when it does not. */
  readonly exactBytes: number | null;
  /** The size to plan with: the exact one, else an estimate from the bitrate and the length. */
  readonly bytes: number | null;
  readonly bitrate: number | null;
  readonly container: string;
}

const failure = (
  kind: VideoFailure['kind'],
  message: string,
  fitsSeconds?: number | null,
): VideoFailure => ({
  ok: false,
  kind,
  message,
  via: 'built-in',
  ...(fitsSeconds === undefined ? {} : { fitsSeconds }),
});

const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const megabytes = (bytes: number): number => Math.round(bytes / BYTES_PER_MB);

const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .split(/\r?\n/, 1)[0]
    ?.slice(0, MAX_REASON_LENGTH) ?? '';

function toFormat(raw: unknown, durationSeconds: number | null): MuxedFormat | null {
  if (!isRecord(raw) || raw['has_audio'] !== true || raw['has_video'] !== true) return null;
  const itag = positive(raw['itag']);
  const height = positive(raw['height']);
  if (itag === null || height === null || height < VIDEO_MIN_HEIGHT) return null;
  const bitrate = positive(raw['average_bitrate']) ?? positive(raw['bitrate']);
  const estimate =
    bitrate !== null && durationSeconds !== null
      ? Math.round((bitrate * durationSeconds) / BITS_PER_BYTE)
      : null;
  const exactBytes = positive(raw['content_length']);
  const mime = typeof raw['mime_type'] === 'string' ? raw['mime_type'] : '';
  return {
    itag,
    height,
    exactBytes,
    bytes: exactBytes ?? estimate,
    bitrate,
    container: /^video\/([a-z0-9]+)/.exec(mime)?.[1] ?? 'mp4',
  };
}

/**
 * The file to fetch: of the single files with picture and sound at 240 lines
 * or more, the smallest, going by size where the player gives one and by
 * height where it does not. Null when the player offers no such file.
 */
export function chooseMuxedFormat(
  streamingData: unknown,
  durationSeconds: number | null,
): MuxedFormat | null {
  const formats = asArray(at(streamingData, 'formats')).flatMap((raw) => {
    const format = toFormat(raw, durationSeconds);
    return format ? [format] : [];
  });
  const bySize = (a: MuxedFormat, b: MuxedFormat): number =>
    (a.bytes ?? Infinity) - (b.bytes ?? Infinity) || a.height - b.height;
  return [...formats].sort(bySize)[0] ?? null;
}

/**
 * Writes a stream into a file, stopping as soon as it passes the cap. Returns
 * the bytes written, or null when the stream held more than the cap.
 */
async function writeCapped(
  stream: ReadableStream<Uint8Array>,
  path: string,
  maxBytes: number,
): Promise<number | null> {
  const file = await open(path, 'w');
  const reader = stream.getReader();
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return written;
      written += value.byteLength;
      if (written > maxBytes) {
        await reader.cancel();
        return null;
      }
      await file.write(value);
    }
  } finally {
    await file.close();
  }
}

/** The answer for a video whose smallest watchable copy is over the limit. The file is never cut to fit. */
function tooLarge(format: MuxedFormat, maxBytes: number): VideoFailure {
  const fits =
    format.bitrate === null ? null : Math.floor((maxBytes * BITS_PER_BYTE) / format.bitrate);
  const size = format.bytes === null ? '' : ` (about ${megabytes(format.bytes)} MB)`;
  const part =
    fits === null ? '' : ` Only about the first ${Math.floor(fits / 60)} minutes would fit.`;
  return failure(
    'too-large',
    `The smallest watchable copy, ${format.height}p${size}, is over the ${megabytes(maxBytes)} MB a file may be.${part}`,
    fits,
  );
}

/** Why the player would not answer for a video, as a failure. */
function refused(player: unknown): VideoFailure {
  const status = at(player, 'playability_status', 'status');
  const reason = String(at(player, 'playability_status', 'reason') ?? status ?? 'no answer').slice(
    0,
    MAX_REASON_LENGTH,
  );
  return NOT_AVAILABLE.test(reason)
    ? failure('not-available', `YouTube will not give this video: ${reason}`)
    : failure('unreadable', `YouTube would not answer for this video: ${reason}`);
}

type Download = (options: Record<string, unknown>) => Promise<ReadableStream<Uint8Array>>;

/** Fetches the chosen file with the library's download call and checks that all of it arrived. */
async function fetchFormat(
  player: unknown,
  format: MuxedFormat,
  path: string,
  maxBytes: number,
): Promise<VideoFailure | number> {
  const download = isRecord(player) ? player['download'] : undefined;
  if (typeof download !== 'function') {
    return failure('unreadable', 'The YouTube library has no download call for this video.');
  }
  const stream = await (download as Download).call(player, {
    itag: format.itag,
    type: 'video+audio',
    format: 'any',
  });
  const written = await writeCapped(stream, path, maxBytes);
  if (written === null) return tooLarge(format, maxBytes);
  if (written === 0) return failure('unreadable', 'YouTube sent an empty file.');
  if (format.exactBytes !== null && written !== format.exactBytes) {
    return failure(
      'unreadable',
      `The download ended early: ${written} of ${format.exactBytes} bytes arrived.`,
    );
  }
  return written;
}

/** One player request, then the file itself; `path` is where the file went, if one was started. */
async function fetchVideo(
  source: VideoPlayerSource,
  videoId: string,
  folder: string,
  maxBytes: number,
  started: (path: string) => void,
): Promise<VideoDownload> {
  const player = await source.fetchPlayer(videoId);
  if (at(player, 'playability_status', 'status') !== PLAYABLE) return refused(player);
  const durationSeconds = positive(Number(at(player, 'basic_info', 'duration')));
  const format = chooseMuxedFormat(at(player, 'streaming_data'), durationSeconds);
  if (format === null) {
    return failure('not-available', 'YouTube offers no single file with picture and sound for it.');
  }
  // Decided from the size the player gives, before a single byte is fetched.
  if (format.bytes !== null && format.bytes > maxBytes) return tooLarge(format, maxBytes);
  const path = pathInside(folder, `${videoId}.${format.container}`);
  started(path);
  const fetched = await fetchFormat(player, format, path, maxBytes);
  if (typeof fetched !== 'number') return fetched;
  return {
    ok: true,
    path,
    bytes: fetched,
    durationSeconds,
    format: `${format.height}p ${format.container}`,
    via: 'built-in',
  };
}

/** The built-in route. A file is never left behind by a failure. */
export function builtInVideoFetcher(source: VideoPlayerSource): VideoFetcher {
  return {
    route: 'built-in',
    async fetch(videoId, folder, maxBytes): Promise<VideoDownload> {
      if (!VIDEO_ID_PATTERN.test(videoId)) {
        throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
      }
      let path: string | null = null;
      const result = await fetchVideo(source, videoId, folder, maxBytes, (started) => {
        path = started;
      }).catch(fetchFailure);
      if (!result.ok && path !== null) await rm(path, { force: true });
      return result;
    },
  };
}
