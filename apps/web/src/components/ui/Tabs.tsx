import { useEffect, useRef, type ReactNode } from 'react';

export interface TabItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  /** A count beside the name, when the screen has one. */
  readonly count?: string;
}

interface Props {
  readonly items: readonly TabItem[];
  /** The key of the one on screen. */
  readonly active: string | null;
  /** What the row is, read aloud. */
  readonly label: string;
}

/** Brings the item on screen into view inside its row; scrolls the row only, never the page. */
function useShown(active: string | null) {
  const current = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const item = current.current;
    const row = item?.parentElement;
    if (!item || !row) return;
    row.scrollLeft = item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2;
  }, [active]);
  return current;
}

/** One row that scrolls sideways on its own on a phone, bleeding to the screen's edges. */
function ScrollRow({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className={`no-scrollbar -mx-4 flex min-w-0 overflow-x-auto pl-4 pr-10 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:mx-0 sm:px-0 sm:[mask-image:none] ${className}`}
    >
      {children}
    </nav>
  );
}

/** The tabs of a place: words on a line, the one on screen underlined in cyan. */
export function Tabs({ items, active, label }: Props) {
  const current = useShown(active);
  return (
    <ScrollRow label={label} className="gap-1 border-b border-line">
      {items.map((item) => {
        const on = item.key === active;
        return (
          <a
            key={item.key}
            ref={on ? current : undefined}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`-mb-px flex min-h-11 flex-none items-center gap-2 whitespace-nowrap border-b-2 px-3.5 pb-0.5 text-body-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal ${
              on
                ? 'border-signal font-semibold text-white'
                : 'border-transparent font-medium text-muted hover:text-ink'
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="text-[13px] font-medium text-dim">{item.count}</span>
            )}
          </a>
        );
      })}
    </ScrollRow>
  );
}

/** The screens or saved views inside a tab: pills, the one on screen filled white. */
export function ViewPills({ items, active, label }: Props) {
  const current = useShown(active);
  return (
    <ScrollRow label={label} className="gap-2">
      {items.map((item) => {
        const on = item.key === active;
        return (
          <a
            key={item.key}
            ref={on ? current : undefined}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={`flex h-10 flex-none items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
              on
                ? 'border-white bg-white font-semibold text-ground'
                : 'border-line font-medium text-muted hover:border-line-2 hover:text-ink'
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={`text-[13px] ${on ? 'text-[#4A5568]' : 'text-dim'}`}>
                {item.count}
              </span>
            )}
          </a>
        );
      })}
    </ScrollRow>
  );
}
