import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { readAssignedObject } from '../src/money/embeddedJson';
import { readWatchSigns } from '../src/money/watchSigns';

/**
 * The two fixtures are real watch pages read signed out in November 2026,
 * trimmed to the parts the reader looks at. YouTube asked to sign in before
 * playing either (`LOGIN_REQUIRED`), as it does for a data-centre address, so
 * neither carries the player's ad fields.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const MEMBERS = fixture('watch-members.html');
const NO_MEMBERS = fixture('watch-no-members.html');
const LTT = 'UCXuqSBlHAE6Xw-yeJA0Tunw';
const B3 = 'UCYO_jab_esuFRV4b17AJtAw';

/**
 * A playable page, built by hand in the shape YouTube documents for its
 * player answer: no playable page could be read from this container.
 */
const playable = (player: Record<string, unknown>, owner = LTT): string =>
  `<script>var ytInitialPlayerResponse = ${JSON.stringify({
    playabilityStatus: { status: 'OK' },
    videoDetails: { channelId: owner },
    ...player,
  })};</script><script>var ytInitialData = {};</script>`;

describe('readAssignedObject', () => {
  test('reads an object that ends before more script on the same line', () => {
    const html = '<script>var a = {"x":"};{","y":[1,{"z":"\\"}"}]};var b = 2;</script>';
    expect(readAssignedObject(html, 'a')).toEqual({ x: '};{', y: [1, { z: '"}' }] });
  });

  test('is null when the name is missing, unclosed or not JSON', () => {
    expect(readAssignedObject('<p>nothing</p>', 'a')).toBeNull();
    expect(readAssignedObject('var a = {"x":1', 'a')).toBeNull();
    expect(readAssignedObject('var a = {x:1};', 'a')).toBeNull();
    expect(readAssignedObject('var a = [1];', 'a')).toBeNull();
  });

  test('stops at a bound instead of walking a huge object', () => {
    const huge = `var a = {"x":"${'y'.repeat(50)}"};`;
    expect(readAssignedObject(huge, 'a', 20)).toBeNull();
  });
});

describe('readWatchSigns on real pages', () => {
  test('finds the Join offer on a channel that sells memberships', () => {
    expect(readWatchSigns(MEMBERS)).toEqual({ ownerId: LTT, memberships: true, ads: 'unknown' });
  });

  test('finds no Join offer on a channel without memberships', () => {
    expect(readWatchSigns(NO_MEMBERS)).toEqual({ ownerId: B3, memberships: false, ads: 'unknown' });
  });
});

describe('readWatchSigns on a playable page', () => {
  test('ads are shown when the player lists ad placements', () => {
    const html = playable({ adPlacements: [{ adPlacementRenderer: {} }] });
    expect(readWatchSigns(html)).toEqual({ ownerId: LTT, memberships: false, ads: 'shown' });
  });

  test('ads are shown when the player lists player ads', () => {
    expect(readWatchSigns(playable({ playerAds: [{}] })).ads).toBe('shown');
  });

  test('no ads when a playable page lists none', () => {
    expect(readWatchSigns(playable({ adPlacements: [] })).ads).toBe('none');
  });

  test('a sponsor button in the owner box counts as memberships too', () => {
    const html = `<script>var ytInitialData = ${JSON.stringify({
      owner: { videoOwnerRenderer: { navigationEndpoint: { browseEndpoint: { browseId: B3 } } } },
      sponsorButton: { buttonRenderer: { text: 'Join' } },
    })};</script>`;
    expect(readWatchSigns(html)).toEqual({ ownerId: B3, memberships: true, ads: 'unknown' });
  });
});

describe('readWatchSigns on pages it cannot read', () => {
  test('a page without the embedded data says nothing', () => {
    expect(readWatchSigns('<html>Before you continue to YouTube</html>')).toEqual({
      ownerId: null,
      memberships: false,
      ads: 'unknown',
    });
  });

  test('an owner id that is not a channel id is dropped', () => {
    const html = `<script>var ytInitialData = ${JSON.stringify({
      videoOwnerRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'nope' } } },
    })};</script>`;
    expect(readWatchSigns(html).ownerId).toBeNull();
  });
});
