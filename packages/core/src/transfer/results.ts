import type { Place } from './places';
import type { PlaceResult } from './types';

/** One video's result for the place it was made for. */
export interface PlacedViews {
  readonly place: Place;
  readonly views: number;
}

/** How many videos each place has and the best of them, best result first. */
export function placeResults(videos: readonly PlacedViews[]): readonly PlaceResult[] {
  const byKey = new Map<string, PlaceResult>();
  for (const { place, views } of videos) {
    const known = byKey.get(place.key);
    byKey.set(place.key, {
      key: place.key,
      name: place.name,
      versions: (known?.versions ?? 0) + 1,
      bestViews: Math.max(known?.bestViews ?? 0, views),
    });
  }
  return [...byKey.values()].sort(
    (a, b) => b.bestViews - a.bestViews || a.name.localeCompare(b.name),
  );
}
