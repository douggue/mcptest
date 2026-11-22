import { MoneyCheck } from './MoneyCheck';
import { useMoney } from './useMoney';

/**
 * On a channel's own page: what the monetization verdict rests on, where its
 * subscribers stand against the public bars, and the button that checks it.
 */
export function ChannelMoney({ channelId }: { readonly channelId: string }) {
  const verdict = useMoney([channelId]).byId.get(channelId);
  return (
    <section
      aria-label="Monetization"
      className="flex min-w-0 flex-col gap-1 rounded bg-surface-card px-space-md py-space-sm"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-body-sm text-on-surface">
          {verdict ? verdict.says : 'Reading the monetization signs from the store.'}
        </p>
        <MoneyCheck channelIds={[channelId]} />
      </div>
      {verdict && (
        <p className="min-w-0 text-body-sm text-outline">
          {verdict.sign ? `${verdict.sign} ` : 'YouTube does not publish who is monetized. '}
          {verdict.checkedAt ? `Read ${verdict.checkedAt.slice(0, 10)}. ` : ''}
          {verdict.bar.says} (
          {verdict.bar.note.replace(/^Eligibility only: /, 'eligibility only; ')})
        </p>
      )}
    </section>
  );
}
