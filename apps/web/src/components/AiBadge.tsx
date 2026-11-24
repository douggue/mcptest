import type { EngineLine } from '../lib/aiBadge';

const dot = (ready: boolean): string =>
  `h-2 w-2 flex-none rounded-full ${ready ? 'bg-primary-container shadow-[0_0_6px_#00d2ff]' : 'bg-outline-variant'}`;

/** One AI engine and whether it is ready, as Settings lists them. */
function Line({ line }: { readonly line: EngineLine }) {
  return (
    <li className="flex items-center justify-between gap-space-md">
      <span className="flex items-center gap-2 text-on-surface">
        <span aria-hidden="true" className={dot(line.ready)} />
        {line.name}
      </span>
      <span className={line.ready ? 'text-primary' : 'text-outline'}>{line.state}</span>
    </li>
  );
}

export { Line as EngineStatusLine };
