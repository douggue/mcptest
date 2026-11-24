/**
 * The niche watchlist as the page reads it: its part of the local server's
 * API and the words the panel, a card and the other views show. Every number
 * here is one the server stored or counted.
 */
import type {
  NicheChannel,
  NicheFoundBy,
  SweepInfo,
  SweepResult,
  SweepRunView,
  SweepSettings,
} from '@jgtube/core';
import {
  READING_BUDGET_MAX,
  READING_BUDGET_MIN,
  READING_BUDGET_STEP,
} from '@jgtube/core/src/sweep/budget';
import { apiCaller, type Fetch } from './api';

export type { SweepInfo, SweepResult, SweepRunView };
export const SWEEP_PATH = '/api/niches/sweep';

const DAY_MS = 24 * 60 * 60 * 1000;
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const plural = (count: number, one: string, many = `${one}s`): string =>
  `${whole.format(count)} ${count === 1 ? one : many}`;

/** What a sweep started now can cost at most, in one line, said before it starts. */
export function costLine(info: SweepInfo): string {
  const { plan } = info;
  if (plan.keywords === 0) return 'Add a keyword to see what a sweep would read.';
  const pages = plural(plan.most.pages, 'page request');
  if (plan.via === 'api') {
    return `Up to ${whole.format(plan.most.units)} units of your API key and ${pages} for ${plural(plan.keywords, 'keyword')}.`;
  }
  return plan.keywordsCovered < plan.keywords
    ? `Up to ${pages}, signed out, at the usual pace. Today’s budget covers about ${plan.keywordsCovered} of ${plan.keywords} keywords; the rest wait for the next sweep.`
    : `Up to ${pages} for ${plural(plan.keywords, 'keyword')}, signed out, at the usual pace.`;
}

/** Today's budget: used and left. */
export function budgetLine(info: SweepInfo): string {
  const { pages, units } = info.budget;
  const line = `${whole.format(pages.used)} of ${whole.format(pages.cap)} page requests used today · ${whole.format(pages.left)} left`;
  return units === null
    ? line
    : `${line} · API units: ${whole.format(units.used)} of ${whole.format(units.cap)} used`;
}

/** The budgets offered, least to most, with the saved one among them. */
export function budgetOptions(saved: number): readonly number[] {
  const steps: number[] = [];
  for (let value = READING_BUDGET_MIN; value <= READING_BUDGET_MAX; value += READING_BUDGET_STEP) {
    steps.push(value);
  }
  return [...new Set([...steps, saved])].sort((a, b) => a - b);
}

const SCHEDULE_DAYS = [1, 2, 3, 7, 14, 30];

/** The schedule choices: off, daily, every few days, and the saved one. */
export function scheduleOptions(
  saved: number | null,
): readonly { readonly value: string; readonly label: string }[] {
  const days = [...new Set([...SCHEDULE_DAYS, ...(saved === null ? [] : [saved])])].sort(
    (a, b) => a - b,
  );
  return [
    { value: 'off', label: 'Off' },
    ...days.map((count) => ({
      value: String(count),
      label: count === 1 ? 'Every day' : `Every ${count} days`,
    })),
  ];
}

export const scheduleValue = (everyDays: number | null): string =>
  everyDays === null ? 'off' : String(everyDays);

export const scheduleDays = (value: string): number | null =>
  value === 'off' ? null : Number(value);

/** When a keyword was last swept, in a few words. */
export function sweptText(lastSweptAt: string | null, now: Date): string {
  if (lastSweptAt === null) return 'Not swept yet';
  const days = Math.floor((now.getTime() - new Date(lastSweptAt).getTime()) / DAY_MS);
  if (days <= 0) return 'Swept today';
  return days === 1 ? 'Swept yesterday' : `Swept ${days} days ago`;
}

const spendText = (run: Pick<SweepRunView, 'via' | 'requests' | 'apiUnits'>): string =>
  run.via === 'api'
    ? `${plural(run.apiUnits, 'API unit')} and ${plural(run.requests, 'page request')}`
    : plural(run.requests, 'page request');

/** The line "N new niche channels found"; null for none. */
export const newNichesLine = (count: number): string | null =>
  count > 0 ? `${plural(count, 'new niche channel')} found` : null;

/** The last sweep in one line: what it found, what it spent, and why it stopped early. */
export function sweepHeadline(run: SweepRunView): string {
  if (run.summary === null) return 'The last sweep was cut off before it finished.';
  const found = newNichesLine(run.summary.newNiches) ?? 'no new niche channels found';
  const parts = [`Last sweep: ${found}`, spendText(run), ...(run.message ? [run.message] : [])];
  return parts.join(' · ');
}

export interface SummaryRow {
  readonly name: string;
  readonly read: number;
  readonly qualified: number;
  readonly requests: string;
}

const spentOn = (requests: number, apiUnits: number): string =>
  apiUnits > 0
    ? `${plural(apiUnits, 'unit')}, ${plural(requests, 'request')}`
    : plural(requests, 'request');

/** The sweep's summary as rows: each keyword, then the snowball when it read anything. */
export function summaryRows(run: SweepRunView): readonly SummaryRow[] {
  if (run.summary === null) return [];
  const { keywords, snowball } = run.summary;
  const rows = keywords.map((one) => ({
    name: one.keyword,
    read: one.channelsRead,
    qualified: one.qualified,
    requests: spentOn(one.requests, one.apiUnits),
  }));
  if (snowball.sources === 0) return rows;
  return [
    ...rows,
    {
      name: `Snowball from ${plural(snowball.sources, 'new niche')}`,
      read: snowball.channelsRead,
      qualified: snowball.qualified,
      requests: spentOn(snowball.requests, snowball.apiUnits),
    },
  ];
}

/** How a listed channel was found, as the card's line; null when nothing is recorded. */
export function foundByText(foundBy: NicheFoundBy | null): string | null {
  if (foundBy === null) return null;
  if (foundBy.kind === 'keyword') return `Found by “${foundBy.keyword}”`;
  if (foundBy.kind === 'map') return 'Found by your map';
  return `Found by snowball from ${foundBy.fromTitle ?? 'a new niche'}`;
}

/** The channels the last sweep brought in, when only those are asked for. */
export const onlyNew = (
  channels: readonly NicheChannel[],
  only: boolean,
): readonly NicheChannel[] =>
  only ? channels.filter((channel) => channel.newSinceSweep) : channels;

export interface SweepJob {
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: { readonly text?: string } | null;
  readonly result: SweepResult | null;
  readonly error: string | null;
}

export type SweepReply = SweepInfo & { readonly jobId: string | null };

export function createSweepApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  const change = async (path: string, body: unknown): Promise<SweepReply> =>
    unwrap<SweepReply>(await send(path, body));
  return {
    async info(): Promise<SweepReply> {
      return unwrap<SweepReply>(await call(SWEEP_PATH));
    },
    addKeyword: (keyword: string) => change(`${SWEEP_PATH}/keywords`, { action: 'add', keyword }),
    changeKeyword: (action: 'remove' | 'pause' | 'resume', id: number) =>
      change(`${SWEEP_PATH}/keywords`, { action, id }),
    saveSettings: (settings: SweepSettings) => change(`${SWEEP_PATH}/settings`, settings),
    /** Starts a sweep and answers its job. */
    async start(): Promise<string> {
      return unwrap<{ jobId: string }>(await send(SWEEP_PATH, {})).jobId;
    },
    async job(id: string): Promise<SweepJob> {
      return unwrap<SweepJob>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
  };
}

export type SweepApi = ReturnType<typeof createSweepApi>;
