const MAX_MESSAGE_LENGTH = 300;
const GENERIC_MESSAGE = 'Something went wrong.';
/** Error text can carry scraped strings; keep control and direction characters out of it. */
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
/** Matches things that look like file paths, which have no business reaching the reader. */
const PATH_LIKE = /(?:[A-Za-z]:)?[\\/][^\s:"']*[\\/][^\s:"']*/g;

/** A failure the reader can act on; its message is a sentence written for them. */
export class ToolFailure extends Error {
  override readonly name = 'ToolFailure';
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/**
 * One line of plain text for any failure: the first line only (so no stack
 * trace), with file paths and control characters removed, cut to a fixed length.
 */
export function plainMessage(error: unknown): string {
  const firstLine = rawMessage(error).split(/\r?\n/, 1)[0] ?? '';
  const cleaned = firstLine
    .replace(PATH_LIKE, '<path>')
    .replace(UNSAFE_CHARACTERS, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
  return cleaned === '' ? GENERIC_MESSAGE : cleaned;
}
