import type {
  CalendarView,
  ChannelProfile,
  MineOutcome,
  PacingView,
  PlanView,
  ScheduleEntry,
  SinceKind,
} from '@jgtube/core';
import { apiCaller, type Fetch } from './api';
import type { AlertSettingsInput, AlertsReply } from './alerts';
import type { CommentsView } from './comments';
import type { RiskView } from './risk';
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

    /** Any stored channel's numbers and some of its videos; null when the store does not hold it. */
    profile: (channel: string) => read<ChannelProfile>(`/api/channels/profile?${of(channel)}`),

    /** A channel's lengths and pace beside its map's breakouts; null when it has no map. */
    pacing: (channel: string) => read<PacingView>(`/api/pacing?${of(channel)}`),

    /** What is known of comment mining for a channel; null when it has no map. */
    comments: (channel: string) => read<CommentsView>(`/api/comments?${of(channel)}`),

    /** Starts reading the chosen winners' comments; resolves with the job id. */
    async readComments(channel: string, videoIds: readonly string[]): Promise<string> {
      return unwrap<{ jobId: string }>(await send('/api/comments/read', { channel, videoIds }))
        .jobId;
    },

    /** Starts "What viewers ask for"; resolves with the job id. */
    async askViewers(channel: string, videoIds: readonly string[]): Promise<string> {
      return unwrap<{ jobId: string }>(await send('/api/comments/ask', { channel, videoIds }))
        .jobId;
    },

    /** A channel's scripted concepts and the check of one; null when it has no map. */
    risk: (channel: string, conceptId: number | null) =>
      read<RiskView>(
        `/api/risk?${of(channel)}${conceptId === null ? '' : `&concept=${conceptId}`}`,
      ),

    /** Starts the risk check of a concept's script; resolves with the job id. */
    async askRisk(channel: string, conceptId: number): Promise<string> {
      return unwrap<{ jobId: string }>(await send('/api/risk/ask', { channel, conceptId })).jobId;
    },

    /** One of the later features' jobs. */
    async extrasJob(id: string): Promise<ExtrasJob> {
      return unwrap<ExtrasJob>(await call(`/api/extras/job?id=${encodeURIComponent(id)}`));
    },

    /** A channel's upload calendar; null when it has no map. */
    calendar: (channel: string) => read<CalendarView>(`/api/calendar?${of(channel)}`),

    async saveCalendarItem(
      channel: string,
      conceptId: number,
      entry: ScheduleEntry,
    ): Promise<CalendarView> {
      return unwrap<CalendarView>(
        await send('/api/calendar/item', { channel, conceptId, ...entry }),
      );
    },
  };
}

export type ExtrasApi = ReturnType<typeof createExtrasApi>;

/** A long piece of the later features' work, as the server reports it. */
export interface ExtrasJob {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: { readonly text: string } | null;
  readonly result:
    | { readonly kind: 'comments-read'; readonly outcomes: readonly MineOutcome[] }
    | {
        readonly kind: 'viewer-answer';
        readonly outcome: {
          readonly proposed: number;
          readonly dropped: number;
          readonly unread: number;
          readonly engine: string;
        };
      }
    | {
        readonly kind: 'risk-check';
        readonly outcome: {
          readonly claims: number;
          readonly notes: number;
          readonly dropped: number;
          readonly engine: string;
        };
      }
    | null;
  readonly error: string | null;
}
