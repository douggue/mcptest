import { describe, expect, test } from 'vitest';
import {
  NICHE_MIN_OUTLIER_SCORE,
  NICHE_MIN_VIDEO_VIEWS,
  NICHE_MIN_VIEWS_PER_SUBSCRIBER,
} from '../src/niches/outperform';
import { TRANSFER_WEAK_MAX_SHARE, isStrong, judge } from '../src/transfer/opportunity';
import {
  OWNER_PLACE_MIN_TITLE_SHARE,
  inferOwnerPlace,
  placeOfChannel,
} from '../src/transfer/ownerPlace';
import type { Place } from '../src/transfer/places';
import type { TransferVersion } from '../src/transfer/types';

const AMERICA: Place = { key: 'US', name: 'America' };
const SOUTH_AFRICA: Place = { key: 'ZA', name: 'South Africa' };
const AUSTRALIA: Place = { key: 'AU', name: 'Australia' };

let counter = 0;
const version = (
  place: Place | null,
  views: number,
  strong: boolean,
  source: 'title' | 'channel' = 'title',
): TransferVersion => {
  counter += 1;
  return {
    videoId: `v${String(counter).padStart(10, '0')}`,
    title: 'A title',
    channelId: `UC${String(counter).padStart(22, '0')}`,
    channelTitle: `Channel ${counter}`,
    subscribers: 5000,
    place: place ? { ...place, source } : null,
    views,
    score: strong ? 20 : 1,
    ageDays: 10,
    durationSeconds: 600,
    strong,
  };
};

describe('isStrong', () => {
  test('takes a widely seen video far above its channel’s usual views or its size', () => {
    expect(isStrong(NICHE_MIN_VIDEO_VIEWS, NICHE_MIN_OUTLIER_SCORE, null)).toBe(true);
    expect(isStrong(50_000, null, 50_000 / NICHE_MIN_VIEWS_PER_SUBSCRIBER)).toBe(true);
  });

  test('refuses a video seen by few people, or one that is ordinary for its channel', () => {
    expect(isStrong(NICHE_MIN_VIDEO_VIEWS - 1, 900, 10)).toBe(false);
    expect(isStrong(700_000, NICHE_MIN_OUTLIER_SCORE - 0.1, 95_000)).toBe(false);
    expect(isStrong(700_000, null, null)).toBe(false);
  });
});

describe('judge', () => {
  test('is open when a version took off elsewhere and none was made for the owner’s place', () => {
    const winner = version(SOUTH_AFRICA, 521_000, true);

    expect(judge([winner, version(AUSTRALIA, 385_000, false)], AMERICA)).toEqual({
      status: 'open',
      winner,
      own: null,
    });
  });

  test('is weak when the owner’s place has a version that did far worse than the best elsewhere', () => {
    const winner = version(SOUTH_AFRICA, 521_000, true);
    const own = version(AMERICA, 2600, false);

    expect(judge([winner, own, version(AMERICA, 900, false)], AMERICA)).toEqual({
      status: 'weak',
      winner,
      own,
    });
  });

  test('draws the line for weak at a tenth of the best elsewhere', () => {
    const winner = version(SOUTH_AFRICA, 500_000, true);
    const under = version(AMERICA, 500_000 * TRANSFER_WEAK_MAX_SHARE - 1, false);
    const at = version(AMERICA, 500_000 * TRANSFER_WEAK_MAX_SHARE, false);

    expect(TRANSFER_WEAK_MAX_SHARE).toBe(0.1);
    expect(judge([winner, under], AMERICA).status).toBe('weak');
    expect(judge([winner, at], AMERICA).status).toBe('done');
  });

  test('is done when the owner’s place already has a version that took off', () => {
    const own = version(AMERICA, 30_000, true);

    expect(judge([version(SOUTH_AFRICA, 521_000, true), own], AMERICA)).toMatchObject({
      status: 'done',
      own,
    });
    // Also when nothing took off anywhere else.
    expect(judge([version(SOUTH_AFRICA, 900, false), own], AMERICA).status).toBe('done');
  });

  test('is unproven when no version took off anywhere', () => {
    expect(
      judge([version(SOUTH_AFRICA, 449_000, false), version(AUSTRALIA, 4000, false)], AMERICA),
    ).toEqual({ status: 'unproven', winner: null, own: null });
  });

  test('names the strongest of several winners elsewhere', () => {
    const best = version(AUSTRALIA, 385_000, true);

    expect(judge([version(SOUTH_AFRICA, 40_000, true), best], AMERICA).winner).toBe(best);
  });

  test('is unplaced when the owner’s place is not known', () => {
    expect(judge([version(SOUTH_AFRICA, 521_000, true)], null).status).toBe('unplaced');
  });

  test('is unplaced when a version that may be the owner’s has no known place', () => {
    const winner = version(SOUTH_AFRICA, 521_000, true, 'channel');

    expect(judge([winner, version(null, 3000, false)], AMERICA)).toEqual({
      status: 'unplaced',
      winner,
      own: null,
    });
  });

  test('is unplaced when the only version that took off has no known place', () => {
    expect(
      judge([version(null, 521_000, true), version(SOUTH_AFRICA, 900, false)], AMERICA).status,
    ).toBe('unplaced');
  });

  test('judges by the channels’ countries exactly as by places in titles', () => {
    const winner = version(SOUTH_AFRICA, 90_000, true, 'channel');

    expect(judge([winner, version(AUSTRALIA, 800, false, 'channel')], AMERICA).status).toBe('open');
    expect(judge([winner, version(AMERICA, 800, false, 'channel')], AMERICA).status).toBe('weak');
  });
});

