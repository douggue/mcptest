import { outsideReason, type OutsideReason } from './peers';
import { anchoredSimilarityOf, indexTitles, type TitleIndex } from './relevance';

/**
 * Tells the look-alike calls that follow from a channel and the reference from
 * those that also hang on which other channels happen to be on the map.
 *
 * The title match borrows wording from the closest look-alikes on the map and
 * counts word rarity over the map, so the same channel can pass on one map and
 * fail on another. No rule tried removed that without either losing look-alikes
 * or letting loud outsiders in (see "Checked in other niches" in
 * docs/SYSTEM_DESIGN.md), so the dependence is measured and shown instead: the
 * calls are made again on random halves of the map, and a channel whose call is
 * not the same on every half is unsettled.
 */

/** A channel as the look-alike call sees it. */
export interface PeerCandidate {
  readonly id: string;
  /** Steps from the centre; direct neighbours (1) lend their wording first. */
  readonly steps: number;
  /** The newest titles the match is read from. */
  readonly titles: readonly string[];
  /** Why its size, pace or length rules it out, or null. Depends on it and the reference only. */
  readonly shape: Exclude<OutsideReason, 'titles'> | null;
}

export interface PeerVerdict {
  /** Title match against the reference, 0 to 1. */
  readonly relevance: number;
  /** Why it is not a peer; null when it is one. */
  readonly outsideReason: OutsideReason | null;
}

export interface PeerReading {
  /** Every channel's call on the whole map. */
  readonly verdicts: ReadonlyMap<string, PeerVerdict>;
  /** The channels whose call was not the same on every random half of the map. */
  readonly unsettled: ReadonlySet<string>;
}

/** The calls for the channels given, which may be the whole indexed map or a part of it. */
function judge(
  index: TitleIndex,
  candidates: readonly PeerCandidate[],
  referenceId: string | null,
): ReadonlyMap<string, PeerVerdict> {
  const fits = candidates.filter(
    (candidate) => candidate.id !== referenceId && candidate.shape === null,
  );
  const direct = fits.filter((candidate) => candidate.steps === 1);
  const { scores } = anchoredSimilarityOf(
    index,
    candidates.map((candidate) => candidate.id),
    (direct.length > 0 ? direct : fits).map((candidate) => candidate.id),
  );
  return new Map(
    candidates.map((candidate) => {
      const relevance = scores.get(candidate.id) ?? 0;
      return [
        candidate.id,
        { relevance, outsideReason: outsideReason(candidate.shape, relevance) },
      ];
    }),
  );
}

const indexOf = (
  referenceTitles: readonly string[],
  candidates: readonly PeerCandidate[],
): TitleIndex =>
  indexTitles(
    referenceTitles,
    new Map(candidates.map((candidate) => [candidate.id, candidate.titles])),
  );

/**
 * One reading of a map: every channel's title match and whether it is a peer.
 * `referenceId` names the reference when it is itself on the map (a model
 * channel); it is scored like the rest but never lends its titles to itself.
 */
export function judgePeers(
  referenceTitles: readonly string[],
  candidates: readonly PeerCandidate[],
  referenceId: string | null,
): ReadonlyMap<string, PeerVerdict> {
  return judge(indexOf(referenceTitles, candidates), candidates, referenceId);
}

/**
 * How many random halves of the map the calls are made again on. A channel is
 * in about half of them, so one whose call changes on one half in ten is caught
 * nearly nine times in ten (1 - 0.9^20), and one that changes on one in five
 * nearly always. Measured on five maps in four niches: with 40 halves, at most
 * 0.2% of the calls left standing changed on further halves.
 */
export const SETTLED_HALVES = 40;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over the text, then a final mix so that near-identical texts land far apart. */
function hash32(text: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

const HALF_OF_UINT32 = 0x80000000;

/**
 * Whether a channel is in the numbered random half. It depends on the channel's
 * id and the number alone, never on the order of the map or on who else is on
 * it, so the same map always gives the same halves.
 */
export function inHalf(id: string, half: number): boolean {
  return hash32(`${half}:${id}`) < HALF_OF_UINT32;
}

/** The numbered half of a map. The reference stays: it is what the others are measured against. */
export function mapHalf(
  candidates: readonly PeerCandidate[],
  half: number,
  referenceId: string | null,
): readonly PeerCandidate[] {
  return candidates.filter(
    (candidate) => candidate.id === referenceId || inHalf(candidate.id, half),
  );
}

const isPeer = (verdict: PeerVerdict | undefined): boolean => verdict?.outsideReason === null;

/**
 * Reads a map: the call for every channel, and which of those calls (peer or
 * not) came out differently on at least one of the random halves the channel is
 * in. A channel ruled out by its shape is never unsettled: shape does not look
 * at the rest of the map.
 */
export function readPeers(
  referenceTitles: readonly string[],
  candidates: readonly PeerCandidate[],
  referenceId: string | null,
): PeerReading {
  const index = indexOf(referenceTitles, candidates);
  const verdicts = judge(index, candidates, referenceId);
  const open = candidates.filter((candidate) => candidate.shape === null);
  if (open.length === 0) return { verdicts, unsettled: new Set() };
  const halves = Array.from({ length: SETTLED_HALVES }, (_, at) =>
    judge(index, mapHalf(candidates, at + 1, referenceId), referenceId),
  );
  const changes = (id: string): boolean =>
    halves.some((half) => half.has(id) && isPeer(half.get(id)) !== isPeer(verdicts.get(id)));
  return {
    verdicts,
    unsettled: new Set(open.map((candidate) => candidate.id).filter(changes)),
  };
}

/** The channels whose call is not the same on every random half of the map. */
export function unsettledPeers(
  referenceTitles: readonly string[],
  candidates: readonly PeerCandidate[],
  referenceId: string | null,
): ReadonlySet<string> {
  return readPeers(referenceTitles, candidates, referenceId).unsettled;
}
