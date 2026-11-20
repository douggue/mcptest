import type { NicheChannel, NicheList } from '@jgtube/core';
import { capped, oneDecimal, withoutAbsent } from './results';

export interface NicheSummaryOptions {
  readonly limit: number;
  /** Only the channels the owner marked to watch. */
  readonly watchedOnly: boolean;
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

/** New or small channels with a video that took off, most views on recent uploads first. */
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
