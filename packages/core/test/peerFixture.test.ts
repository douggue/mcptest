import { PEER_MIN_TITLE_MATCH } from '../src/map/peers';
import { describe, expect, test } from 'vitest';
import { buildMapView, type MapMemberData, type MapRow } from '../src/map/view';
import fixture from './fixtures/peer-map.json';
import { LOOK_ALIKES, LOUD_OUTSIDERS, OTHER_NICHES } from './peerMaps';

/**
 * Forty channels from one real map, measured against the model channel the
 * owner named. The groups below were sorted by reading the titles, before the
 * scoring was changed. Nine channels are in the fixture but in no group: those
 * at the threshold (How It Occurs, Arran Rice, Mukunda Nl), those a reviewer
 * called look-alikes though their titles are not (CyberPulse, Borehole Atlas,
 * Entropy Files), a Russian-language copy of the format, and the three that
 * fail on shape.
 */

const NOW = new Date(fixture.now);
const DAY_MS = 86_400_000;

type FixtureChannel = (typeof fixture.channels)[number] | typeof fixture.centre;

const toMember = (channel: FixtureChannel): MapMemberData => ({
  channel: {
    id: channel.id,
    title: channel.title,
    handle: null,
    subscribers: channel.subscribers,
    subscribersHidden: channel.subscribers === null,
    videoCount: null,
    fetchedAt: NOW,
  },
  steps: channel.steps,
  videos: channel.videos.map((video, index) => ({
    id: `${channel.id}-${index}`,
    channelId: channel.id,
    title: video.title,
    views: 0,
    durationSeconds: video.durationSeconds,
    published: {
      date: new Date(NOW.getTime() - video.daysAgo * DAY_MS),
      precision: 'day',
      raw: `${video.daysAgo}d ago`,
    },
    fetchedAt: NOW,
  })),
});

const rows = buildMapView({
  center: toMember(fixture.centre),
  members: fixture.channels.map(toMember),
  edges: [],
  now: NOW,
  modelId: fixture.modelId,
});

const row = (title: string): MapRow => {
  const found = rows.find((candidate) => candidate.channel.title === title);
  if (!found) throw new Error(`${title} is not in the fixture`);
  return found;
};

/** Each channel's outcome by name, so a failure names the channels that moved. */
const peerStatus = (titles: readonly string[]) =>
  Object.fromEntries(titles.map((title) => [title, row(title).outsideReason ?? 'peer']));

const allWith = (titles: readonly string[], status: string) =>
  Object.fromEntries(titles.map((title) => [title, status]));

describe('peers on a real map measured against a model channel', () => {
  test('keeps every channel that makes the model’s kind of video', () => {
    expect(peerStatus(LOOK_ALIKES)).toEqual(allWith(LOOK_ALIKES, 'peer'));
  });

  test('leaves out channels that share only subjects or stock phrases with the model', () => {
    // Some of these are also too large to be peers. What matters here is that
    // their titles alone would reject them, whatever the size rule says.
    const passingOnTitles = LOUD_OUTSIDERS.filter(
      (title) => row(title).relevance >= PEER_MIN_TITLE_MATCH,
    );

    expect(passingOnTitles).toEqual([]);
    expect(LOUD_OUTSIDERS.filter((title) => row(title).peer)).toEqual([]);
  });

  test('leaves out channels from other niches', () => {
    const stillPeers = OTHER_NICHES.filter((title) => row(title).peer);

    expect(stillPeers).toEqual([]);
  });

  test('scores every look-alike above every outsider', () => {
    const lowestLookAlike = Math.min(...LOOK_ALIKES.map((title) => row(title).relevance));
    const highestOutsider = Math.max(
      ...[...LOUD_OUTSIDERS, ...OTHER_NICHES].map((title) => row(title).relevance),
    );

    expect(lowestLookAlike).toBeGreaterThan(highestOutsider);
  });

  test('still reports a shape problem before the titles are judged', () => {
    expect(peerStatus(['Veritasium', 'Simon Uncovered', 'Robot Uncut'])).toEqual({
      Veritasium: 'larger',
      'Simon Uncovered': 'cadence',
      'Robot Uncut': 'length',
    });
  });

  test('says a channel that stopped uploading is dormant, whatever its titles', () => {
    // TECH WAVE's newest upload in the fixture is 180 days old. No other channel's is past 45.
    const dormant = rows.filter((candidate) => candidate.outsideReason === 'dormant');

    expect(dormant.map((candidate) => candidate.channel.title)).toEqual(['TECH WAVE']);
  });

  // Titles alone do not settle these two; see "Peers" in docs/SYSTEM_DESIGN.md.
  test.todo(
    'tells How It Occurs (a look-alike with seven videos) from Arran Rice (airline analysis)',
  );
});
