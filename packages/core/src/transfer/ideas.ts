import { isSlot, titleTemplate, type TitleTemplate } from './template';
import type { RecentVideo } from './types';

/**
 * "Same idea": videos whose titles are one title but for the place and the
 * numbers. Each title is turned into its template, and videos with the same
 * template words are one idea. Nothing is compared with anything else: videos
 * are dropped into buckets by their words, so the work grows with the number
 * of videos, not with its square.
 *
 * What it cannot do: tell a synonym from a subject. "Just Detected A Fuel" and
 * "Just Found A Fuel" are one idea to a reader and "Just Found An Engine" is
 * another, but all three differ from each other by one word, and only meaning
 * tells them apart. So a title that differs by a word in the middle is a
 * different idea here, and `formats.ts` lists such titles as close variants.
 */

/**
 * An idea needs this many words besides its slots. Fewer than three is a
 * phrase ("{place} news", "top {n}"), which many unrelated videos share.
 */
export const IDEA_MIN_WORDS = 3;
/**
 * "Nearly the same title": the same words with at most this many more at the
 * front or the end. That is the room a tag takes ("Breaking:", "- must
 * watch", "| full documentary"); three or more added words are a clause of
 * their own and can change what the video is about.
 */
export const IDEA_MAX_TAG_WORDS = 2;
/** One video is not an idea that travels: it takes a second, from a second channel. */
export const IDEA_MIN_VIDEOS = 2;
export const IDEA_MIN_CHANNELS = 2;

export interface TitledVideo {
  readonly video: RecentVideo;
  readonly template: TitleTemplate;
}

/** The videos that share one title template. */
export interface Idea {
  /** The template's words joined by spaces; what the idea is known by. */
  readonly key: string;
  readonly words: readonly string[];
  readonly videos: readonly TitledVideo[];
}

const keyOf = (words: readonly string[]): string => words.join(' ');
const contentWords = (words: readonly string[]): number =>
  words.filter((word) => !isSlot(word)).length;

/** Videos by the words of their template; titles too short to be an idea are left out. */
function bucketByWords(videos: readonly RecentVideo[]): ReadonlyMap<string, Idea> {
  // Filled in place: copying a bucket for each video added would cost its square.
  const members = new Map<string, TitledVideo[]>();
  const wordsByKey = new Map<string, readonly string[]>();
  for (const video of videos) {
    const template = titleTemplate(video.title);
    if (contentWords(template.words) < IDEA_MIN_WORDS) continue;
    const key = keyOf(template.words);
    const bucket = members.get(key) ?? [];
    if (bucket.length === 0) {
      members.set(key, bucket);
      wordsByKey.set(key, template.words);
    }
    bucket.push({ video, template });
  }
  return new Map(
    [...members].map(([key, bucket]) => [
      key,
      { key, words: wordsByKey.get(key) ?? [], videos: bucket },
    ]),
  );
}

/**
 * The same words with a tag of one or two words taken off the end or the
 * front, shortest tag first. A slot is never taken off: a title that names a
 * place is not a tagged copy of one that does not.
 */
function withoutTag(words: readonly string[]): readonly string[] {
  const tagLengths = Array.from({ length: IDEA_MAX_TAG_WORDS }, (_, index) => index + 1);
  const shorter = tagLengths.flatMap((count) => [
    { kept: words.slice(0, -count), dropped: words.slice(-count) },
    { kept: words.slice(count), dropped: words.slice(0, count) },
  ]);
  return shorter
    .filter(({ kept, dropped }) => !dropped.some(isSlot) && contentWords(kept) >= IDEA_MIN_WORDS)
    .map(({ kept }) => keyOf(kept));
}

/**
 * For each bucket, the bucket it is a tagged copy of, followed to the end: a
 * tagged copy of a tagged copy belongs to the untagged title. Each step is
 * shorter than the last, so the walk ends.
 */
function untaggedKey(key: string, buckets: ReadonlyMap<string, Idea>): string {
  const words = buckets.get(key)?.words ?? [];
  const shorter = withoutTag(words).find((candidate) => buckets.has(candidate));
  return shorter === undefined ? key : untaggedKey(shorter, buckets);
}

const byViews = (a: TitledVideo, b: TitledVideo): number =>
  b.video.views - a.video.views || (a.video.id < b.video.id ? -1 : 1);

/**
 * Every idea among these videos, whether one channel made it or many, in the
 * order of their keys. An idea's videos are most viewed first.
 */
export function groupIdeas(videos: readonly RecentVideo[]): readonly Idea[] {
  const buckets = bucketByWords(videos);
  const merged = new Map<string, TitledVideo[]>();
  for (const [key, bucket] of buckets) {
    const root = untaggedKey(key, buckets);
    const members = merged.get(root) ?? [];
    if (members.length === 0) merged.set(root, members);
    for (const member of bucket.videos) members.push(member);
  }
  return [...merged]
    .map(([key, members]) => ({
      key,
      words: buckets.get(key)?.words ?? [],
      videos: [...members].sort(byViews),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Whether an idea was made at least twice, by at least two channels. */
export function isShared(idea: Idea): boolean {
  const channels = new Set(idea.videos.map((entry) => entry.video.channelId));
  return idea.videos.length >= IDEA_MIN_VIDEOS && channels.size >= IDEA_MIN_CHANNELS;
}
