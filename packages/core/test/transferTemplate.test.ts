import { describe, expect, test } from 'vitest';
import { findPlaces, placeForCountry, placeNamed } from '../src/transfer/places';
import { PLACE_SLOT, NUMBER_SLOT, titleTemplate } from '../src/transfer/template';

const placesIn = (title: string): readonly string[] =>
  findPlaces(title).map((found) => found.place.name);

describe('findPlaces', () => {
  test.each([
    ['South Africa Just Found A Fuel That Shouldn’t Exist', ['South Africa']],
    ['Australian Man’s New Road Method', ['Australia']],
    ['Germany’s New Engine', ['Germany']],
    ["Germany's New Engine", ['Germany']],
    ['UK Just Found An Engine', ['UK']],
    ['Britain Built A Battery', ['UK']],
    ['The British Are Coming', ['UK']],
    ['Why Americans Stopped Baking Bread', ['America']],
    ['I Tried Every Street Food In Japan', ['Japan']],
    ['The Caribbean Just Discovered A Fuel', ['Caribbean']],
    ['Texas Built A Wall', ['Texas']],
    ['Trinidad and Tobago Strikes Oil', ['Trinidad and Tobago']],
  ])('finds the place in %s', (title, expected) => {
    expect(placesIn(title)).toEqual(expected);
  });

  test('gives one key to every way of writing a place', () => {
    const keys = ['America', 'American', "America's", 'USA', 'United States', 'U.S.'].map(
      (word) => findPlaces(`${word} Builds A Bridge`)[0]?.place.key,
    );

    expect(keys).toEqual(new Array(keys.length).fill('US'));
  });

  test('finds every place in a title, in the order written', () => {
    expect(placesIn('America Just Built a Battery That Runs on Salt — China Is Shocked!')).toEqual([
      'America',
      'China',
    ]);
  });

  test('takes the longest name where one is inside another', () => {
    expect(placesIn('Papua New Guinea Opens A Mine')).toEqual(['Papua New Guinea']);
    expect(placesIn('Nigeria And Niger Agree')).toEqual(['Nigeria', 'Niger']);
    expect(placesIn('South Korea Launches')).toEqual(['South Korea']);
  });

  test('does not find a place inside a longer word', () => {
    expect(placesIn('Indiana Jones And The Chinatown Job')).toEqual([]);
  });

  test('reads a small-letter word as an ordinary word, not a place', () => {
    expect(placesIn('How to roast a turkey on fine china')).toEqual([]);
    expect(placesIn('How Turkey Roasts Coffee')).toEqual(['Turkey']);
  });

  test('reads US as the country only in capitals, and not in a title that shouts', () => {
    expect(placesIn('The US Just Built A Reactor')).toEqual(['America']);
    expect(placesIn('They Told Us To Leave')).toEqual([]);
    // Every word is in capitals, so capitals cannot tell the country from the pronoun.
    expect(placesIn('TRUMP JUST SOLD US OUT')).toEqual([]);
  });

  test('says where in the title each place was written', () => {
    const [found] = findPlaces('Why Germany’s Trains Run Late');

    expect(found).toMatchObject({ start: 4, end: 13 });
  });

  test('finds nothing in a title in another alphabet or with no place', () => {
    expect(placesIn('Почему исчезли паровозы')).toEqual([]);
    expect(placesIn('I Ate Only Gas Station Food For A Week')).toEqual([]);
  });
});

describe('placeForCountry and placeNamed', () => {
  test('turns a two-letter country into its place, in either case', () => {
    expect(placeForCountry('ZA')).toEqual({ key: 'ZA', name: 'South Africa' });
    expect(placeForCountry('us')).toEqual({ key: 'US', name: 'America' });
  });

  test('is null for no country or one it does not know', () => {
    expect(placeForCountry(null)).toBeNull();
    expect(placeForCountry('ZZ')).toBeNull();
  });

  test('finds a place by any of its names or its code', () => {
    expect(placeNamed('britain')?.key).toBe('GB');
    expect(placeNamed(' South African ')?.key).toBe('ZA');
    expect(placeNamed('JP')?.name).toBe('Japan');
    expect(placeNamed('Caribbean')?.key).toBe('region:caribbean');
    expect(placeNamed('Atlantis')).toBeNull();
    expect(placeNamed('')).toBeNull();
  });
});

describe('titleTemplate', () => {
  test('puts a slot where the place was and keeps the rest in lower case', () => {
    const template = titleTemplate('South Africa Just Found A Fuel That Shouldn’t Exist');

    expect(template.text).toBe(`${PLACE_SLOT} just found a fuel that shouldn't exist`);
    expect(template.places.map((place) => place.name)).toEqual(['South Africa']);
    expect(template.words).toEqual([PLACE_SLOT, 'just', 'found', 'fuel', 'shouldn', 'exist']);
  });

  test('gives country-swapped copies of a title the same words', () => {
    const versions = [
      'South Africa Just Found A Fuel That Shouldn’t Exist',
      "Australia Just Found A Fuel That Shouldn't Exist",
      'UK JUST FOUND a fuel that shouldn’t exist!!',
    ].map((title) => titleTemplate(title).words.join(' '));

    expect(new Set(versions).size).toBe(1);
  });

  test('treats a possessive and an adjective as the same slot', () => {
    expect(titleTemplate('Germany’s New Engine Is Here').words).toEqual(
      titleTemplate('German New Engine Is Here').words,
    );
  });

  test('puts a slot where a number or a sum of money was', () => {
    expect(titleTemplate('25 Tricks That Make $3,000 Stoves Look Silly').text).toBe(
      `${NUMBER_SLOT} tricks that make ${NUMBER_SLOT} stoves look silly`,
    );
    expect(titleTemplate('The 6th Fighter Cost $1.2 Billion in 2026').text).toBe(
      `the ${NUMBER_SLOT} fighter cost ${NUMBER_SLOT} in ${NUMBER_SLOT}`,
    );
    expect(titleTemplate('A 250-Seat Plane Flew 3.5 Hours at 90%').words).toEqual([
      NUMBER_SLOT,
      'seat',
      'plane',
      'flew',
      NUMBER_SLOT,
      'hours',
      NUMBER_SLOT,
    ]);
  });

  test('keeps each slot in the words, in order', () => {
    expect(titleTemplate('America’s 5 Year Old Startup Beats China').words).toEqual([
      PLACE_SLOT,
      NUMBER_SLOT,
      'year',
      'old',
      'startup',
      'beats',
      PLACE_SLOT,
    ]);
  });

  test('drops emoji and repeated spaces from the text', () => {
    expect(titleTemplate('🚨  Japan   Opens 🚀 A Mine').text).toBe(`${PLACE_SLOT} opens a mine`);
  });

  test('leaves a title with no place or number as its own lower-case words', () => {
    const template = titleTemplate('I Ate Only Gas Station Food For A Week');

    expect(template.text).toBe('i ate only gas station food for a week');
    expect(template.places).toEqual([]);
    expect(template.words).toEqual(['ate', 'only', 'gas', 'station', 'food', 'week']);
  });

  test('has no words for a title with nothing to read', () => {
    expect(titleTemplate('!!! 🚀').words).toEqual([]);
  });
});
