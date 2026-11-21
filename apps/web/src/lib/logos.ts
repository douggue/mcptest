import type { LogoFound, LogoOutcome, LogoProgress, MapSnapshot, SavedChannel } from '@jgtube/core';
import { apiCaller, type Fetch } from './api';

/**
 * Logos for a map made before logos were stored. The page asks the server to
 * fetch the missing ones when such a map is opened, follows the job, and puts
 * each logo on the map as it arrives. Nothing here is asked of the owner.
 */

/** How many times one opening of a map asks: a few batches, and a few waits for other work. */
export const LOGO_MAX_ROUNDS = 8;
/** How long to wait when a map, a refresh or a search is reading YouTube. */
export const LOGO_RETRY_MS = 30_000;
export const LOGO_POLL_MS = 1500;

export interface LogoJob {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: LogoProgress | null;
  readonly result: LogoOutcome | null;
  readonly error: string | null;
}

export type LogoStart =
  | { readonly kind: 'started'; readonly jobId: string; readonly missing: number }
  /** Every channel of the map has been read, or there is no map. */
  | { readonly kind: 'none' }
  /** Other work is reading YouTube. */
  | { readonly kind: 'busy' };

export type LogoStep =
  | { readonly kind: 'follow'; readonly jobId: string }
  | { readonly kind: 'again' }
  | { readonly kind: 'later' }
  | { readonly kind: 'stop' };

const STOP: LogoStep = { kind: 'stop' };

/** Whether any channel of the map, the centre included, is shown without a logo. */
export function needsLogos(snapshot: Pick<MapSnapshot, 'center' | 'channels'>): boolean {
  return (
    (snapshot.center.logoUrl ?? null) === null ||
    snapshot.channels.some((channel) => (channel.logoUrl ?? null) === null)
  );
}

/** The map with each logo found put on its channel. The same object when nothing changes. */
export function withLogos(snapshot: MapSnapshot, logos: readonly LogoFound[]): MapSnapshot {
  const found = new Map(
    logos.flatMap((logo) => (logo.logoUrl === null ? [] : [[logo.channelId, logo.logoUrl]])),
  );
  const logoOf = (channel: { readonly id: string; readonly logoUrl?: string | null }) =>
    found.get(channel.id) ?? channel.logoUrl ?? null;
  const changes = (channel: { readonly id: string; readonly logoUrl?: string | null }) =>
    logoOf(channel) !== (channel.logoUrl ?? null);
  if (!changes(snapshot.center) && !snapshot.channels.some(changes)) return snapshot;
  return {
    ...snapshot,
    center: { ...snapshot.center, logoUrl: logoOf(snapshot.center) },
    channels: snapshot.channels.map((channel) =>
      changes(channel) ? { ...channel, logoUrl: logoOf(channel) } : channel,
    ),
  };
}

/** The saved channels with each logo found put on its channel. The same list when nothing changes. */
export function withSavedLogos(
  saved: readonly SavedChannel[],
  logos: readonly LogoFound[],
): readonly SavedChannel[] {
  const found = new Map(
    logos.flatMap((logo) => (logo.logoUrl === null ? [] : [[logo.channelId, logo.logoUrl]])),
  );
  const changes = (channel: SavedChannel): boolean =>
    found.has(channel.id) && found.get(channel.id) !== channel.logoUrl;
  if (!saved.some(changes)) return saved;
  return saved.map((channel) =>
    changes(channel) ? { ...channel, logoUrl: found.get(channel.id) ?? null } : channel,
  );
}

/** What to do with the server's answer to "fetch this map's logos"; `round` counts from 1. */
export function afterLogoStart(start: LogoStart, round: number): LogoStep {
  if (start.kind === 'started') return { kind: 'follow', jobId: start.jobId };
  if (start.kind === 'none' || round >= LOGO_MAX_ROUNDS) return STOP;
  return { kind: 'later' };
}

/** What to do when a job has ended: `outcome` is null when it failed. */
export function afterLogoRun(outcome: LogoOutcome | null, round: number): LogoStep {
  if (outcome === null || round >= LOGO_MAX_ROUNDS) return STOP;
  // A run cut short gave way to other work or was refused; a full one may have more to do.
  return outcome.stoppedEarly ? { kind: 'later' } : { kind: 'again' };
}

export function describeLogoRun(progress: LogoProgress | null): string {
  return progress === null
    ? 'Fetching channel logos'
    : `Fetching channel logos: ${progress.done} of ${progress.total}`;
}

export function createLogoApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  return {
    /** Asks for the logos missing from a channel's latest map to be fetched. */
    async start(channel: string): Promise<LogoStart> {
      const envelope = await send('/api/logos', { channel });
      if (envelope.status === 409) return { kind: 'busy' };
      if (envelope.status === 404) return { kind: 'none' };
      const { jobId, missing } = unwrap<{ jobId: string | null; missing: number }>(envelope);
      return jobId === null ? { kind: 'none' } : { kind: 'started', jobId, missing };
    },

    async job(id: string): Promise<LogoJob> {
      return unwrap<LogoJob>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type LogoApi = ReturnType<typeof createLogoApi>;
