import { z } from 'zod';
import type { EarlierMap } from './store';

/**
 * Which look-alikes are new on a channel's map, and which are gone, since the
 * map that was its latest at an earlier moment. Both sides are read the same
 * way: the filter's call as frozen in each map, with the owner's keep and
 * remove choices as they stand today on both, so a choice made since does
 * not show up as a change of the map.
 */

/**
 * The oldest stored form an earlier map can be compared in. Who is a
 * look-alike changed with forms 3 and 4; from 4 on, only what else a channel
 * carries changed.
 */
export const COMPARABLE_SNAPSHOT_FORMAT = 4;

export interface LookalikeRef {
  readonly channelId: string;
  readonly title: string;
}

/**
 * 'same-map': no map has been made since the earlier moment, so nothing can have changed.
 * 'no-earlier-map': the channel had no map yet at the earlier moment.
 * 'older-form': the earlier map was stored under older matching rules, or not frozen.
 */
export type NotComparable = 'same-map' | 'no-earlier-map' | 'older-form';

export type LookalikeChanges =
  | {
      readonly comparable: true;
      /** When the map compared with was made, as an ISO-8601 string. */
      readonly earlierMapMadeAt: string;
      readonly added: readonly LookalikeRef[];
      readonly gone: readonly LookalikeRef[];
    }
  | { readonly comparable: false; readonly reason: NotComparable };

/** The owner's say as it stands now. */
export interface OwnerSay {
  readonly kept: ReadonlySet<string>;
  readonly removed: ReadonlySet<string>;
}

const earlierSnapshot = z.object({
  format: z.number().int().min(COMPARABLE_SNAPSHOT_FORMAT),
  snapshot: z.looseObject({
    channels: z.array(z.looseObject({ id: z.string(), title: z.string(), peer: z.boolean() })),
  }),
});

/** The look-alikes of an earlier map under today's choices; null when it cannot be read. */
function earlierLookalikes(json: string | null, say: OwnerSay): readonly LookalikeRef[] | null {
  if (json === null) return null;
  try {
    const parsed = earlierSnapshot.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    return parsed.data.snapshot.channels
      .filter(
        (channel) => (channel.peer || say.kept.has(channel.id)) && !say.removed.has(channel.id),
      )
      .map((channel) => ({ channelId: channel.id, title: channel.title }));
  } catch {
    return null;
  }
}

const byTitle = (a: LookalikeRef, b: LookalikeRef): number =>
  a.title.localeCompare(b.title) || a.channelId.localeCompare(b.channelId);

/** The look-alikes of the latest map against those of the map that was latest earlier. */
export function lookalikeChanges(
  latestMapId: number,
  current: readonly LookalikeRef[],
  earlier: EarlierMap | null,
  say: OwnerSay,
): LookalikeChanges {
  if (earlier === null) return { comparable: false, reason: 'no-earlier-map' };
  if (earlier.id === latestMapId) return { comparable: false, reason: 'same-map' };
  const before = earlierLookalikes(earlier.snapshotJson, say);
  if (before === null) return { comparable: false, reason: 'older-form' };
  const beforeIds = new Set(before.map((channel) => channel.channelId));
  const currentIds = new Set(current.map((channel) => channel.channelId));
  return {
    comparable: true,
    earlierMapMadeAt: earlier.createdAt.toISOString(),
    added: current.filter((channel) => !beforeIds.has(channel.channelId)).sort(byTitle),
    gone: before.filter((channel) => !currentIds.has(channel.channelId)).sort(byTitle),
  };
}