describe('placeOfChannel', () => {
  const titles = (place: string, count: number): string[] =>
    Array.from({ length: count }, (_, index) => `${place} Just Built Machine ${index}`);

  test('is the place most of the channel’s titles are about', () => {
    expect(
      placeOfChannel({
        titles: [...titles('America', 3), 'China Reacts To This Engine'],
        country: null,
      }),
    ).toEqual({ key: 'US', name: 'America', source: 'titles' });
  });

  test('counts the first place of a title: the one the title is about', () => {
    expect(
      placeOfChannel({
        titles: ['Kenya Shocks China', 'Kenya Outbuilds China', 'Kenya Stuns China Again'],
        country: null,
      })?.key,
    ).toBe('KE');
  });

  test('falls back to the channel’s country when no place leads its titles', () => {
    const mixed = ['Japan', 'Kenya', 'Chile', 'Peru'].flatMap((place) => titles(place, 1));

    expect(OWNER_PLACE_MIN_TITLE_SHARE).toBe(0.5);
    expect(placeOfChannel({ titles: mixed, country: 'CA' })).toEqual({
      key: 'CA',
      name: 'Canada',
      source: 'country',
    });
  });

  test('does not take one passing mention for the channel’s place', () => {
    const cooking = ['How To Fold Dumplings', 'I Ate Ramen In Japan', 'The Best Knife I Own'];

    expect(placeOfChannel({ titles: cooking, country: 'GB' })?.key).toBe('GB');
    expect(placeOfChannel({ titles: cooking, country: null })).toBeNull();
  });

  test('is null for a channel with no titles and no country', () => {
    expect(placeOfChannel({ titles: [], country: null })).toBeNull();
  });
});

describe('inferOwnerPlace', () => {
  const centre = (place: string, country: string | null = null) => ({
    titles: [`${place} Just Built A Dam`, `${place} Opens A Mine`],
    country,
  });

  test('is the place of the only centre', () => {
    expect(inferOwnerPlace([centre('America')])?.name).toBe('America');
  });

  test('is the place most centres share', () => {
    expect(inferOwnerPlace([centre('Kenya'), centre('America'), centre('America')])?.key).toBe(
      'US',
    );
  });

  test('takes the first centre’s place when the centres disagree evenly', () => {
    // The caller lists the centre of the most recent map first.
    expect(inferOwnerPlace([centre('Kenya'), centre('America')])?.key).toBe('KE');
  });

  test('skips centres whose place cannot be told', () => {
    const unknown = { titles: ['How To Fold Dumplings'], country: null };

    expect(inferOwnerPlace([unknown, centre('Chile')])?.key).toBe('CL');
    expect(inferOwnerPlace([unknown])).toBeNull();
    expect(inferOwnerPlace([])).toBeNull();
  });
});
