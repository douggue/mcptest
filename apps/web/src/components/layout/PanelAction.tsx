import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** The look of a side panel's one primary action: full width, in the accent colour. */
export const PANEL_BUTTON =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container py-2.5 text-body-md font-semibold text-on-primary shadow-[0_0_12px_rgba(0,210,255,0.35)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';

interface Props {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly icon?: LucideIcon;
  /** One short line under the button, such as how long it takes. */
  readonly note?: ReactNode;
}

/** A side panel's one primary action, at its foot, with an optional short line under it. */
export function PanelAction({ children, onClick, disabled, icon: Icon, note }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" disabled={disabled} onClick={onClick} className={PANEL_BUTTON}>
        {Icon && <Icon aria-hidden="true" className="h-4 w-4" />}
        {children}
      </button>
      {note && <span className="text-center text-body-sm text-outline">{note}</span>}
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
