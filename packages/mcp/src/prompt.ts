import { requireChannelRef } from './readTools';

export const THUMBNAIL_REVIEW_PROMPT = 'thumbnail_review';

export const THUMBNAIL_REVIEW_DESCRIPTION =
  'Compare your thumbnails with the ones that took off on channels like yours, and get specific changes to make.';

/** The instructions for a thumbnail review of one channel. Fails when the text is not a channel. */
export function thumbnailReviewText(channel: string): string {
  const ref = channel.trim();
  requireChannelRef(ref);
  return [
    `Review the thumbnails of my YouTube channel ${ref} against what works on channels like mine.`,
    '',
    `1. Call get_thumbnail_board for ${ref}. "own" is my videos; each channel lists winners (far above its usual views) and ordinary videos.`,
    '2. Call view_thumbnails with up to 8 ids at a time: first my own videos, then the winners of the two or three strongest channels, then a few of their ordinary videos for contrast.',
    '3. Say what the winners share that the ordinary ones lack: subject and its size in the frame, number of words and their size, colours and contrast, faces or objects, what the eye lands on first, and how the picture works with the title.',
    '4. Say plainly how my thumbnails differ from the winners.',
    '5. Give me three to five changes to make, most valuable first. For each, name the winning video it comes from and describe it concretely enough to brief a designer or an image tool.',
    '',
    'Base every point on thumbnails you looked at and name the video. If an image could not be loaded, say so instead of guessing. If my channel has no videos yet, describe the style to copy instead.',
  ].join('\n');
}
