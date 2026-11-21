import { CornerUpLeft } from 'lucide-react';
import { originLink, type Origin } from '../lib/flow';

/** One quiet line saying where a thing came from, with a link back to that section. */
export function OriginLine({
  origin,
  what,
  name,
}: {
  readonly origin: Origin;
  /** What came from there, in a few words: "Inspiration", "Title formulas". */
  readonly what: string;
  /** The particular thing, such as a channel's name; optional. */
  readonly name?: string;
}) {
  const { label, href } = originLink(origin);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1 text-body-sm text-outline">
      <CornerUpLeft aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
      {what} from{' '}
      <a href={href} className="text-primary hover:underline">
        {label}
      </a>
      {name ? <span className="text-on-surface-variant">: {name}</span> : null}
    </span>
  );
}
