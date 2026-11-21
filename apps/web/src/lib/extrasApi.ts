import type { PlanView, SinceKind } from '@jgtube/core';
import { apiCaller, type Fetch } from './api';
import type { AlertSettingsInput, AlertsReply } from './alerts';
import type { ChangesReply } from './changes';

/** The later features' part of the local server's API, each call for one channel by its id. */
export function createExtrasApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  /** A read that answers 404 when the channel has no map. */
  const read = async <T>(path: string): Promise<T | null> => {
    const envelope = await call(path);
    return envelope.status === 404 ? null : unwrap<T>(envelope);
  };
  const of = (channel: string): string => `channel=${encodeURIComponent(channel)}`;

  return {
    /** What changed among a channel's look-alikes since a moment; null when it has no map. */
    changes: (channel: string, since: SinceKind) =>
      read<ChangesReply>(`/api/changes?${of(channel)}&since=${since}`),

    /** Moves the channel's last look to now; resolves with when that is. */
    async markSeen(channel: string): Promise<string> {
      return unwrap<{ lastLookAt: string }>(await send('/api/changes/seen', { channel }))
        .lastLookAt;
    },

    /** A channel's alert rule and alerts; null when it has no map. */
    alerts: (channel: string) => read<AlertsReply>(`/api/alerts?${of(channel)}`),

    /** Unread alerts per saved channel. */
    async alertCounts(): Promise<Readonly<Record<string, number>>> {
      return unwrap<{ counts: Record<string, number> }>(await call('/api/alerts/counts')).counts;
    },

    async saveAlertRule(channel: string, settings: AlertSettingsInput): Promise<AlertsReply> {
      return unwrap<AlertsReply>(await send('/api/alerts/rule', { channel, ...settings }));
    },

    async markAlertsRead(channel: string): Promise<AlertsReply> {
      return unwrap<AlertsReply>(await send('/api/alerts/read', { channel }));
    },

    /** A channel's own videos against the plan; null when it has no map. */
    plan: (channel: string) => read<PlanView>(`/api/plan?${of(channel)}`),

    async linkPlanVideo(channel: string, conceptId: number, link: string): Promise<PlanView> {
      return unwrap<PlanView>(await send('/api/plan/link', { channel, conceptId, link }));
    },

    async unlinkPlanVideo(channel: string, conceptId: number): Promise<PlanView> {
      return unwrap<PlanView>(await send('/api/plan/unlink', { channel, conceptId }));
    },
  };
}

export type ExtrasApi = ReturnType<typeof createExtrasApi>;
