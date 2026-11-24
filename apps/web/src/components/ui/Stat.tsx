import type { ReactNode } from 'react';

interface StatProps {
  readonly label: string;
  /** The number, already written as it should read. */
  readonly value: ReactNode;
  /** One line saying what the number rests on. */
  readonly note?: ReactNode;
  /** A breakout count or score: the number is amber. */
  readonly score?: boolean;
}

/** One number: its label, the number large, and one line saying what it rests on. */
export function Stat({ label, value, note, score }: StatProps) {
  return (
    <div className="min-w-0 bg-card px-4 py-3.5 sm:px-5 sm:py-[18px]">
      <div className="truncate text-body-sm text-muted">{label}</div>
      <div
        className={`mt-0.5 truncate text-[26px] font-[650] leading-8 tracking-tight sm:text-headline-lg ${score ? 'text-score' : 'text-ink'}`}
      >
        {value}
      </div>
      {note !== undefined && <div className="truncate text-body-sm text-dim">{note}</div>}
    </div>
  );
}

const COLUMNS: Readonly<Record<number, string>> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

/** A strip of numbers in one frame, two across on a phone. */
export function Stats({
  children,
  columns,
}: {
  readonly children: ReactNode;
  /** How many numbers sit side by side on a wide screen. */
  readonly columns: 2 | 3 | 4 | 5 | 6;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line ${COLUMNS[columns]}`}
    >
      {children}
    </div>
  );
}
