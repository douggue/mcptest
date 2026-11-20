/**
 * Made-up findings for tests of the alerts. As in `facts.ts`, the subjects
 * are unrelated to each other and searched in different countries, and no
 * figure here is a threshold: what counts as a finding is decided elsewhere.
 */
import type { FindingReason, NewFinding } from '../../src/repos/types';
import { channelId, videoId } from './apiReplies';
import { DAY_MS, HOUR_MS, at } from './facts';

const TITLES = [
  'Folding a paper crane in 40 seconds',
  'Three-ingredient flatbread and a hot pan',
  'Why the moon looks bigger at the horizon',
  'Fixing a slipping bicycle chain',
] as const;

const SUBJECTS = [
  { subjectKeyword: 'paper craft', subjectRegion: 'US', channelCountry: 'CA' },
  { subjectKeyword: 'quick baking', subjectRegion: 'GB', channelCountry: 'GB' },
  { subjectKeyword: 'astronomy facts', subjectRegion: 'AU', channelCountry: null },
  { subjectKeyword: 'bicycle repair', subjectRegion: 'CA', channelCountry: 'US' },
] as const;

export function reasonFor(n: number, overrides: Partial<FindingReason> = {}): FindingReason {
  const subject = SUBJECTS[n % SUBJECTS.length] ?? SUBJECTS[0];
  return {
    why: ['Gaining views much faster than the channel is big', 'The channel is new'],
    totalViews: 100_000 * n,
    subscribers: 890,
    channelCreatedAt: at(-90 * DAY_MS),
    ...subject,
    ...overrides,
  };
}

/** Finding `n` on channel `letter`, found `n` minutes after ten hours ago. */
export function newFinding(
  n: number,
  letter: string,
  overrides: Partial<NewFinding> = {},
): NewFinding {
  return {
    videoId: videoId(n),
    channelId: channelId(letter),
    videoTitle: TITLES[n % TITLES.length] ?? TITLES[0],
    channelTitle: `Channel ${letter}`,
    publishedAt: at(-5 * HOUR_MS),
    kind: 'niche',
    reason: reasonFor(n),
    viewsPerHour: 1000 * n,
    earningsLow: 10 * n,
    earningsHigh: 50 * n,
    foundAt: at(-10 * HOUR_MS + n * 60_000),
    ...overrides,
  };
}
