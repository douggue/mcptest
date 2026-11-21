import type { MoneyVerdict } from '@jgtube/core';
import { withoutAbsent } from './results';

/** The part of each tool's description that explains `money`. */
export const MONEY_TEXT =
  'money is whether the channel earns from YouTube as far as public signs show, never a certainty (YouTube does ' +
  'not publish who is in its Partner Program): says is the verdict, sign the public sign it rests on, at when ' +
  'its watch page was read (the app reads one on the owner’s request; this tool reads nothing for it), bar where ' +
  'the stored subscriber count stands against the 500 and 1,000 bars (eligibility only: watch hours are not public).';

/** One channel's verdict in the short keys the tools use. */
export function moneyFacts(verdict: MoneyVerdict | undefined): Record<string, unknown> | undefined {
  if (verdict === undefined) return undefined;
  return withoutAbsent({
    says: verdict.says,
    sign: verdict.sign,
    at: verdict.checkedAt,
    bar: verdict.bar.says,
  });
}

/** The verdicts by channel id, for a list. */
export const moneyById = (verdicts: readonly MoneyVerdict[]): ReadonlyMap<string, MoneyVerdict> =>
  new Map(verdicts.map((verdict) => [verdict.channelId, verdict]));
