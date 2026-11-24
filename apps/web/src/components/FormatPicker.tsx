import { CheckCircle2, Copy, Plus, Star, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { lengthText, secondsFrom, type FormatView } from '../lib/formatBuilder';
import { FIELD, QUIET_BUTTON } from './LabStatus';
import type { FormatBuilder } from './useFormatBuilder';

const SMALL =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface';

/** A new format: a name and, if the owner likes, the length it is for. */
export function NewFormat({ builder }: { readonly builder: FormatBuilder }) {
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const seconds = secondsFrom(minutes);
    if (seconds === 'bad') return setProblem('Give the length in minutes, such as 10 or 0.75.');
    void builder.create(name, seconds).then((reason) => {
      setProblem(reason);
      if (reason === null) {
        setName('');
        setMinutes('');
      }
    });
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-wrap items-end gap-space-sm">
      <label className="flex min-w-0 flex-[2_1_12rem] flex-col gap-1">
        <span className="text-label text-outline">New format</span>
        <input
          value={name}
          maxLength={60}
          placeholder="Long-form, Shorts…"
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </label>
      <label className="flex min-w-0 flex-[1_1_7rem] flex-col gap-1">
        <span className="text-label text-outline">Length (minutes)</span>
        <input
          value={minutes}
          inputMode="decimal"
          onChange={(event) => setMinutes(event.target.value)}
          className={FIELD}
        />
      </label>
      <button type="submit" disabled={name.trim() === ''} className={`${QUIET_BUTTON} min-h-11`}>
        <Plus aria-hidden="true" className="mr-1 inline h-4 w-4" />
        Make it
      </button>
      {problem && <p className="basis-full text-body-sm text-error">{problem}</p>}
    </form>
  );
}

/** The name and planned length of the format, changed when the field is left. */
function NameAndLength({
  format,
  builder,
}: {
  readonly format: FormatView;
  readonly builder: FormatBuilder;
}) {
  const [name, setName] = useState(format.name);
  const minutesOf = (seconds: number | null) => (seconds === null ? '' : String(seconds / 60));
  const [minutes, setMinutes] = useState(minutesOf(format.targetSeconds));
  const [notes, setNotes] = useState(format.notes);
  const saveLength = () => {
    const seconds = secondsFrom(minutes);
    if (seconds !== 'bad' && seconds !== format.targetSeconds) {
      void builder.change({ targetSeconds: seconds });
    }
  };
  return (
    <div className="flex min-w-0 flex-wrap gap-space-sm">
      <label className="flex min-w-0 flex-[2_1_12rem] flex-col gap-1">
        <span className="text-label text-outline">Name</span>
        <input
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() !== '' && name !== format.name && void builder.change({ name })}
          className={FIELD}
        />
      </label>
      <label className="flex min-w-0 flex-[1_1_7rem] flex-col gap-1">
        <span className="text-label text-outline">Length (minutes)</span>
        <input
          value={minutes}
          inputMode="decimal"
          onChange={(event) => setMinutes(event.target.value)}
          onBlur={saveLength}
          className={FIELD}
        />
      </label>
      <label className="flex min-w-0 basis-full flex-col gap-1">
        <span className="text-label text-outline">Notes on this format</span>
        <textarea
          value={notes}
          rows={2}
          maxLength={4000}
          placeholder="What this format is for, what to try next"
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => notes !== format.notes && void builder.change({ notes })}
          className={FIELD}
        />
      </label>
    </div>
  );
}

/** Which format is being built, and its name, length, copy and removal. */
export function FormatPicker({ builder }: { readonly builder: FormatBuilder }) {
  const { state, chosen } = builder;
  const formats = state.status === 'ready' ? state.formats : [];
  if (chosen === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-[1_1_14rem] flex-col gap-1">
          <span className="text-label text-outline">Format</span>
          <select
            value={chosen.id}
            onChange={(event) => builder.choose(Number(event.target.value))}
            className={FIELD}
          >
            {formats.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name} · {lengthText(one.targetSeconds)}
                {one.active ? ' · active' : ''}
              </option>
            ))}
          </select>
        </label>
        {builder.canActivate && (
          <button
            type="button"
            aria-pressed={chosen.active}
            onClick={() => builder.setActive(!chosen.active)}
            className={`${SMALL} self-end ${chosen.active ? 'text-primary' : ''}`}
            title={
              chosen.active
                ? 'Ideas, scripts and thumbnail prompts follow this format. Press to stop.'
                : 'Have Ideas, scripts and thumbnail prompts follow this format.'
            }
          >
            {chosen.active ? (
              <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Star aria-hidden="true" className="h-4 w-4" />
            )}
            {chosen.active ? 'Active for this channel' : 'Make active'}
          </button>
        )}
        <button type="button" onClick={builder.duplicate} className={`${SMALL} self-end`}>
          <Copy aria-hidden="true" className="h-4 w-4" />
          Copy as next version
        </button>
        <button type="button" onClick={builder.remove} className={`${SMALL} self-end`}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Remove
        </button>
      </div>
      <NameAndLength key={chosen.id} format={chosen} builder={builder} />
    </div>
  );
}
