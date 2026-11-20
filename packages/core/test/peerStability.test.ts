import { describe, expect, test } from 'vitest';
import { buildMapView, type MapRow } from '../src/map/view';
import { MODEL_NICHE, NICHES, toMember, type Fixture, type FixtureChannel } from './peerMaps';

/**
 * A look-alike call should follow from the channel and the reference, not from
 * which other channels happen to be on the map. It does not, quite: the title
 * match borrows wording from the closest look-alikes on the map. So each call
 * says whether it is settled, and this pins what that word promises: remove a
 * random half of the other channels and a settled call stays as it was.
 *
 * The halves here are drawn by position with their own generator, so they are
 * not the halves the view itself re-reads the map on.
 */

/** Runs per map, as when the dependence was first measured. */
const RUNS = [1, 2, 3, 4, 5, 6];
/** The share of settled calls allowed to change when half the map goes: the target the marking was built to. */
const SETTLED_MAY_CHANGE = 0.01;
/**
 * The share of all calls, unsettled ones included, that changes at most. This
 * is the dependence itself, measured and not removed: up to one call in ten on
 * the retro-technology map.
 */
const ALL_MAY_CHANGE = 0.12;
/** At most this share of a map is marked unsettled; a mark on everything would say nothing. */
const MOST_UNSETTLED = 1 / 3;

/** A small seeded generator (mulberry32), so every run removes the same channels. */
function seeded(seed: number): () => number {
  let state = (Math.imul(seed, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function view(fixture: Fixture, channels: readonly FixtureChannel[]): ReadonlyMap<string, MapRow> {
  const now = new Date(fixture.now);
  const rows = buildMapView({
    center: toMember(fixture.centre, now),
    members: channels.map((channel) => toMember(channel, now)),
    edges: [],
    now,
    modelId: fixture.modelId ?? null,
  });
  return new Map(rows.map((row) => [row.channel.title, row]));
}

/** A random half of the map's channels. The model stays: it is the reference, not a neighbour. */
function halfOf(fixture: Fixture, run: number): readonly FixtureChannel[] {
  const draw = seeded(run);
  return fixture.channels.filter((channel) => {
    const kept = draw() < 0.5;
    return kept || channel.id === fixture.modelId;
  });
}

interface Outcome {
  readonly whole: ReadonlyMap<string, MapRow>;
  /** Every call made on a half, beside the call for the same channel on the whole map. */
  readonly calls: readonly {
    readonly title: string;
    readonly before: MapRow;
    readonly after: MapRow;
  }[];
}

function removeHalves(fixture: Fixture): Outcome {
  const whole = view(fixture, fixture.channels);
  const calls = RUNS.flatMap((run) =>
    [...view(fixture, halfOf(fixture, run))].flatMap(([title, after]) => {
      const before = whole.get(title);
      return before ? [{ title, before, after }] : [];
    }),
  );
  return { whole, calls };
}

const share = (part: number, of: number): number => (of === 0 ? 0 : part / of);

const CASES = [
  {
    niche: MODEL_NICHE,
    // Loud outsiders at 10-12%, a point or two under the line, and one direct
    // neighbour that lends its own titles when few others are left.
    unsettledLabelled: ['JoshSullivanSpace', 'Wild Line', 'Beyond Sky', 'TerraDecoded'],
  },
  {
    niche: NICHES[0],
    // Three look-alikes within two points of the line, and two direct
    // neighbours that lend their own titles when few others are left.
    unsettledLabelled: [
      'Ctrl+Alt+Fail',
      'The Great Bet',
      'Gadget Afterlife',
      'Uncle Nav',
      'biplav',
    ],
  },
  {
    niche: NICHES[1],
    unsettledLabelled: ['Business Behind Brands', 'rooked.'],
  },
].flatMap((entry) =>
  entry.niche ? [{ ...entry, niche: entry.niche, name: entry.niche.name }] : [],
);

describe.each(CASES)('with half of the map removed: $name', ({ niche, unsettledLabelled }) => {
  const { whole, calls } = removeHalves(niche.fixture);
  const labelled = [...niche.lookAlikes, ...niche.otherNiches];
  const settled = calls.filter((call) => call.before.settled);
  const changed = (list: typeof calls) =>
    list.filter((call) => call.after.peer !== call.before.peer);

  test('a settled call stays as it was', () => {
    expect(share(changed(settled).length, settled.length)).toBeLessThanOrEqual(SETTLED_MAY_CHANGE);
  });

  test('no settled call for a labelled channel changes on any half', () => {
    const moved = changed(settled).filter((call) => labelled.includes(call.title));

    expect(moved.map((call) => call.title)).toEqual([]);
  });

  test('the labelled channels whose calls are not settled are these, and no others', () => {
    const marked = labelled.filter((title) => whole.get(title)?.settled === false);

    expect(marked).toEqual(unsettledLabelled);
  });

  test('counting unsettled calls too, at most the stated share of calls changes', () => {
    expect(share(changed(calls).length, calls.length)).toBeLessThanOrEqual(ALL_MAY_CHANGE);
  });

  test('most of the map is settled', () => {
    const unsettled = [...whole.values()].filter((row) => !row.settled);

    expect(share(unsettled.length, whole.size)).toBeLessThanOrEqual(MOST_UNSETTLED);
  });
});
