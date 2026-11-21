import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly icon?: LucideIcon;
  /** A submit button of the form it sits in, rather than a plain button. */
  readonly submit?: boolean;
}

/**
 * A side panel's one primary action, at its foot: the full width, in the
 * accent colour, as the idea lab's "Write 10 concepts".
 */
export function PanelButton({ children, onClick, disabled, icon: Icon, submit }: Props) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container px-4 py-2.5 text-body-md font-semibold text-on-primary shadow-[0_0_12px_rgba(0,210,255,0.35)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
    >
      {Icon && <Icon aria-hidden="true" className="h-4 w-4 flex-none" />}
      {children}
    </button>
  );
}
