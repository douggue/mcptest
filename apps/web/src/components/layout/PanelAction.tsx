import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The look of a side panel's one primary action: full width, in the accent
 * colour. While it cannot be pressed it stays the same button, dimmed, with
 * the reason in a line under it.
 */
export const PANEL_BUTTON =
  'flex min-h-12 w-full items-center justify-center gap-2 rounded bg-primary-container px-4 text-body-md font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

/** The same place, for a run that has been made already: running it again is a quiet choice. */
export const PANEL_BUTTON_QUIET =
  'flex min-h-12 w-full items-center justify-center gap-2 rounded border border-border-subtle px-4 text-body-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-card hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50';

/** Why a button cannot be pressed now, in one line under it; nothing when it can. */
export function DisabledReason({ reason }: { readonly reason: string | null | undefined }) {
  if (!reason) return null;
  // Muted, never amber: amber is kept for breakout scores.
  return <span className="text-center text-body-sm text-muted">{reason}</span>;
}

interface Props {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly icon?: LucideIcon;
  /** One short line under the button, such as how long it takes. */
  readonly note?: ReactNode;
  /** Why it cannot be pressed now; disables it and takes the place of the note. */
  readonly blocked?: string | null;
  /** A run made already: the button is quiet, as the next step is elsewhere. */
  readonly quiet?: boolean;
}

/**
 * A side panel's one action, at its foot, with an optional short line under
 * it. When it cannot be pressed, the line says why.
 */
export function PanelAction(props: Props) {
  const { children, onClick, disabled, icon: Icon, note, blocked, quiet } = props;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={disabled === true || Boolean(blocked)}
        onClick={onClick}
        className={quiet ? PANEL_BUTTON_QUIET : PANEL_BUTTON}
      >
        {Icon && <Icon aria-hidden="true" className="h-4 w-4" />}
        {children}
      </button>
      {blocked ? (
        <DisabledReason reason={blocked} />
      ) : (
        note && <span className="text-center text-body-sm text-outline">{note}</span>
      )}
    </div>
  );
}

/** The title of a side panel and one short line under it. */
export function PanelTitle({
  id,
  title,
  lead,
}: {
  readonly id?: string;
  readonly title: ReactNode;
  readonly lead?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 id={id} className="text-headline-md font-bold text-on-surface">
        {title}
      </h2>
      {lead && <p className="text-body-sm text-on-surface-variant">{lead}</p>}
    </div>
  );
}
