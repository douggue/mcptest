import { Sparkles } from 'lucide-react';
import { shortSectionLine, type ShortSection } from '../lib/scriptWriter';

interface Props {
  readonly sections: readonly ShortSection[];
  /** The beat sheet was rewritten after the draft: the draft is to be written again. */
  readonly stale: boolean;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  readonly onWriteAgain: () => void;
}

/**
 * The sections of the draft that came out short of their share of the
 * length, counted by the app, with the button that has an AI write those
 * sections again and leaves the rest of the draft as it is.
 */
export function ShortSections({ sections, stale, busy, onWriteAgain }: Props) {
  if (stale) {
    return (
      <p
        role="status"
        className="rounded border border-border-subtle bg-space-deep p-space-lg text-body-sm text-on-surface"
      >
        The draft was written from an older beat sheet: its sections are not the beats you have now.
        Write the draft again.
      </p>
    );
  }
  if (sections.length === 0) return null;
  return (
    <section
      aria-label="Sections of the draft that are short"
      className="flex min-w-0 flex-col gap-space-sm rounded border border-border-subtle bg-space-deep p-space-lg"
    >
      <h4 className="text-body-md font-bold text-on-surface">
        {sections.length === 1
          ? 'One section is short of its share of the length, or missing'
          : `${sections.length} sections are short of their share of the length, or missing`}
      </h4>
      <ul className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
        {sections.map((section) => (
          <li key={section.section}>{shortSectionLine(section)}</li>
        ))}
      </ul>
      <p className="text-body-sm text-outline">
        Counted by the app from the words under each heading. Writing them again changes only these
        sections; the hook and the rest of the draft stay as they are.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onWriteAgain}
        className="flex min-h-11 w-fit items-center gap-2 rounded border border-border-subtle px-4 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        Write the short sections again
      </button>
    </section>
  );
}
