/**
 * The niche watchlist and its sweeps as the API sees them: the owner's
 * keywords, the schedule and the reading budget per day, and "Sweep now",
 * which reads YouTube under the store's lease like a map or a refresh does.
 * The budget is shared with "Find more outliers": what either spends in 24
 * hours counts against the same number.
 */
import {
  SWEEP_MAX_KEYWORDS,
  SqliteSweepRepo,
  addPots,
  leftOf,
  planSweep,
  refusalRestUntil,
  runSweep,
  suggestKeywords,
  sweepAllowance,
  sweepDue,
  sweepOrder,
  tidyKeyword,
  NO_KEYWORDS,
  type BankVideo,
  type FindVia,
  type KeywordView,
  type Pots,
  type StoredSweep,
  type SuggestChannel,
  type SweepAllowance,
  type SweepRepo,
  type SweepRunView,
  type WatchKeyword,
} from '@jgtube/core';
import { BANK_FIND_WINDOW_HOURS } from '@jgtube/core/src/bank/cost';
import { covers, keywordShare, sweepCosts } from '@jgtube/core/src/sweep/budget';
import { findSource } from './bankEngine';
import type { SweepEngine, SweepEngineDeps, SweepRefusal } from './sweepTypes';

const HOUR_MS = 60 * 60 * 1000;

const BUDGET_USED =
  'Today’s reading budget is used. Sweeps start again when the day has passed, or raise the budget.';

const keywordView = (entry: WatchKeyword): KeywordView => ({
  id: entry.id,
  keyword: entry.keyword,
  paused: entry.paused,
  lastSweptAt: entry.lastSweptAt?.toISOString() ?? null,
  found: entry.found,
});

const runView = ({ startedAt, finishedAt, ...sweep }: StoredSweep): SweepRunView => ({
  ...sweep,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt?.toISOString() ?? null,
});

/** The channels on the owner's maps with their topic and titles, from the bank's videos. */
export function mapChannels(videos: readonly BankVideo[]): readonly SuggestChannel[] {
  const byChannel = new Map<string, SuggestChannel>();
  for (const video of videos) {
    if (video.channel.closeness === null) continue;
    const kept = byChannel.get(video.channel.id);
    const one = { title: video.title, score: video.score };
    byChannel.set(video.channel.id, {
      topic: video.channel.topic.label,
      videos: [...(kept?.videos ?? []), one],
    });
  }
  return [...byChannel.values()];
}

const restMessage = (until: Date): string =>
  `YouTube refused the last sweep’s reading, so sweeps rest until ${until.toISOString().slice(0, 16).replace('T', ' ')} UTC. Nothing is tried another way.`;

/** What both pots spent in the last 24 hours, by sweeps and by "Find more outliers". */
function spentToday(deps: SweepEngineDeps, sweeps: SweepRepo): Pots {
  const since = new Date(deps.now().getTime() - BANK_FIND_WINDOW_HOURS * HOUR_MS);
  return addPots(sweeps.spentSince(since), {
    pages: deps.finds.spentSince('pages', since),
    units: deps.finds.spentSince('api', since),
  });
}

export function sweepEngine(deps: SweepEngineDeps): SweepEngine {
  const sweeps = new SqliteSweepRepo(deps.db);
  const via = (): FindVia => (deps.apiKey() === undefined ? 'pages' : 'api');
  const allowance = (how: FindVia): SweepAllowance =>
    sweepAllowance(how, sweeps.settings().pageBudget, spentToday(deps, sweeps));
  const active = (): number => sweepOrder(sweeps.keywords()).length;

  const startProblem = (): SweepRefusal | null => {
    if (active() === 0) return { status: 409, message: NO_KEYWORDS };
    const resting = refusalRestUntil(sweeps.latest(), deps.now());
    if (resting) return { status: 429, message: restMessage(resting) };
    const how = via();
    const costs = sweepCosts(how);
    const share = keywordShare(leftOf(allowance(how)));
    return covers(share, addPots(costs.search, costs.channel))
      ? null
      : { status: 429, message: BUDGET_USED };
  };

  return {
    info() {
      const how = via();
      const allowed = allowance(how);
      const keywords = sweeps.keywords();
      const last = sweeps.latest();
      return {
        via: how,
        keywords: keywords.map(keywordView),
        maxKeywords: SWEEP_MAX_KEYWORDS,
        suggestions: suggestKeywords({
          channels: mapChannels(deps.bankVideos()),
          kept: keywords.map((entry) => entry.keyword),
        }),
        settings: sweeps.settings(),
        budget: allowed,
        plan: planSweep(how, active(), leftOf(allowed)),
        last: last && runView(last),
        restingUntil: refusalRestUntil(last, deps.now())?.toISOString() ?? null,
        cannotStart: startProblem()?.message ?? null,
      };
    },
    addKeyword(keyword) {
      if (sweeps.keywords().length >= SWEEP_MAX_KEYWORDS) return 'full';
      return sweeps.addKeyword(tidyKeyword(keyword), deps.now()) ? 'added' : 'kept';
    },
    removeKeyword: (id) => sweeps.removeKeyword(id),
    setPaused: (id, paused) => sweeps.setPaused(id, paused),
    saveSettings: (settings) => sweeps.saveSettings(settings),
    isDue: () => sweepDue(sweeps.settings(), sweeps.latest(), deps.now()),
    startProblem,
    sweep(startedBy, onProgress) {
      return deps.reading(async () => {
        const how = via();
        const counted = { requests: 0 };
        return runSweep(
          {
            ...deps.repos,
            transact: deps.transact,
            now: deps.now,
            sweeps,
            via: how,
            ...findSource(deps, how, counted),
            ...(how === 'api' ? { apiRequestsMade: () => counted.requests } : {}),
            niches: () =>
              deps
                .nicheList()
                .channels.filter((channel) => channel.qualifies)
                .map((channel) => ({
                  id: channel.id,
                  videoIds: channel.outperformers.map((video) => video.videoId),
                })),
          },
          { startedBy, left: leftOf(allowance(how)) },
          onProgress,
        );
      });
    },
  };
}
