import type { NicheChannel, NicheList, RateTier } from '@jgtube/core';
import { capped, oneDecimal, withoutAbsent } from './results';

export interface NicheSummaryOptions {
  readonly limit: number;
  /** Only the channels the owner marked to watch. */
  readonly watchedOnly: boolean;
}

const UNNAMED_SCRIPT = 'another alphabet';

/** Which ad-rate tier the earnings were worked out at, in words. */
function adRate(tier: RateTier): string {
  return tier.id === 'unknown' || tier.country === null
    ? 'top rate assumed: country unknown'
    : `${tier.id} (${tier.country}), ${tier.multiplier} of the top rate`;
}

function nicheEntry(niche: NicheChannel): Record<string, unknown> {
  const topIds = new Set(niche.outperformers.map((video) => video.videoId));
  // The sample titles often repeat the outperformers; only the others add anything.
  const otherTitles = niche.sampleTitles
    .filter((sample) => !topIds.has(sample.videoId))
    .map((sample) => sample.title);
  return withoutAbsent({
    id: niche.id,
    title: niche.title,
    handle: niche.handle,
    subs: niche.subscribers,
    recentViews: niche.recentViews,
    uploads: niche.recentUploads,
    viewsPerSub: niche.viewsPerSubscriber === null ? null : oneDecimal(niche.viewsPerSubscriber),
    earnsUsd: [niche.earnings.low, niche.earnings.high],
    views90d: niche.ninetyDayViews,
    uploads90d: niche.ninetyDayUploads,
    earns90dUsd: [niche.ninetyDayEarnings.low, niche.ninetyDayEarnings.high],
    adRate: adRate(niche.earnings.rateTier),
    notPaidYet: niche.earnings.belowAdThreshold ? true : null,
    country: niche.country,
    otherLanguage: niche.otherLanguage ? (niche.otherLanguage.script ?? UNNAMED_SCRIPT) : null,
    channelAgeDays: niche.channelAgeDays === null ? null : Math.round(niche.channelAgeDays),
    why: niche.reasons,
    hits: `${niche.hitCount}/${niche.scoredCount}`,
    watched: niche.watched ? true : null,
    qualifies: niche.qualifies ? null : false,
    top: niche.outperformers.map((video) =>
      withoutAbsent({
        video: video.videoId,
        title: video.title,
        views: video.views,
        score: video.score === null ? null : oneDecimal(video.score),
      }),
    ),
    titles: otherTitles.length > 0 ? otherTitles : null,
  });
}

/** New or small channels with a video that took off, most views on the last 90 days' uploads first. */
export function summarizeNiches(
  list: NicheList,
  options: NicheSummaryOptions,
): Record<string, unknown> {
  const wanted = list.channels.filter((niche) => niche.watched || !options.watchedOnly);
  const { shown, more } = capped(wanted, options.limit);
  return {
    checked: list.channelsChecked,
    smallMaxSubs: list.smallMaxSubscribers,
    newMaxAgeDays: list.newMaxAgeDays,
    shown: shown.length,
    ...(more > 0 ? { more } : {}),
    niches: shown.map(nicheEntry),
  };
}
