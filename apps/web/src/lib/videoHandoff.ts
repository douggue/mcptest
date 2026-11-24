/**
 * A video one view hands to the One video tab to be broken down: the tab
 * fills its link with it when it opens, and the owner presses the button.
 * Taken once; nothing starts on its own.
 */
const VIDEO_ID = /^[\w-]{11}$/;
let handed: string | null = null;

/** Hands a video on; anything that is not a video id is ignored. */
export function handVideo(videoId: string): void {
  if (VIDEO_ID.test(videoId)) handed = videoId;
}

/** The link to fill in, taken once: a second read is empty. */
export function takeHandedVideo(): string {
  const videoId = handed;
  handed = null;
  return videoId === null ? '' : `https://www.youtube.com/watch?v=${videoId}`;
}
