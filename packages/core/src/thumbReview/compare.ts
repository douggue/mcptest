/**
 * Which winning thumbnails one video's thumbnail is set against, chosen in
 * code and the same every time for the same store: winners on the same
 * subject first (sharing a word of the title that carries the subject), then
 * the top winners of the closest look-alikes, a few per channel. Each winner
 * comes with an ordinary video of its own channel, so what the winners share
 * can be told apart from what that channel always does.
 */
import type { BoardChannel, ThumbnailBoard } from '../map/thumbnails';

export const MAX_WINNERS = 12;
const PER_CHANNEL = 3;
const MIN_WORD = 3;
/** Words that say nothing about the subject. */
const COMMON = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'how',
  'why',
  'what',
  'who',
  'was',
  'were',
  'are',
  'you',
  'your',
  'from',
  'into',
  'its',
  'his',
  'her',
  'their',
  'they',
  'has',
  'have',
  'had',
  'not',
  'but',
  'all',
  'can',
  'will',
  'just',
  'about',
  'when',
  'where',
  'which',
  'than',
  'then',
  'out',
  'one',
  'our',
  'over',
  'more',
  'most',
  'did',
  'does',
]);

export interface CompareThumb {
  readonly videoId: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly title: string;
  /** Multiple of its channel's usual views. */
  readonly score: number;
  /** Whether it shares a subject word with the video under review. */
  readonly sameSubject: boolean;
  /** For a winner, the ordinary video of its channel set against it; null when none was left. */
  readonly pairedWith: string | null;
}

export interface ReviewTarget {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
}

export interface ComparisonSet {
  readonly winners: readonly CompareThumb[];
  readonly ordinary: readonly CompareThumb[];
}

/** The words of a title that carry its subject. */
export function titleWords(title: string): ReadonlySet<string> {
  const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((word) => word.length >= MIN_WORD && !COMMON.has(word)));
}

interface Candidate {
  readonly channel: BoardChannel;
  readonly closeness: number;
  readonly video: BoardChannel['winners'][number];
  readonly shared: number;
}

const sharedWords = (words: ReadonlySet<string>, title: string): number =>
  [...titleWords(title)].filter((word) => words.has(word)).length;

/** Same subject first (most words shared), then closer channels, then higher scores. */
const byRank = (a: Candidate, b: Candidate): number =>
  Number(b.shared > 0) - Number(a.shared > 0) ||
  b.shared - a.shared ||
  a.closeness - b.closeness ||
  b.video.score - a.video.score;

function pickWinners(board: ThumbnailBoard, target: ReviewTarget): readonly Candidate[] {
  const words = titleWords(target.title);
  const candidates = board.channels
    .flatMap((channel, closeness) =>
      channel.winners.map((video) => ({
        channel,
        closeness,
        video,
        shared: sharedWords(words, video.title),
      })),
    )
    .filter((candidate) => candidate.video.videoId !== target.videoId)
    .sort(byRank);
  return candidates.reduce<readonly Candidate[]>((picked, candidate) => {
    const fromChannel = picked.filter((entry) => entry.channel.id === candidate.channel.id);
    return picked.length < MAX_WINNERS && fromChannel.length < PER_CHANNEL
      ? [...picked, candidate]
      : picked;
  }, []);
}

const thumbOf = (
  channel: BoardChannel,
  video: BoardChannel['winners'][number],
  sameSubject: boolean,
  pairedWith: string | null,
): CompareThumb => ({
  videoId: video.videoId,
  channelId: channel.id,
  channelTitle: channel.title,
  title: video.title,
  score: video.score,
  sameSubject,
  pairedWith,
});

/** The winners to set one thumbnail against, each with its ordinary counterpart. */
export function chooseComparison(board: ThumbnailBoard, target: ReviewTarget): ComparisonSet {
  const used = new Set<string>();
  const pairs = pickWinners(board, target).map((candidate) => {
    const partner = candidate.channel.ordinary.find(
      (video) => !used.has(video.videoId) && video.videoId !== target.videoId,
    );
    if (partner) used.add(partner.videoId);
    return {
      winner: thumbOf(
        candidate.channel,
        candidate.video,
        candidate.shared > 0,
        partner?.videoId ?? null,
      ),
      ordinary: partner ? thumbOf(candidate.channel, partner, false, null) : null,
    };
  });
  return {
    winners: pairs.map((pair) => pair.winner),
    ordinary: pairs.flatMap((pair) => (pair.ordinary ? [pair.ordinary] : [])),
  };
}
