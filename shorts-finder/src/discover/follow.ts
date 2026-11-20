/**
 * Which channels are followed: watched for new uploads day by day, rather
 * than met only when a search happens to return one of their videos. A
 * search costs 100 units and a channel's feed nothing, so following is where
 * a small channel's own history comes from.
 *
 * The two limits below are starting values, set in the settings and meant to
 * be revisited once real readings show where "small" and "new" sit among the
 * channels actually found. Neither describes any niche.
 */
import type { ChannelFacts } from '../youtube/dataApi';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** `SHORTS_FOLLOW_MAX_SUBSCRIBERS` when not set: a starting value, to be revisited on evidence. */
export const DEFAULT_FOLLOW_MAX_SUBSCRIBERS = 100_000;
/** `SHORTS_FOLLOW_MAX_ACCOUNT_AGE_DAYS` when not set: about half a year. A starting value too. */
export const DEFAULT_FOLLOW_MAX_ACCOUNT_AGE_DAYS = 180;
/**
 * A followed channel none of whose uploads has been tracked for 14 days is
 * let go: that is as long as one video is tracked, so by then nothing of the
 * channel is being read and its feed is being polled for nothing. It is
 * followed again the day a search finds it once more.
 */
export const UNFOLLOW_AFTER_DAYS = 14;

export interface FollowSettings {
  /** A channel with a known subscriber count at or under this is followed. */
  readonly maxSubscribers: number;
  /** So is a channel whose account is younger than this many days, whatever its size. */
  readonly maxAccountAgeDays: number;
}

export const DEFAULT_FOLLOW: FollowSettings = {
  maxSubscribers: DEFAULT_FOLLOW_MAX_SUBSCRIBERS,
  maxAccountAgeDays: DEFAULT_FOLLOW_MAX_ACCOUNT_AGE_DAYS,
};

/**
 * Whether a channel is followed, from its facts as just read: small by a
 * known subscriber count, or new by the age of its account. A hidden count is
 * not "small": only the account's age can speak for such a channel.
 */
export function shouldFollow(
  channel: Pick<ChannelFacts, 'subscribers' | 'createdAt'>,
  settings: FollowSettings,
  now: Date,
): boolean {
  const small = channel.subscribers !== null && channel.subscribers <= settings.maxSubscribers;
  const ageDays = (now.getTime() - channel.createdAt.getTime()) / MS_PER_DAY;
  return small || ageDays < settings.maxAccountAgeDays;
}
