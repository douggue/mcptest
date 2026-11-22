/**
 * Checking channels for the public signs of earning: one watch page per
 * channel, of its newest stored video, read through the source's limiter.
 * What it shows is stored with when it was read; the verdict is worked out
 * from the store at each look (`loadMoneyVerdicts`).
 */
import type { ChannelRepo, MoneyRepo, StoredVideo, VideoRepo } from '../repos/types';
import type { WatchPageSource } from '../sources/types';
import { moneyVerdict, type MoneyVerdict } from './verdict';
import { readWatchSigns } from './watchSigns';

/** One press checks at most this many channels: ten pages, a few seconds at the source's pace. */
export const MAX_CHECK_CHANNELS = 10;
const MAX_REASON_CHARS = 200;

export interface MoneyDeps {
  readonly channels: Pick<ChannelRepo, 'findById'>;
  readonly videos: Pick<VideoRepo, 'listByChannel'>;
  readonly money: MoneyRepo;
  readonly source: WatchPageSource;
  readonly now: () => Date;
}

export interface MoneyProblem {
  readonly channelId: string;
  readonly reason: string;
}

export interface MoneyCheckOutcome {
  readonly verdicts: readonly MoneyVerdict[];
  readonly problems: readonly MoneyProblem[];
  /** True when it stopped before the last channel because it was asked to. */
  readonly stoppedEarly: boolean;
}

export interface MoneyCheckOptions {
  readonly shouldStop?: () => boolean;
}

const newest = (videos: readonly StoredVideo[]): StoredVideo | null =>
  videos.reduce<StoredVideo | null>(
    (best, video) =>
      best === null || video.published.date.getTime() > best.published.date.getTime()
        ? video
        : best,
    null,
  );

/** The first line of an error, cut short: no stack, no path below it. */
const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .split('\n')[0]!
    .slice(0, MAX_REASON_CHARS);

type One = { readonly verdict: MoneyVerdict } | { readonly reason: string };

async function checkOne(deps: MoneyDeps, channelId: string): Promise<One> {
  const channel = deps.channels.findById(channelId);
  if (!channel) return { reason: 'This channel is not stored yet.' };
  const video = newest(deps.videos.listByChannel(channelId));
  if (!video) return { reason: 'It has no stored video whose page could be read.' };
  const signs = readWatchSigns(await deps.source.fetchWatchHtml(video.id));
  if (signs.ownerId === null) {
    return { reason: 'YouTube’s page could not be read (it may have shown a consent page).' };
  }
  if (signs.ownerId !== channelId) {
    return { reason: 'The page read belonged to another channel, so nothing was kept.' };
  }
  const stored = {
    channelId,
    videoId: video.id,
    memberships: signs.memberships,
    ads: signs.ads,
    checkedAt: deps.now(),
  };
  deps.money.save(stored);
  return { verdict: moneyVerdict(channel, stored) };
}

/** Checks each channel once, in order, up to `MAX_CHECK_CHANNELS`; a failure is that channel's alone. */
export async function checkMoney(
  deps: MoneyDeps,
  channelIds: readonly string[],
  options: MoneyCheckOptions = {},
): Promise<MoneyCheckOutcome> {
  const ids = [...new Set(channelIds)].slice(0, MAX_CHECK_CHANNELS);
  const verdicts: MoneyVerdict[] = [];
  const problems: MoneyProblem[] = [];
  for (const channelId of ids) {
    if (options.shouldStop?.()) return { verdicts, problems, stoppedEarly: true };
    try {
      const one = await checkOne(deps, channelId);
      if ('verdict' in one) verdicts.push(one.verdict);
      else problems.push({ channelId, reason: one.reason });
    } catch (error) {
      problems.push({ channelId, reason: reasonOf(error) });
    }
  }
  return { verdicts, problems, stoppedEarly: false };
}

/** The verdicts of the stored channels among `channelIds`, from the store only; unknown ids are left out. */
export function loadMoneyVerdicts(
  deps: Pick<MoneyDeps, 'channels' | 'money'>,
  channelIds: readonly string[],
): readonly MoneyVerdict[] {
  const ids = [...new Set(channelIds)];
  const signs = deps.money.findMany(ids);
  return ids.flatMap((id) => {
    const channel = deps.channels.findById(id);
    return channel ? [moneyVerdict(channel, signs.get(id) ?? null)] : [];
  });
}
