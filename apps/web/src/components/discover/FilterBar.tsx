import { Plus, Search } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { MAX_VIEW_NAME } from '../../lib/videoViews';
import { Popover } from '../layout/Popover';

/** The one bar over the grid: a search field, then the filters as chips, then what is shown. */
export function FilterBar({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-[14px] border border-line bg-card/60 p-2.5"
    >
      {children}
    </div>
  );
}

interface SearchProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  /** What the field is, read aloud. */
  readonly label: string;
}

/** The bar's search field: words every title shown must hold. */
export function SearchField({ value, onChange, placeholder, label }: SearchProps) {
  return (
    <label className="flex h-[38px] min-w-[200px] flex-1 items-center gap-2 rounded-md border border-line bg-white/[0.04] px-3 focus-within:border-signal/50">
      <Search aria-hidden="true" className="h-4 w-4 flex-none text-dim" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        maxLength={100}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-dim focus:outline-none"
      />
    </label>
  );
}

/** A filter that is either on or off, as a chip. */
export function ToggleChip({
  on,
  onToggle,
  children,
}: {
  readonly on: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`flex h-[38px] flex-none items-center whitespace-nowrap rounded-md border px-3 text-body-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
        on
          ? 'border-line-2 bg-white/[0.12] text-white'
          : 'border-line text-muted hover:border-line-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** At the right of the bar: how many are shown, in what order, and the way to clear the filters. */
export function ShownLine({
  text,
  onClear,
}: {
  readonly text: string;
  /** Clears the filters; absent when none is in use. */
  readonly onClear?: (() => void) | undefined;
}) {
  return (
    <p className="ml-auto flex min-w-0 flex-wrap items-center gap-x-3 px-1.5 text-body-sm text-dim">
      <span aria-live="polite">{text}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="rounded font-semibold text-link hover:underline"
        >
          Clear filters
        </button>
      )}
    </p>
  );
}

interface SaveProps {
  /** Why a name cannot be used, or null when it can. */
  readonly problemOf: (name: string) => string | null;
  readonly onSave: (name: string) => void;
}

/** "Save this view": keeps the filters in use under a name, as a view of its own in the row above. */
export function SaveView({ problemOf, onSave }: SaveProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const found = problemOf(name);
    setProblem(found);
    if (found !== null) return;
    onSave(name.trim());
    setName('');
    setOpen(false);
  };
  return (
    <Popover
      label={
        <span className="flex items-center gap-1.5">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Save this view
        </span>
      }
      active={false}
      open={open}
      onOpenChange={setOpen}
    >
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-2">
        <label htmlFor="view-name" className="text-body-sm font-semibold text-ink">
          Name this view
        </label>
        <p className="text-body-sm text-muted">
          It keeps the filters in use now, and sits in the row of views above.
        </p>
        <div className="flex min-w-0 gap-2">
          <input
            id="view-name"
            value={name}
            maxLength={MAX_VIEW_NAME}
            onChange={(event) => setName(event.target.value)}
            placeholder="Small channels over 50×"
            className="h-10 min-w-0 flex-1 rounded-md border border-line bg-ground px-3 text-body-sm text-ink placeholder:text-dim"
          />
          <button
            type="submit"
            className="h-10 flex-none rounded-md border border-line-2 bg-white/[0.12] px-3 text-body-sm font-semibold text-ink hover:bg-white/20"
          >
            Save
          </button>
        </div>
        {problem && (
          <p role="alert" className="text-body-sm text-bad">
            {problem}
          </p>
        )}
      </form>
    </Popover>
  );
}
