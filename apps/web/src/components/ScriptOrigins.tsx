import { Lock } from 'lucide-react';
import { useConnections } from './Connections';
import { QUIET_BUTTON } from './LabStatus';

/**
 * Where the open script comes from: its concept in the idea lab, and the
 * style lock its picture cues are written in, each with a link back.
 */
export function ScriptOrigins({ conceptId }: { readonly conceptId: number }) {
  const links = useConnections();
  const lock = links?.styleLock ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-body-sm text-outline">
      <span>
        Concept from the{' '}
        <a href={`#concept-${conceptId}`} className="text-primary hover:underline">
          idea lab
        </a>
        .
      </span>
      {lock ? (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Lock aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
          Picture cues follow the style lock from{' '}
          <a href="#ask-claude" className="text-primary hover:underline">
            the breakdown of {lock.from?.title ?? 'a channel'}
          </a>
          .
          <button type="button" onClick={links?.stopStyleLock} className={QUIET_BUTTON}>
            Stop using it
          </button>
        </span>
      ) : (
        <span>
          No style lock is in use: picture cues say what to show, in no set style. A channel
          breakdown with a consistent picture style offers one.
        </span>
      )}
    </div>
  );
}
