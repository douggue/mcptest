/**
 * Made-up channels and videos as the API reader hands them on, for tests of
 * the store and the cycles. The subjects are unrelated to each other on
 * purpose (paper craft, baking, astronomy, bicycle repair) and the channels
 * sit in different countries, so nothing here leans towards one niche.
 */
import type { ChannelFacts, VideoFacts } from '../../src/youtube/dataApi';
import { channelId, uploadsId, videoId } from './apiReplies';

/** Noon in Los Angeles on 20 November 2026: the moment most tests call "now". */
export const NOW = new Date('2026-11-20T20:00:00Z');
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A moment so long before (negative) or after `NOW`. */
export const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

const TITLES = [
  'Folding a paper crane in 40 seconds',
  'Three-ingredient flatbread and a hot pan',
  'Why the moon looks bigger at the horizon',
  'Fixing a slipping bicycle chain',
] as const;

const COUNTRIES = ['US', 'GB', 'CA', 'AU'] as const;

export function videoFacts(
  n: number,
  letter: string,
  overrides: Partial<VideoFacts> = {},
): VideoFacts {
  return {
    id: videoId(n),
    channelId: channelId(letter),
    title: TITLES[n % TITLES.length] ?? TITLES[0],
    publishedAt: at(-2 * HOUR_MS),
    durationSeconds: 42,
    categoryId: '26',
    defaultLanguage: 'en',
    defaultAudioLanguage: 'en',
    views: 1000 * n,
    ...overrides,
  };
}

export function channelFacts(letter: string, overrides: Partial<ChannelFacts> = {}): ChannelFacts {
  return {
    id: channelId(letter),
    title: `Channel ${letter}`,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    country: COUNTRIES[letter.charCodeAt(0) % COUNTRIES.length] ?? null,
    totalViews: 123_456,
    videoCount: 12,
    subscribers: 890,
    subscribersHidden: false,
    uploadsPlaylistId: uploadsId(letter),
    ...overrides,
  };
}
