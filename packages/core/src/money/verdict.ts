/**
 * Whether a channel earns from YouTube, as far as public signs show. YouTube
 * does not publish who is in its Partner Program, so the verdict never says
 * more than the stored signs support, and each verdict names the sign it rests
 * on. The subscriber bar beside it is eligibility only: the watch hours and
 * Shorts views the program also asks for are not public.
 */
import type { AdsSeen } from './watchSigns';

export type MoneyStatus = 'monetized' | 'likely' | 'not-yet' | 'not-checked';
export type MoneyBarKey = 'over-1000' | 'over-500' | 'under-500' | 'hidden';

/** What one check of a channel found, as stored. */
export interface StoredMoneySigns {
  readonly channelId: string;
  /** The video whose watch page was read. */
  readonly videoId: string;
  readonly memberships: boolean;
  readonly ads: AdsSeen;
  readonly checkedAt: Date;
}

export interface MoneyBar {
  readonly key: MoneyBarKey;
  readonly says: string;
  /** The stored count the bar was read from; null when hidden or never read. */
  readonly subscribers: number | null;
  readonly note: string;
}

export interface MoneyVerdict {
  readonly channelId: string;
  readonly status: MoneyStatus;
  /** The verdict in words, such as "Monetized (sign: memberships)". */
  readonly says: string;
  /** The badge text: "$ Monetized", "$? Likely", "Not yet", "Not checked". */
  readonly short: string;
  /** The sign the verdict rests on, in a sentence; null when never checked. */
  readonly sign: string | null;
  /** When the signs were read, as ISO-8601; null when never. */
  readonly checkedAt: string | null;
  /** The video whose page was read; null when never checked. */
  readonly videoId: string | null;
  readonly bar: MoneyBar;
}

/** Ad revenue sharing opens at 1,000 subscribers; fan funding (memberships) at 500. */
export const FULL_BAR = 1_000;
export const LOWER_BAR = 500;

const BAR_NOTE =
  'Eligibility only: the Partner Program also asks for watch hours or Shorts views, which are not public.';

const SIGNS = {
  memberships:
    'Its watch page offers a Join button (channel memberships), which needs the YouTube Partner Program.',
  ads: 'Its watch page showed ads. YouTube can show ads on channels outside the Partner Program, so this is not proof.',
  noJoin: 'No Join button on its watch page',
} as const;

const ADS_NOTE: Readonly<Record<AdsSeen, string>> = {
  shown: '',
  none: '; no ads were shown.',
  unknown: '; ads could not be seen (YouTube would not play the video to a signed-out reader).',
};

interface Subscribers {
  readonly subscribers: number | null;
  readonly subscribersHidden: boolean;
}

/** Where the stored subscriber count stands against the Partner Program's public bars. */
export function moneyBar({ subscribers, subscribersHidden }: Subscribers): MoneyBar {
  if (subscribersHidden || subscribers === null) {
    return { key: 'hidden', says: 'Subscriber count hidden', subscribers: null, note: BAR_NOTE };
  }
  if (subscribers >= FULL_BAR) {
    return { key: 'over-1000', says: '1,000+ subscribers', subscribers, note: BAR_NOTE };
  }
  if (subscribers >= LOWER_BAR) {
    return { key: 'over-500', says: '500 to 999 subscribers', subscribers, note: BAR_NOTE };
  }
  return { key: 'under-500', says: 'Under the 500 bar', subscribers, note: BAR_NOTE };
}

type Judged = Pick<MoneyVerdict, 'status' | 'says' | 'short' | 'sign'>;

function judge(signs: StoredMoneySigns | null): Judged {
  if (signs === null) {
    return { status: 'not-checked', says: 'Not checked', short: 'Not checked', sign: null };
  }
  if (signs.memberships) {
    return {
      status: 'monetized',
      says: 'Monetized (sign: memberships)',
      short: '$ Monetized',
      sign: SIGNS.memberships,
    };
  }
  if (signs.ads === 'shown') {
    return {
      status: 'likely',
      says: 'Likely monetized (ads shown; not proof)',
      short: '$? Likely',
      sign: SIGNS.ads,
    };
  }
  return {
    status: 'not-yet',
    says: 'Not monetized yet as far as public signs show',
    short: 'Not yet',
    sign: `${SIGNS.noJoin}${ADS_NOTE[signs.ads]}`,
  };
}

/** The verdict for one stored channel from its stored signs (null when never checked). */
export function moneyVerdict(
  channel: Subscribers & { readonly id: string },
  signs: StoredMoneySigns | null,
): MoneyVerdict {
  return {
    channelId: channel.id,
    ...judge(signs),
    checkedAt: signs ? signs.checkedAt.toISOString() : null,
    videoId: signs ? signs.videoId : null,
    bar: moneyBar(channel),
  };
}
