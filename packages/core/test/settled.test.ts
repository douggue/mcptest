import { describe, expect, test } from 'vitest';
import {
  inHalf,
  judgePeers,
  mapHalf,
  SETTLED_HALVES,
  unsettledPeers,
  type PeerCandidate,
} from '../src/map/settled';

const candidate = (
  id: string,
  titles: readonly string[],
  extra: Partial<PeerCandidate> = {},
): PeerCandidate => ({ id, steps: 1, titles, shape: null, ...extra });

const ids = Array.from({ length: 400 }, (_, index) => `UC${String(index).padStart(22, '0')}`);
const halves = Array.from({ length: SETTLED_HALVES }, (_, index) => index + 1);

describe('inHalf', () => {
  test('puts about half of the channels in a half, and the same ones every time', () => {
    const kept = ids.filter((id) => inHalf(id, 1));

    expect(kept.length).toBeGreaterThan(160);
    expect(kept.length).toBeLessThan(240);
    expect(ids.filter((id) => inHalf(id, 1))).toEqual(kept);
  });

  test('draws each half afresh', () => {
    const differing = ids.filter((id) => inHalf(id, 1) !== inHalf(id, 2));

    expect(differing.length).toBeGreaterThan(160);
    expect(differing.length).toBeLessThan(240);
  });

  test('keeps no channel in nearly every half or out of nearly every half', () => {
    // Neighbouring ids and neighbouring halves must not be kept or dropped together.
    const timesKept = ids.map((id) => halves.filter((half) => inHalf(id, half)).length);

    expect(Math.min(...timesKept)).toBeGreaterThanOrEqual(SETTLED_HALVES * 0.1);
    expect(Math.max(...timesKept)).toBeLessThanOrEqual(SETTLED_HALVES * 0.9);
  });
});

describe('mapHalf', () => {
  const channels = ids.slice(0, 40).map((id) => candidate(id, ['A title']));

  test('keeps the channels drawn for that half, in their order', () => {
    const half = mapHalf(channels, 3, null);

    expect(half.map((channel) => channel.id)).toEqual(
      channels.filter((channel) => inHalf(channel.id, 3)).map((channel) => channel.id),
    );
  });

  test('never drops the reference: it is what the others are measured against', () => {
    const reference = channels[0]?.id ?? '';
    const present = halves.filter((half) =>
      mapHalf(channels, half, reference).some((channel) => channel.id === reference),
    );

    expect(present).toEqual(halves);
  });
});

describe('judgePeers', () => {
  const reference = ['America Just Built a Humanoid Robot Army'];
  const twin = candidate('twin', [
    'America Just Built a Fusion Reactor',
    'This New Invention Could Replace Jet Engines Forever',
  ]);
  const cousin = candidate(
    'cousin',
    ['This New Invention Could Replace Car Mirrors Forever', 'Germany Battery Breakthrough'],
    { steps: 2 },
  );
  const news = candidate('news', [
    'Full Ceremony: Leaders Arrive at the Summit',
    'Watch: Press Briefing Live',
  ]);

  test('says who is a peer and why the others are not', () => {
    const giant = candidate('giant', twin.titles, { shape: 'larger' });

    const verdicts = judgePeers(reference, [twin, cousin, news, giant], null);

    expect(verdicts.get('twin')?.outsideReason).toBeNull();
    // Lifted by the wording its look-alike lent.
    expect(verdicts.get('cousin')?.outsideReason).toBeNull();
    expect(verdicts.get('news')).toEqual({ relevance: 0, outsideReason: 'titles' });
    expect(verdicts.get('giant')?.outsideReason).toBe('larger');
  });

  test('borrows from direct neighbours before channels further out', () => {
    const near = candidate('near', ['America Just Built a Dam', 'Rifles Ranked Worst to Best']);
    const far = candidate('far', ['America Just Built a Dam', 'Tigers Avoid Elephants'], {
      steps: 2,
    });
    const rifles = candidate('rifles', ['Rifles Ranked Worst to Best'], { steps: 2 });
    const tigers = candidate('tigers', ['Tigers Avoid Elephants'], { steps: 2 });

    const verdicts = judgePeers(reference, [near, far, rifles, tigers], null);

    expect(verdicts.get('rifles')?.relevance).toBeGreaterThan(0);
    expect(verdicts.get('tigers')?.relevance).toBe(0);
  });

  test('does not spend a lender’s place on the reference itself', () => {
    const six = (title: string): string[] => Array.from({ length: 6 }, (_, n) => `${title} ${n}`);
    const model = candidate('model', six('America Just Built a Reactor'));
    const channels = [
      model,
      candidate('bridge', six('America Just Built a Bridge')),
      candidate('rocket', six('America Just Launched a Rocket')),
      candidate('third', six('America Hovercraft Breakthrough')),
      candidate('hovercraft', six('Hovercraft Breakthrough'), { steps: 2 }),
    ];

    const verdicts = judgePeers(model.titles, channels, 'model');

    // Only as the third lender can 'third' vouch for 'hovercraft'.
    expect(verdicts.get('hovercraft')?.relevance).toBeGreaterThan(0);
    expect(verdicts.get('model')?.relevance).toBeGreaterThan(0.5);
  });
});

describe('unsettledPeers', () => {
  const format = (subject: string): string => `America Just Built a ${subject}`;
  const reference = ['Reactor', 'Bridge', 'Rocket', 'Robot', 'Tunnel', 'Dam'].map(format);
  const twins = ['Mill', 'Port', 'Tower', 'Canal', 'Plant', 'Ship', 'Train', 'Mine'].map(
    (subject, index) =>
      candidate(`twin-${index}`, [format(subject), format(`Bigger ${subject}`)], { steps: 2 }),
  );
  const outsiders = ['Rifles Ranked', 'Tigers Avoid Elephants', 'Quiet Walks', 'Slow Cooking'].map(
    (title, index) => candidate(`outsider-${index}`, [title, `${title} Again`], { steps: 2 }),
  );

  test('finds nothing unsettled when every call follows from the reference’s own titles', () => {
    const channels = [...twins, ...outsiders];

    expect([...unsettledPeers(reference, channels, null)]).toEqual([]);
  });

  // A new channel with one title, led by the look-alike that lends its wording.
  const thin = ['America Just Built a Humanoid Robot Army'];
  const lender = candidate('lender', [
    'America Just Built a Fusion Reactor',
    'This New Invention Could Replace Jet Engines Forever',
  ]);
  const borrowed = [
    'This New Invention Could Replace Car Mirrors Forever',
    'Germany Battery Breakthrough',
  ];

  test('marks a channel that passes only on wording one look-alike lent', () => {
    const borrower = candidate('borrower', borrowed, { steps: 2 });
    const channels = [lender, borrower, ...outsiders];

    const whole = judgePeers(thin, channels, null);
    const unsettled = unsettledPeers(thin, channels, null);

    expect(whole.get('borrower')?.outsideReason).toBeNull();
    // Without the lender on the map the borrower shares nothing with the reference.
    expect(judgePeers(thin, [borrower, ...outsiders], null).get('borrower')?.relevance).toBe(0);
    expect(unsettled.has('borrower')).toBe(true);
    expect(unsettled.has('lender')).toBe(false);
  });

  test('never marks a channel that its shape rules out', () => {
    const giant = candidate('giant', borrowed, { steps: 2, shape: 'larger' });

    expect(unsettledPeers(thin, [lender, giant, ...outsiders], null).has('giant')).toBe(false);
  });

  test('has nothing to say about an empty map', () => {
    expect(unsettledPeers(reference, [], null).size).toBe(0);
  });
});
