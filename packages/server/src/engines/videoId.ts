/** A YouTube video id: eleven letters, digits, "-" or "_". Nothing else is ever put into a link. */
const VIDEO_ID = /^[\w-]{11}$/;

export const NOT_A_VIDEO_ID = 'That is not a YouTube video id.';

export const isVideoId = (text: string): boolean => VIDEO_ID.test(text);

/** The link to a video, built from an id that `isVideoId` has passed. */
export const videoLink = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;
