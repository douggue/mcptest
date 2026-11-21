import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DisabledReason, PANEL_BUTTON } from './PanelAction';

interface Props {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly icon?: LucideIcon;
  /** A submit button of the form it sits in, rather than a plain button. */
  readonly submit?: boolean;
  /** Why it cannot be pressed now, in one line under it; disables it. */
  readonly blocked?: string | null;
}

/**
 * A side panel's one primary action, at its foot: the full width, in the
 * accent colour, as Ideas' "Write 10 ideas". When it cannot be
 * pressed, a line under it says why.
 */
export function PanelButton({ children, onClick, disabled, icon: Icon, submit, blocked }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type={submit ? 'submit' : 'button'}
        onClick={onClick}
        disabled={disabled === true || Boolean(blocked)}
        className={PANEL_BUTTON}
      >
        {Icon && <Icon aria-hidden="true" className="h-4 w-4 flex-none" />}
        {children}
      </button>
      <DisabledReason reason={blocked} />
    </div>
  );
}
