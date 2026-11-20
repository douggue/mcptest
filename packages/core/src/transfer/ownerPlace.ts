import { findPlaces, placeForCountry, type Place } from './places';
import type { OwnerPlace } from './types';

/**
 * Works out which place the owner makes videos for, from the channels their
 * maps are centred on. Nothing here names a place: it is read from the titles
 * or, failing that, from the channel's country, and it can always be passed
 * in instead.
 */

/**
 * A channel is "about" a place when at least this share of its titles name
 * that place first. Half is a majority: under it the place is one subject
 * among several (a travel channel, a cook who once filmed abroad) and the
 * channel's own country says more.
 */
export const OWNER_PLACE_MIN_TITLE_SHARE = 0.5;

/** What is read of a centre channel: its stored titles and its country, when the store has it. */
export interface CentreChannel {
  readonly titles: readonly string[];
  readonly country: string | null;
}

/** The place most of a channel's titles name first, when one has the majority. */
function placeInTitles(titles: readonly string[]): Place | null {
  const counts = new Map<string, { readonly place: Place; readonly count: number }>();
  for (const title of titles) {
    const place = findPlaces(title)[0]?.place;
    if (!place) continue;
    counts.set(place.key, { place, count: (counts.get(place.key)?.count ?? 0) + 1 });
  }
  const leader = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.place.name.localeCompare(b.place.name),
  )[0];
  const share = leader && titles.length > 0 ? leader.count / titles.length : 0;
  return leader && share >= OWNER_PLACE_MIN_TITLE_SHARE ? leader.place : null;
}

/**
 * The place one channel makes its videos for: the place most of its titles
 * are about, else its own country, else null.
 */
export function placeOfChannel(channel: CentreChannel): OwnerPlace | null {
  const named = placeInTitles(channel.titles);
  if (named) return { ...named, source: 'titles' };
  const home = placeForCountry(channel.country);
  return home ? { ...home, source: 'country' } : null;
}

/**
 * The owner's place from their centre channels: the place most of them share.
 * When they disagree evenly the earliest in the list wins, so the caller puts
 * the centre of the most recent map first.
 */
export function inferOwnerPlace(centres: readonly CentreChannel[]): OwnerPlace | null {
  const places = centres.flatMap((centre) => placeOfChannel(centre) ?? []);
  const votes = new Map<string, number>();
  for (const place of places) votes.set(place.key, (votes.get(place.key) ?? 0) + 1);
  const most = Math.max(0, ...votes.values());
  return places.find((place) => votes.get(place.key) === most) ?? null;
}
