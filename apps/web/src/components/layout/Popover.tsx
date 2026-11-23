import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** The button's words, such as "Age" or "Age · 2". */
  readonly label: ReactNode;
  /** Something is chosen inside: the button is drawn as in use. */
  readonly active: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}

/** The popover's width, and the gap it keeps from the window's edge. */
const PANEL_WIDTH = 320;
const EDGE = 16;

/** Closes the popover on a press outside it or on Escape. */
function useDismiss(open: boolean, close: () => void, box: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, close, box]);
}

/**
 * A small button that opens a panel under it. The panel opens to the right of
 * the button, or to its left when that would run past the window, so the page
 * never scrolls sideways.
 */
export function Popover({ label, active, open, onOpenChange, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [alignEnd, setAlignEnd] = useState(false);
  useDismiss(open, () => onOpenChange(false), box);
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const left = box.current.getBoundingClientRect().left;
    setAlignEnd(left + PANEL_WIDTH > window.innerWidth - EDGE);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className={`flex min-h-10 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-body-sm transition-colors ${
          active
            ? 'border-primary-container bg-primary-container/15 font-semibold text-primary'
            : 'border-border-subtle text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
        }`}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          className={`absolute top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border-subtle bg-surface-card p-space-md shadow-xl ${
            alignEnd ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
