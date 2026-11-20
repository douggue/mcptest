import type { MapSnapshot, SnapshotChannel } from '@jgtube/core';

type Tier = SnapshotChannel['tier'];

/**
 * Places the channels of a map on the radar. Coordinates are pixels from the
 * centre of a 1200 × 620 stage, x to the right and y downwards.
 */

export const RING_RADIUS: Readonly<Record<Tier, number>> = { close: 140, medium: 280, far: 420 };
/** How many channels each ring shows before the rest are left to the list. */
const RING_CAPACITY: Readonly<Record<Tier, number>> = { close: 8, medium: 14, far: 12 };
/**
 * Where on each ring nodes may sit, in degrees clockwise from the right. The
 * outer rings are taller than the stage, so they use only their side arcs.
 */
const RING_ARCS: Readonly<Record<Tier, readonly (readonly [number, number])[]>> = {
  close: [[-90, 270]],
  medium: [
    [-62, 62],
    [118, 242],
  ],
  far: [
    [-38, 38],
    [142, 218],
  ],
};
/** Alternate nodes on the middle ring sit slightly in or out so their labels do not collide. */
const MEDIUM_STAGGER = 14;
const BADGE_MIN_SCORE = 5;

export interface RadarNode {
  readonly id: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly tier: Tier;
  /** Best recent breakout multiple, when it is large enough to be worth a badge. */
  readonly badge: number | null;
  readonly rising: boolean;
}

export interface RadarLink {
  readonly fromId: string;
  readonly toId: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Recommendation share, 0 to 1. */
  readonly strength: number;
}

export interface RadarLayout {
  readonly nodes: readonly RadarNode[];
  readonly links: readonly RadarLink[];
  /** Channels on the map that did not fit on the radar. */
  readonly hidden: number;
}

/** Evenly spaced angles across the allowed arcs, each at the middle of its slot. */
function anglesFor(count: number, arcs: readonly (readonly [number, number])[]): readonly number[] {
  const total = arcs.reduce((sum, [start, end]) => sum + (end - start), 0);
  return Array.from({ length: count }, (_, index) => {
    let offset = ((index + 0.5) / count) * total;
    for (const [start, end] of arcs) {
      if (offset <= end - start) return start + offset;
      offset -= end - start;
    }
    return arcs.at(-1)?.[1] ?? 0;
  });
}

function placeRing(channels: readonly SnapshotChannel[], tier: Tier): readonly RadarNode[] {
  const shown = channels.filter((channel) => channel.tier === tier).slice(0, RING_CAPACITY[tier]);
  const angles = anglesFor(shown.length, RING_ARCS[tier]);
  return shown.map((channel, index) => {
    const stagger = tier === 'medium' ? (index % 2 === 0 ? MEDIUM_STAGGER : -MEDIUM_STAGGER) : 0;
    const radius = RING_RADIUS[tier] + stagger;
    const angle = ((angles[index] ?? 0) * Math.PI) / 180;
    const score = channel.breakout?.score ?? 0;
    return {
      id: channel.id,
      title: channel.title,
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      tier,
      badge: score >= BADGE_MIN_SCORE ? score : null,
      rising: channel.rising,
    };
  });
}

function buildLinks(
  snapshot: Pick<MapSnapshot, 'center' | 'edges'>,
  nodes: readonly RadarNode[],
): readonly RadarLink[] {
  const centerId = snapshot.center.id;
  const position = new Map<string, { x: number; y: number }>([
    [centerId, { x: 0, y: 0 }],
    ...nodes.map((node) => [node.id, { x: node.x, y: node.y }] as const),
  ]);
  const visible = snapshot.edges.filter(
    (edge) => position.has(edge.from) && position.has(edge.to) && edge.to !== centerId,
  );
  const fromCenter = visible.filter((edge) => edge.from === centerId);
  const direct = new Set(fromCenter.map((edge) => edge.to));

  // A channel reached only through others gets one line, from whoever recommends it most.
  const strongest = new Map<string, (typeof visible)[number]>();
  for (const edge of visible) {
    if (edge.from === centerId || direct.has(edge.to)) continue;
    const current = strongest.get(edge.to);
    if (!current || edge.share > current.share) strongest.set(edge.to, edge);
  }

  return [...fromCenter, ...strongest.values()].map((edge) => {
    const from = position.get(edge.from) ?? { x: 0, y: 0 };
    const to = position.get(edge.to) ?? { x: 0, y: 0 };
    return {
      fromId: edge.from,
      toId: edge.to,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      strength: edge.share,
    };
  });
}

export function layoutRadar(
  snapshot: Pick<MapSnapshot, 'center' | 'channels' | 'edges'>,
): RadarLayout {
  const nodes = (['close', 'medium', 'far'] as const).flatMap((tier) =>
    placeRing(snapshot.channels, tier),
  );
  return {
    nodes,
    links: buildLinks(snapshot, nodes),
    hidden: snapshot.channels.length - nodes.length,
  };
}
