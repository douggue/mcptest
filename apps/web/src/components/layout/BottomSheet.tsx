import { useEffect, type ReactNode } from 'react';

interface Props {
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Shown at the foot, beside Done, such as "Clear filters". */
  readonly footer?: ReactNode;
}

/** A panel that rises from the foot of a phone's screen, over a dimmed page. */
export function BottomSheet({ title, open, onClose, children, footer }: Props) {
  useEffect(() => {
    if (!open) return undefined;
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-space-deep/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85vh] min-w-0 flex-col rounded-t-xl border-t border-border-subtle bg-surface-card"
      >
        <h3 className="px-gutter pt-space-md text-headline-md text-on-surface">{title}</h3>
        <div className="flex min-w-0 flex-col gap-space-lg overflow-y-auto px-gutter py-space-md">
          {children}
        </div>
        <div className="flex items-center justify-between gap-space-sm border-t border-border-subtle px-gutter py-space-sm">
          {footer ?? <span />}
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full bg-primary-container px-5 text-body-sm font-semibold text-space-deep"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
