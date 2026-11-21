import { readBlocks, single, type LabelledBlock } from '../labelled';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import type { TranscriptSegment } from '../sources/types';

/**
 * The hook library: how the breakout videos on one channel's map open. The
 * words are real. They are the first minute of what is said in a video, cut
 * here in code from its stored captions, and no AI writes or rewrites them.
 * (Captions YouTube made by listening can mishear names and numbers.) The one
 * part an AI adds is a name for the way a hook works and a sentence on it.
 */

/** How much of a video's opening is taken, in seconds: the owner asked for one-minute hooks. */
export const HOOK_SECONDS = 60;
/**
 * The most videos a library is built from. Each missing transcript costs a
 * request or two to YouTube, and a dozen openings are enough to see which
 * ways of opening repeat.
 */
export const HOOK_LIBRARY_VIDEOS = 12;

const SECOND_MS = 1000;
/** A label for a sound, such as [Music], which the captions carry and nobody says. */
const SOUND_LABEL = /\[[^\]]*\]/g;

export interface FirstMinute {
  /** The words said, as the captions give them. */
  readonly text: string;
  /** How many caption lines the words came from. */
  readonly lines: number;
  /** When the last of those lines starts, in whole seconds. */
  readonly lastLineAtSeconds: number;
  readonly words: number;
}

/**
 * What is said in the opening of a video: every caption line that starts
 * inside the first `seconds`, each taken whole, so the cut falls at the end
 * of the last line that starts inside the window and never mid-line. Null
 * when nothing is said in that time.
 */
export function firstMinute(
  segments: readonly TranscriptSegment[],
  seconds: number = HOOK_SECONDS,
): FirstMinute | null {
  const said = segments
    .filter((segment) => segment.startMs < seconds * SECOND_MS)
    .map((segment) => ({
      startMs: segment.startMs,
      text: segment.text.replace(SOUND_LABEL, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((segment) => segment.text !== '');
  const last = said.at(-1);
  if (last === undefined) return null;
  const text = said.map((segment) => segment.text).join(' ');
  return {
    text,
    lines: said.length,
    lastLineAtSeconds: Math.floor(last.startMs / SECOND_MS),
    words: text.split(' ').length,
  };
}

/** A breakout as far as picking needs it. */
export interface HookCandidate {
  readonly videoId: string;
  readonly score: number;
  /** Its channel is a look-alike of the centre channel. */
  readonly peer: boolean;
}

/**
 * The videos a hook library is built from: the breakouts of the look-alike
 * channels on the map, highest score first, up to `cap`; every breakout on
 * the map when no look-alike has one, as the page shows the whole map then.
 */
export function pickHookVideos<T extends HookCandidate>(
  breakouts: readonly T[],
  cap: number = HOOK_LIBRARY_VIDEOS,
): readonly T[] {
  const usable = breakouts.filter((breakout) => VIDEO_ID_PATTERN.test(breakout.videoId));
  const peers = usable.filter((breakout) => breakout.peer);
  const from = peers.length > 0 ? peers : usable;
  return [...from].sort((a, b) => b.score - a.score).slice(0, cap);
}

/** The name an engine gave to the way one hook works, and one sentence on it. */
export interface HookLabel {
  readonly videoId: string;
  /** One to three words, in lower case so the same name always reads the same. */
  readonly style: string;
  readonly how: string;
}

export interface ParsedHookLabels {
  readonly labels: readonly HookLabel[];
  /** Entries the answer set out that had a part missing or a style that is not a short name. */
  readonly unread: number;
}

const LABELS = ['VIDEO', 'STYLE', 'HOW'] as const;
const OPENS = /^VIDEO\s*:/;
const MAX_STYLE_WORDS = 3;
const MAX_STYLE_CHARS = 40;
const MAX_HOW_CHARS = 300;

function labelOf(block: LabelledBlock): HookLabel | null {
  const videoId = single(block, 'VIDEO');
  const style = single(block, 'STYLE')?.toLowerCase().replace(/\s+/g, ' ').trim();
  const how = single(block, 'HOW');
  if (!videoId || !style || !how) return null;
  const short = style.length <= MAX_STYLE_CHARS && style.split(' ').length <= MAX_STYLE_WORDS;
  return short && how.length <= MAX_HOW_CHARS ? { videoId, style, how } : null;
}

/**
 * The labels in an answer, for the videos that were sent and no others: an
 * id the engine was not given names nothing, and a video named twice keeps
 * its first label.
 */
export function parseHookLabels(answer: string, sent: readonly string[]): ParsedHookLabels {
  const read = readBlocks(answer, { labels: LABELS, opens: (line) => OPENS.test(line) }).map(
    labelOf,
  );
  const known = new Set(sent);
  const seen = new Set<string>();
  const labels = read.filter((label): label is HookLabel => {
    if (label === null || !known.has(label.videoId) || seen.has(label.videoId)) return false;
    seen.add(label.videoId);
    return true;
  });
  return { labels, unread: read.filter((label) => label === null).length };
}
