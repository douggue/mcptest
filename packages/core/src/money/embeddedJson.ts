/**
 * Reads one object a YouTube page assigns in a script (`var name = {...};`).
 * The object often ends with more script on the same line, so the end is
 * found by counting braces outside strings, not by looking for `;</script>`.
 */

/** A watch page's embedded objects come to about 1.5 MB; this leaves room and no more. */
export const MAX_EMBEDDED_CHARS = 4_000_000;

/** Where the object that starts at `from` ends (inclusive), or -1 when it does not end within `limit`. */
function endOfObject(text: string, from: number, limit: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const last = Math.min(text.length, from + limit);
  for (let index = from; index < last; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** The object assigned to `name`, or null when the page has none that reads as JSON. */
export function readAssignedObject(
  html: string,
  name: string,
  maxChars: number = MAX_EMBEDDED_CHARS,
): unknown {
  const marker = `var ${name} = `;
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  if (html[from] !== '{') return null;
  const end = endOfObject(html, from, maxChars);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(from, end + 1)) as unknown;
  } catch {
    return null;
  }
}
