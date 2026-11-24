import { ApiError } from './api';
import type { UploadedVideo } from './breakdown';

/**
 * Sends the owner's own copy of a video to the local server, saying how far
 * it has got as it goes. `fetch` cannot report how much of a body has been
 * sent, so this uses the browser's older request, behind a small interface a
 * test can stand in for.
 */

const VIDEO_ID = /^[\w-]{11}$/;
const UPLOAD_PATH = '/api/breakdowns/videos/';
const VIDEO_TYPE = 'video/mp4';
const FILES_PATH = '/api/video-breakdowns/files';

/** The parts of the browser's request this needs. */
export interface UploadRequest {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  readonly status: number;
  readonly responseText: string;
  readonly upload: {
    onprogress: ((event: { readonly loaded: number; readonly total: number }) => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

interface Envelope {
  readonly success?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
}

function readReply(request: UploadRequest): unknown {
  let body: Envelope;
  try {
    body = JSON.parse(request.responseText) as Envelope;
  } catch {
    throw new ApiError('The Jgtube server gave an unexpected reply', request.status);
  }
  if (body.success !== true) {
    const message = typeof body.error === 'string' ? body.error : 'The file could not be saved';
    throw new ApiError(message, request.status);
  }
  return body.data;
}

/**
 * The browser's own request. Its events carry more than this module reads,
 * so it is narrowed to the few parts used.
 */
const browserRequest = (): UploadRequest => new XMLHttpRequest() as unknown as UploadRequest;

/**
 * Sends one video file for a video, reporting the fraction sent (0 to 1) as
 * it goes. Resolves with where the file was saved; rejects with the server's
 * plain reason, or with one sentence when the connection was lost.
 */
export function uploadVideoFile(
  videoId: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  createRequest: () => UploadRequest = browserRequest,
): Promise<UploadedVideo> {
  if (!VIDEO_ID.test(videoId)) {
    return Promise.reject(new ApiError('That is not a YouTube video id.', 400));
  }
  return sendFile<UploadedVideo>(
    `${UPLOAD_PATH}${videoId}`,
    VIDEO_TYPE,
    file,
    onProgress,
    createRequest,
  );
}

/**
 * Sends a file by PUT with the given type, reporting the fraction sent (0 to
 * 1). Resolves with the server's data; rejects with its plain reason, or with
 * one sentence when the connection was lost.
 */
function sendFile<T>(
  path: string,
  type: string,
  file: Blob,
  onProgress: (fraction: number) => void,
  createRequest: () => UploadRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = createRequest();
    const lost = (): void =>
      reject(new ApiError('The file could not be sent. Check that Jgtube is still running.', 0));
    request.upload.onprogress = (event) => {
      if (event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onerror = lost;
    request.onabort = lost;
    request.onload = () => {
      try {
        resolve(readReply(request) as T);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    request.open('PUT', path);
    // Set whatever the browser thinks the file is: the server checks the file itself.
    request.setRequestHeader('content-type', type);
    request.send(file);
  });
}

/** A video file given for the One video tab, as the server saved it. */
export interface SavedFile {
  /** The id it was saved under, which the breakdown is started with. */
  readonly file: string;
  readonly bytes: number;
  readonly kind: string;
}

/** Sends a whole video file (MP4, WebM or MOV) to be broken down; `type` from `fileType`. */
export function uploadBreakdownFile(
  file: Blob,
  type: string,
  onProgress: (fraction: number) => void,
  createRequest: () => UploadRequest = browserRequest,
): Promise<SavedFile> {
  return sendFile<SavedFile>(FILES_PATH, type, file, onProgress, createRequest);
}

/** Sends a picture (PNG, JPEG or WebP) for the format builder's shelf; resolves with its saved name. */
export function uploadFormatImage(
  file: Blob,
  onProgress: (fraction: number) => void,
  createRequest: () => UploadRequest = browserRequest,
): Promise<{ readonly file: string }> {
  return sendFile('/api/format/images', file.type || 'image/png', file, onProgress, createRequest);
}
