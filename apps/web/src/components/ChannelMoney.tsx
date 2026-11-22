import { Details } from './layout/Details';
import { MoneyCheck } from './MoneyCheck';
import { useMoney } from './useMoney';

/**
 * On a channel's own page: the monetization verdict in one line beside the
 * button that checks it; what it rests on and where the subscribers stand
 * against the public bars sit behind How this works.
 */
export function ChannelMoney({ channelId }: { readonly channelId: string }) {
  const verdict = useMoney([channelId]).byId.get(channelId);
  return (
    <section
      aria-label="Monetization"
      className="flex min-w-0 flex-col gap-1 rounded bg-surface-card px-space-md py-space-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="min-w-0 text-body-md text-on-surface">
          Monetization: <span className="font-semibold">{verdict ? verdict.short : '…'}</span>
        </p>
        <MoneyCheck channelIds={[channelId]} label="Check" />
      </div>
      {verdict && (
        <Details summary="How this works">
          <p className="min-w-0 text-body-sm text-on-surface-variant">
            {verdict.says}.{' '}
            {verdict.sign ? `${verdict.sign} ` : 'YouTube does not publish who is monetized. '}
            {verdict.checkedAt ? `Read ${verdict.checkedAt.slice(0, 10)}. ` : ''}
            {verdict.bar.says} ({verdict.bar.note})
          </p>
        </Details>
      )}
    </section>
  );
}
