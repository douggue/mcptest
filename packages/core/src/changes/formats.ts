import { indexBySubject, type SubjectEntry } from '../transfer/formats';
import { groupIdeas } from '../transfer/ideas';
import type { RecentVideo } from '../transfer/types';

/**
 * Title formats among a set of breakout videos: the same words around a
 * subject that changes, found the way the transfer list finds them (each
 * title filed under every way of blanking one or two words). Nothing here
 * knows a niche: it compares the titles it is given with each other.
 */

/**
 * A wording counts once this many breakouts with different subjects share it.
 * Two is the fewest that is more than one title; the number is always shown,
 * so a pair is read as a pair.
 */
export const CHANGES_FORMAT_MIN_BREAKOUTS = 2;

/** A breakout as far as its title format goes. */
export interface TitledBreakout {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly views: number;
}

export interface BreakoutFormat {
  /** The shared words with `{subject}` where the titles differ; what the format is known by. */
  readonly template: string;
  readonly videos: readonly TitledBreakout[];
}

const asRecent = (video: TitledBreakout): RecentVideo => ({
  id: video.videoId,
  channelId: video.channelId,
  title: video.title,
  views: video.views,
  durationSeconds: null,
  publishedAt: new Date(0),
  channelTitle: video.channelTitle,
  subscribers: null,
  country: null,
});

const videoIdsOf = (entries: readonly SubjectEntry[]): readonly string[] =>
  [
    ...new Set(entries.flatMap((entry) => entry.idea.videos.map((titled) => titled.video.id))),
  ].sort();

const subjectsOf = (entries: readonly SubjectEntry[]): number =>
  new Set(entries.map((entry) => entry.subject)).size;

/**
 * The wordings several of these breakouts share, the one with the most videos
 * first. Titles that differ in one word match under several blankings (that
 * word alone, and it with a neighbour); the form that keeps the most words is
 * the one listed.
 */
export function breakoutFormats(videos: readonly TitledBreakout[]): readonly BreakoutFormat[] {
  const byId = new Map(videos.map((video) => [video.videoId, video]));
  const index = indexBySubject(groupIdeas(videos.map(asRecent)));
  const best = new Map<string, { readonly template: string; readonly ids: readonly string[] }>();
  for (const [template, entries] of index) {
    if (subjectsOf(entries) < CHANGES_FORMAT_MIN_BREAKOUTS) continue;
    const ids = videoIdsOf(entries);
    const group = ids.join(' ');
    const known = best.get(group);
    const longer = !known || template.length > known.template.length;
    if (longer || (template.length === known.template.length && template < known.template)) {
      best.set(group, { template, ids });
    }
  }
  return [...best.values()]
    .map(({ template, ids }) => ({
      template,
      videos: ids.flatMap((id) => byId.get(id) ?? []),
    }))
    .sort((a, b) => b.videos.length - a.videos.length || (a.template < b.template ? -1 : 1));
}
