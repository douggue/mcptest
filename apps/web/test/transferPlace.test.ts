import type { PlaceCheck, TransferVersion } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  createTransferPlaceApi,
  describeCountry,
  describeCountryRead,
  describeDisagreement,
  describePlaceInUse,
  placeChoices,
  shouldReadCountries,
  versionCountry,
} from '../src/lib/transferPlace';

const KENYA = { key: 'KE', name: 'Kenya' };
const UK = { key: 'GB', name: 'UK' };

const check = (overrides: Partial<PlaceCheck> = {}): PlaceCheck => ({
  channelId: 'UCcccccccccccccccccccccc',
  chosen: null,
  fromTitles: null,
  fromCountry: null,
  countryCode: null,
  countryAsked: false,
  disagree: false,
  ...overrides,
});

const reply = (status: number, data: unknown, error: string | null = null) =>
  new Response(JSON.stringify({ success: status < 400, data, error, meta: null }), { status });

describe('describePlaceInUse', () => {
  test.each([
    ['owner', 'Judged for Kenya: your own choice for this channel.'],
    ['titles', 'Judged for Kenya: most of this channel’s titles name it.'],
    ['country', 'Judged for Kenya: this channel’s country on YouTube.'],
    ['given', 'Judged for Kenya.'],
  ] as const)('says where a place taken from %s came from', (source, words) => {
    expect(describePlaceInUse({ ...KENYA, source })).toBe(words);
  });

  test('says so when no place could be told', () => {
    expect(describePlaceInUse(null)).toBe(
      'Jgtube cannot tell which place this channel is for. Choose one, and the ideas are judged for it.',
    );
  });
});

describe('describeCountry', () => {
  test('names the country when YouTube gave one', () => {
    expect(
      describeCountry(check({ fromCountry: KENYA, countryCode: 'KE', countryAsked: true }), true),
    ).toBe('Channel’s country on YouTube: Kenya.');
  });

  test('gives the code of a country Jgtube has no place for', () => {
    expect(describeCountry(check({ countryCode: 'XK', countryAsked: true }), true)).toBe(
      'Channel’s country on YouTube: XK, which is not on Jgtube’s list of places.',
    );
  });

  test('says when YouTube lists none', () => {
    expect(describeCountry(check({ countryAsked: true }), true)).toBe(
      'YouTube lists no country for this channel.',
    );
  });

  test('says plainly when there is no key, and so no country', () => {
    expect(describeCountry(check(), false)).toBe(
      'Channel’s country: not known. It comes from the official YouTube API, which needs a YouTube API key. Add one in Settings.',
    );
  });

  test('says when it has simply not been read yet', () => {
    expect(describeCountry(check(), true)).toBe('Channel’s country: not read yet.');
  });
});

describe('describeDisagreement', () => {
  test('flags titles about one place from a channel in another', () => {
    expect(
      describeDisagreement(check({ fromTitles: KENYA, fromCountry: UK, disagree: true })),
    ).toBe(
      'The titles are about Kenya, but the channel is in UK. Check which one your videos are for.',
    );
  });

  test('says nothing when they agree or one is unknown', () => {
    expect(describeDisagreement(check({ fromTitles: KENYA, fromCountry: KENYA }))).toBeNull();
    expect(describeDisagreement(check({ fromTitles: KENYA }))).toBeNull();
  });
});

describe('versionCountry', () => {
  const version = (overrides: Partial<TransferVersion>): TransferVersion =>
    ({ channelCountry: null, elsewhere: false, place: null, ...overrides }) as TransferVersion;

  test('marks a version made from another country than the one its title names', () => {
    expect(versionCountry(version({ channelCountry: UK, elsewhere: true }))).toEqual({
      text: 'channel in UK',
      elsewhere: true,
    });
  });

  test('shows the channel’s country when it matches, and says when it is not known', () => {
    expect(versionCountry(version({ channelCountry: KENYA }))).toEqual({
      text: 'channel in Kenya',
      elsewhere: false,
    });
    expect(versionCountry(version({}))).toEqual({
      text: 'channel country unknown',
      elsewhere: false,
    });
  });
});

describe('placeChoices', () => {
  test('lists every place by name, with the choice to let Jgtube work it out first', () => {
    const choices = placeChoices();

    expect(choices[0]).toEqual({ key: '', name: 'Let Jgtube work it out' });
    expect(choices).toContainEqual({ key: 'CA', name: 'Canada' });
    expect(choices.length).toBeGreaterThan(150);
  });
});

describe('shouldReadCountries', () => {
  test('only when some are missing, a key is set and it was not already tried for this list', () => {
    expect(shouldReadCountries({ countriesMissing: 2, canReadCountries: true }, false)).toBe(true);
    expect(shouldReadCountries({ countriesMissing: 2, canReadCountries: false }, false)).toBe(
      false,
    );
    expect(shouldReadCountries({ countriesMissing: 0, canReadCountries: true }, false)).toBe(false);
    expect(shouldReadCountries({ countriesMissing: 2, canReadCountries: true }, true)).toBe(false);
  });
});

describe('describeCountryRead', () => {
  test('says what was read, and why not when it was not', () => {
    expect(describeCountryRead({ asked: 12, added: 9, problem: null })).toBe(
      'Read the country of 9 of 12 channels from YouTube.',
    );
    expect(describeCountryRead({ asked: 12, added: 0, problem: 'quota used up' })).toBe(
      'The countries could not be read: quota used up',
    );
    expect(describeCountryRead({ asked: 0, added: 0, problem: null })).toBeNull();
  });
});

describe('createTransferPlaceApi', () => {
  test('stores the owner’s place, clears it, and asks for the countries', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createTransferPlaceApi(async (path, init) => {
      calls.push([path, JSON.parse(String(init?.body))]);
      return path.endsWith('countries')
        ? reply(200, { asked: 1, added: 1, problem: null })
        : reply(200, {});
    });

    await api.setPlace('UCabc', 'CA');
    await api.setPlace('UCabc', null);
    const read = await api.readCountries('UCabc');

    expect(calls).toEqual([
      ['/api/transfers/place', { channel: 'UCabc', place: 'CA' }],
      ['/api/transfers/place', { channel: 'UCabc', place: null }],
      ['/api/transfers/countries', { channel: 'UCabc' }],
    ]);
    expect(read).toEqual({ asked: 1, added: 1, problem: null });
  });

  test('passes on a refusal', async () => {
    const api = createTransferPlaceApi(async () =>
      reply(400, null, 'Jgtube does not know that place.'),
    );

    await expect(api.setPlace('UCabc', 'Atlantis')).rejects.toThrow(/does not know that place/);
  });
});
