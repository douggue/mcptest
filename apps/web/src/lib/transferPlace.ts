import type {
  CountryOutcome,
  OwnerPlace,
  Place,
  PlaceCheck,
  TransferList,
  TransferVersion,
} from '@jgtube/core';
import { listPlaces } from '@jgtube/core/src/transfer/places';
import { apiCaller, type Fetch } from './api';

/**
 * Which place a channel's transfer ideas are judged for, and where that came
 * from: the owner's own choice, the channel's titles, or its country on
 * YouTube. Each source is said on its own, so the owner can see when they
 * disagree and set the place themselves.
 */

/** The transfer list as the server sends it: with whether countries can be read at all. */
export interface TransferReply extends TransferList {
  /** Whether a YouTube API key is set, which reading a channel's country needs. */
  readonly canReadCountries: boolean;
}

const SOURCE_WORDS: Readonly<Record<OwnerPlace['source'], string>> = {
  owner: ': your own choice for this channel.',
  titles: ': most of this channel’s titles name it.',
  country: ': this channel’s country on YouTube.',
  given: '.',
};

/** The place the ideas are judged for, and where it came from. */
export function describePlaceInUse(place: OwnerPlace | null): string {
  if (place === null) {
    return 'Jgtube cannot tell which place this channel is for. Choose one, and the ideas are judged for it.';
  }
  return `Judged for ${place.name}${SOURCE_WORDS[place.source]}`;
}

/** What is known of the channel's own country, and why not when it is not. */
export function describeCountry(check: PlaceCheck, canReadCountries: boolean): string {
  if (check.fromCountry) return `Channel’s country on YouTube: ${check.fromCountry.name}.`;
  if (check.countryCode) {
    return `Channel’s country on YouTube: ${check.countryCode}, which is not on Jgtube’s list of places.`;
  }
  if (check.countryAsked) return 'YouTube lists no country for this channel.';
  return canReadCountries
    ? 'Channel’s country: not read yet.'
    : 'Channel’s country: not known. It comes from the official YouTube API, which needs a YouTube API key. Add one in Settings.';
}

/** The warning when the titles' place and the channel's country differ; null when they do not. */
export function describeDisagreement(check: PlaceCheck): string | null {
  if (!check.disagree || !check.fromTitles || !check.fromCountry) return null;
  return `The titles are about ${check.fromTitles.name}, but the channel is in ${check.fromCountry.name}. Check which one your videos are for.`;
}

export interface VersionCountry {
  readonly text: string;
  /** The version's channel is in another country than the place its title names. */
  readonly elsewhere: boolean;
}

/** A version's channel country, as the card shows it beside the place the title names. */
export function versionCountry(
  version: Pick<TransferVersion, 'channelCountry' | 'elsewhere'>,
): VersionCountry {
  return version.channelCountry
    ? { text: `channel in ${version.channelCountry.name}`, elsewhere: version.elsewhere }
    : { text: 'channel country unknown', elsewhere: false };
}

/** The choice that removes the owner's own: its key is empty. */
const NO_CHOICE: Place = { key: '', name: 'Let Jgtube work it out' };

/** What the owner chooses their place from: no choice first, then every place by name. */
export function placeChoices(): readonly Place[] {
  return [NO_CHOICE, ...listPlaces()];
}

/**
 * Whether to ask for the missing countries now: some are missing, a key is
 * set, and this list has not already been asked for (so a channel YouTube
 * does not answer for is not asked about in a loop).
 */
export function shouldReadCountries(
  list: Pick<TransferReply, 'countriesMissing' | 'canReadCountries'>,
  alreadyTried: boolean,
): boolean {
  return list.countriesMissing > 0 && list.canReadCountries && !alreadyTried;
}

/** What reading the countries did, in a sentence; null when there was nothing to read. */
export function describeCountryRead(outcome: CountryOutcome): string | null {
  if (outcome.problem !== null) return `The countries could not be read: ${outcome.problem}`;
  if (outcome.asked === 0) return null;
  return `Read the country of ${outcome.added} of ${outcome.asked} channels from YouTube.`;
}

export function createTransferPlaceApi(fetcher?: Fetch) {
  const { unwrap, send } = apiCaller(fetcher);
  return {
    /** Stores the place the owner chose for a channel; null goes back to what Jgtube works out. */
    async setPlace(channelId: string, placeKey: string | null): Promise<void> {
      unwrap<unknown>(await send('/api/transfers/place', { channel: channelId, place: placeKey }));
    },
    /** Reads the countries the channel's list lacks, from the official API. */
    async readCountries(channelId: string): Promise<CountryOutcome> {
      return unwrap<CountryOutcome>(await send('/api/transfers/countries', { channel: channelId }));
    },
  };
}

export type TransferPlaceApi = ReturnType<typeof createTransferPlaceApi>;
