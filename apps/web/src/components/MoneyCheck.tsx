import { useState } from 'react';
import { QUIET_BUTTON } from './LabStatus';
import { moneyStore, useMoney } from './useMoney';

interface Props {
  /** The channels to check: one on a channel's page, the shown ones on a list. */
  readonly channelIds: readonly string[];
  readonly label?: string;
}

/**
 * A quiet button that reads one watch page per channel for the signs of
 * earning, and says what went wrong when something did.
 */
export function MoneyCheck({ channelIds, label = 'Check monetization' }: Props) {
  const { checking, problem } = useMoney(channelIds);
  const [problems, setProblems] = useState<readonly string[]>([]);
  const busy = channelIds.some((id) => checking.has(id));
  if (channelIds.length === 0) return null;
  const run = async (): Promise<void> => {
    setProblems([]);
    const found = await moneyStore.check(channelIds);
    setProblems(found.map((one) => one.reason));
  };
  const said = [...new Set([...(problem ? [problem] : []), ...problems])];
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        title="Reads one public watch page per channel for a Join button (memberships) and ads."
        className={QUIET_BUTTON}
      >
        {busy ? 'Checking…' : label}
      </button>
      {said.length > 0 && (
        <span role="status" className="min-w-0 text-body-sm text-outline">
          {said.join(' ')}
        </span>
      )}
    </span>
  );
}
