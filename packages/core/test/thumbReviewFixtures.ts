import type { ThumbnailBoard } from '../src/map/thumbnails';
import type { ThumbTags } from '../src/thumbReview/tags';

export const TAGS: ThumbTags = {
  face: 'large',
  expression: 'surprised',
  words: 3,
  textSize: 'large',
  textColour: 'yellow',
  background: 'photo',
  colours: ['yellow', 'black'],
  subjectSize: 'large',
  highlight: true,
  split: false,
  flagOrMap: false,
  logo: false,
  brightness: 'bright',
  clutter: 1,
  description: 'A shocked face beside a glowing machine, three yellow words.',
};

/** An id of eleven characters from a prefix and a number. */
export const vid = (prefix: string, n: number): string =>
  `${prefix}${String(n).padStart(11 - prefix.length, '0')}`;

const video = (videoId: string, title: string, score: number) => ({
  videoId,
  title,
  views: 1000,
  score,
  publishedRaw: '1w ago',
  ageDays: 7,
  durationSeconds: 600,
});

/** A board: the owner's channel and `peers` channels, each with winners and ordinary videos. */
export function boardOf(
  peers: readonly { readonly winners: readonly string[]; readonly ordinary?: number }[],
): ThumbnailBoard {
  return {
    mapId: 1,
    center: {
      id: 'UCowner',
      title: 'Mine',
      subscribers: 100,
      videos: [video(vid('own', 1), 'Who invented the bicycle', 1)],
    },
    channels: peers.map((peer, c) => ({
      id: `UCpeer${c}`,
      title: `Peer ${c}`,
      subscribers: 1000,
      winners: peer.winners.map((title, n) => video(vid(`w${c}x`, n), title, 10 - n)),
      ordinary: Array.from({ length: peer.ordinary ?? 2 }, (_, n) =>
        video(vid(`o${c}x`, n), `Ordinary ${c} ${n}`, 1),
      ),
      winnerCount: peer.winners.length,
      scoredCount: peer.winners.length + (peer.ordinary ?? 2),
    })),
    winnerMinScore: 3,
    ordinaryMaxScore: 1.2,
  };
}
