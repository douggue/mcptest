import { Lock, Mic, Type } from 'lucide-react';
import { breakdownUses, type BreakdownView } from '../lib/breakdownParts';
import { useConnections } from './Connections';

const BUTTON =
  'flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-highest focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container disabled:cursor-not-allowed disabled:opacity-60';

/** What a stored breakdown can be taken into: the script writer's voice, the idea lab, the style lock. */
export function BreakdownUses({ view }: { readonly view: BreakdownView }) {
  const links = useConnections();
  if (links === null) return null;
  const { channel } = view;
  const can = breakdownUses(view);
  const voiceProblem = links.voiceProblem(channel.id);
  const locked = links.styleLock?.from?.id === channel.id;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={voiceProblem !== null}
          title={voiceProblem ?? undefined}
          onClick={() => links.useVoice(channel)}
          className={BUTTON}
        >
          <Mic aria-hidden="true" className="h-4 w-4" />
          Use this channel&rsquo;s voice in the script writer
        </button>
        <button
          type="button"
          disabled={!can.formulas}
          onClick={() => links.useFormulas(channel)}
          className={BUTTON}
        >
          <Type aria-hidden="true" className="h-4 w-4" />
          Add its title formats to ideas
        </button>
        <button
          type="button"
          disabled={!can.styleLock || locked}
          onClick={() => links.useStyleLock(channel)}
          className={BUTTON}
        >
          <Lock aria-hidden="true" className="h-4 w-4" />
          {locked ? 'Its style lock is in use' : 'Use its style lock'}
        </button>
      </div>
      {voiceProblem !== null && <p className="text-body-sm text-outline">{voiceProblem}</p>}
      {!can.styleLock && (
        <p className="text-body-sm text-outline">
          No style lock: the picture part found no consistent picture style, or is not written.
        </p>
      )}
    </div>
  );
}
