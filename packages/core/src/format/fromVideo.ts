/**
 * Ingredients that are one video or one channel: a breakout kept as a raw
 * source, a thumbnail's layout, one of the owner's own videos, a niche
 * channel, a pasted link. One video is never proven: its evidence counts one.
 */
import type { NicheChannel } from '../niches/types';
import { MEDIA_EXAMPLES, shortName } from './fromLab';
import type { IngredientDraft, IngredientLayer, MeasuredNumber } from './types';

/** A stored video with its numbers as the store gives them. */
export interface FormatVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly views: number;
  readonly durationSeconds: number | null;
  /** Multiple of its channel's usual views at its age; null when it cannot be judged. */
  readonly score: number | null;
}

/** Which button put the video on the shelf. */
export type VideoUse = 'video' | 'own-video' | 'thumbnail' | 'link';

const LABELS: Readonly<Record<VideoUse, string>> = {
  video: 'Breaking out',
  'own-video': 'Your video',
  thumbnail: 'Thumbnail',
  link: 'Your link',
};

function videoNumbers(video: FormatVideo): readonly MeasuredNumber[] {
  const views = { label: 'Views', value: video.views, unit: 'views', method: 'stored views' };
  if (video.durationSeconds === null) return [views];
  return [
    views,
    { label: 'Length', value: video.durationSeconds, unit: 'seconds', method: 'stored length' },
  ];
}

export function ingredientFromVideo(
  video: FormatVideo,
  use: VideoUse,
  centerChannelId: string | null,
): IngredientDraft {
  const layer: IngredientLayer = use === 'thumbnail' ? 'thumbnail' : 'other';
  return {
    layer,
    name: shortName(use === 'thumbnail' ? `Thumbnail of “${video.title}”` : video.title),
    source: use === 'link' ? 'link' : use === 'thumbnail' ? 'thumbnail' : use,
    sourceKey: video.videoId,
    sourceLabel: `${LABELS[use]} · ${video.channelTitle}`,
    centerChannelId,
    channelIds: [video.channelId],
    details: { videoId: video.videoId, title: video.title, channelTitle: video.channelTitle },
    evidence: {
      score: video.score,
      scoredVideos: video.score === null ? 0 : 1,
      videos: 1,
      channels: 1,
      measured: videoNumbers(video),
    },
    media: [{ kind: 'thumbnail', videoId: video.videoId }],
  };
}

/** A link to a video that is not in the store: kept as a raw source with nothing counted. */
export function ingredientFromUnreadLink(videoId: string): IngredientDraft {
  return {
    layer: 'other',
    name: `Video ${videoId}`,
    source: 'link',
    sourceKey: videoId,
    sourceLabel: 'Your link (not read yet)',
    centerChannelId: null,
    channelIds: [],
    details: { videoId },
    evidence: { score: null, scoredVideos: 0, videos: null, channels: null, measured: [] },
    media: [{ kind: 'thumbnail', videoId }],
  };
}

export function ingredientFromNiche(channel: NicheChannel): IngredientDraft {
  return {
    layer: 'other',
    name: shortName(channel.title),
    source: 'niche',
    sourceKey: channel.id,
    sourceLabel: `New niche · ${channel.topic.label}`,
    centerChannelId: null,
    channelIds: [channel.id],
    details: {
      channelId: channel.id,
      title: channel.title,
      topic: channel.topic.label,
      sampleTitles: channel.sampleTitles.slice(0, MEDIA_EXAMPLES).map((sample) => sample.title),
    },
    evidence: {
      score: null,
      scoredVideos: 0,
      videos: channel.hitCount,
      channels: 1,
      measured: [
        {
          label: 'Views on uploads of the last 90 days',
          value: channel.ninetyDayViews,
          unit: 'views',
          method: 'stored views',
        },
        {
          label: 'Strong outliers of its scored videos',
          value: channel.hitCount,
          unit: `of ${channel.scoredCount}`,
          method: 'counted',
        },
      ],
    },
    media: channel.outperformers
      .slice(0, MEDIA_EXAMPLES)
      .map((video) => ({ kind: 'thumbnail', videoId: video.videoId })),
  };
}
