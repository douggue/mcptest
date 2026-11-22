import { BADGE_TONE, moneyTooltip } from '../lib/money';
import { useMoney } from './useMoney';

interface Props {
  readonly channelId: string;
  /** Leaves the badge out while the channel was never checked, where space is short. */
  readonly hideUnchecked?: boolean;
}

/**
 * Whether a channel earns from YouTube as far as public signs show: "$ Monetized",
 * "$? Likely", "Not yet" or "Not checked", with the sign and the day it was read
 * in its tooltip.
 */
export function MoneyBadge({ channelId, hideUnchecked }: Props) {
  const { byId } = useMoney([channelId]);
  const verdict = byId.get(channelId);
  if (!verdict || (hideUnchecked && verdict.status === 'not-checked')) return null;
  const tip = moneyTooltip(verdict);
  return (
    <span
      title={tip}
      aria-label={`Monetization: ${tip}`}
      className={`inline-flex flex-none items-center whitespace-nowrap rounded-full px-2 py-0.5 text-label ${BADGE_TONE[verdict.status]}`}
    >
      {verdict.short}
    </span>
  );
}
