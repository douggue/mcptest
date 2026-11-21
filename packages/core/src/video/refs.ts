/**
 * Naming a video in an AI's answer in a form code can read: `[video:ID]`,
 * right after the point that rests on it. The page turns each one into the
 * video's real thumbnail, and drops any id that is not a stored video of the
 * map on screen, so a made-up id is never shown.
 */

/** One named video. The id is YouTube's: eleven letters, digits, hyphens or underscores. */
const VIDEO_REF = /\[video:\s*([A-Za-z0-9_-]{11})\s*\]/g;

/** What a fixed question tells an engine about naming videos. The same for every channel. */
export const VIDEO_REF_RULE =
  'Each time a point rests on a video, put that video’s id right after the point in exactly this form: [video:THE_ID], one id to a pair of brackets, using the id a tool gave you for it. Never write an id from memory and never make one up: a point with no video behind it carries no marker. The owner is shown the real thumbnail of each video you name.';

/** A piece of an answer: words as written, or a video named at that point. */
export type RefPart = { readonly text: string } | { readonly videoId: string };

/** The ids of the videos a text names, each once, in the order first named. */
export function videoRefIds(text: string): readonly string[] {
  return [...new Set([...text.matchAll(VIDEO_REF)].flatMap((match) => match[1] ?? []))];
}

/** A text cut into its words and the videos named in it, in order. */
export function splitVideoRefs(text: string): readonly RefPart[] {
  const parts: RefPart[] = [];
  let from = 0;
  for (const match of text.matchAll(VIDEO_REF)) {
    const id = match[1];
    if (id === undefined) continue;
    if (match.index > from) parts.push({ text: text.slice(from, match.index) });
    parts.push({ videoId: id });
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

/** The text without its video markers, and without the gaps they leave. */
export function stripVideoRefs(text: string): string {
  return text
    .replace(VIDEO_REF, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '');
}
