import { describe, expect, test } from 'vitest';
import { buildMapView, type MapMemberData, type MapRow } from '../src/map/view';
import { NICHES, type Fixture, type FixtureChannel } from './peerMaps';

/**
 * The look-alike rules must not depend on which channel is on screen: a
 * channel is only ever an example. These are samples of two real maps from
 * niches unrelated to the one the rules were first worked out on, each centred
 * on a small established channel with no model channel. The groups were sorted
 * by reading the titles, not by the scores.
 */

const DAY_MS = 86_400_000;

function rowsOf(fixture: Fixture): (title: string) => MapRow {
  const now = new Date(fixture.now);
  const toMember = (channel: FixtureChannel): MapMemberData => ({
    channel: {
      id: channel.id,
      title: channel.title,
      handle: null,
      subscribers: channel.subscribers,
      subscribersHidden: channel.subscribers === null,
      videoCount: null,
      fetchedAt: now,
    },
    steps: channel.steps,
    videos: channel.videos.map((video, index) => ({
      id: `${channel.id}-${index}`,
      channelId: channel.id,
      title: video.title,
      views: 0,
      durationSeconds: video.durationSeconds,
      published: {
        date: new Date(now.getTime() - video.daysAgo * DAY_MS),
        precision: 'day',
        raw: `${video.daysAgo}d ago`,
      },
      fetchedAt: now,
    })),
  });
  const rows = buildMapView({
    center: toMember(fixture.centre),
    members: fixture.channels.map(toMember),
    edges: [],
    now,
  });
  return (title) => {
    const found = rows.find((candidate) => candidate.channel.title === title);
    if (!found) throw new Error(`${title} is not in the fixture`);
    return found;
  };
}

describe.each(NICHES)(
  'look-alikes in another niche: $name',
  ({ fixture, lookAlikes, otherNiches, dormant }) => {
    const row = rowsOf(fixture);

    test('counts the channels that make the centre’s kind of video', () => {
      const missed = lookAlikes.filter((title) => !row(title).peer);

      expect(missed).toEqual([]);
    });

    test('leaves out channels from other niches', () => {
      const wronglyIn = otherNiches.filter((title) => row(title).peer);

      expect(wronglyIn).toEqual([]);
    });

    test('sets aside a channel that stopped uploading as dormant, not as another niche', () => {
      expect(dormant.map((title) => row(title).outsideReason)).toEqual(
        dormant.map(() => 'dormant'),
      );
    });

    test('scores every look-alike above every channel from another niche', () => {
      const lowestLookAlike = Math.min(...lookAlikes.map((title) => row(title).relevance));
      const highestOutsider = Math.max(...otherNiches.map((title) => row(title).relevance));

      expect(lowestLookAlike).toBeGreaterThan(highestOutsider);
    });
  },
);

describe('what title wording cannot settle, in any niche', () => {
  // These make the centre's kind of video in other words ("Rolex Is (Finally)
  // Getting What They Deserve" beside "Lowe's $84 Billion Empire Is
  // Collapsing"). Matching on wording leaves them just under the line; the
  // same-topic list and Claude's reading of it are what catch them.
  test.todo(
    'tells same-niche channels with another title format (Nimbus, Quietonomy, MattieCG) from other niches',
  );
});
