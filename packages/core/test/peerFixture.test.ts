import { describe, expect, test } from 'vitest';
import { buildMapView, type MapMemberData, type MapRow } from '../src/map/view';
import fixture from './fixtures/peer-map.json';

/**
 * Forty channels from one real map, measured against the model channel the
 * owner named. The groups below were sorted by reading the titles, before the
 * scoring was changed. Nine channels are in the fixture but in no group: those
 * at the threshold (How It Occurs, Arran Rice, Mukunda Nl), those a reviewer
 * called look-alikes though their titles are not (CyberPulse, Borehole Atlas,
 * Entropy Files), a Russian-language copy of the format, and the three that
 * fail on shape.
 */

/** Make the model's kind of video: a nation's or company's new invention, told as a breakthrough. */
const LOOK_ALIKES = [
  'Modern Frontier',
  'Jaime Heinecke',
  'Williamson',
  'States 2050',
  'Frontier States',
  'Hans Bender',
  'Marcus Bennett',
  'America Invents 2050',
  'Gael',
  'Valtrum',
  'Snap Shift',
];

/** Share subjects (aircraft, Tesla, rockets, batteries) or stock phrases with the model, not its format. */
const LOUD_OUTSIDERS = ['Mentour Now!', 'Farzad', 'JoshSullivanSpace', 'Wild Line'];

/** Every tenth channel the map had already rejected on titles; other niches altogether. */
const OTHER_NICHES = [
  'All Out Aviation',
  'Astron17',
  'Beyond Sky',
  'C Spinner Watch Restorations',
  'GOLOVOLOM TV',
  'GREAT SPACE',
  'Jake Broe',
  'KRAFTY',
  'Part That Changed American History',
  'TECH HUB',
  'TECH WAVE',
  'TerraDecoded',
  'Uncharted Mysteries',
  'Vanished Gears & Dials',
  'World Travel Doc',
];

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
    expect(peerStatus(LOUD_OUTSIDERS)).toEqual(allWith(LOUD_OUTSIDERS, 'titles'));
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

  // Titles alone do not settle these two; see "Peers" in docs/SYSTEM_DESIGN.md.
  test.todo(
    'tells How It Occurs (a look-alike with seven videos) from Arran Rice (airline analysis)',
  );
});
