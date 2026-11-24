import type { IngredientLayer } from '@jgtube/core';
import { useState, type FormEvent } from 'react';
import type { IngredientSourceRequest } from '../lib/formatApi';
import { INGREDIENT_LAYERS, LAYER_LABELS, imageProblem } from '../lib/formatShelf';
import { uploadBreakdownFile, uploadFormatImage } from '../lib/upload';
import { fileProblem, fileType } from '../lib/videoBreakdown';
import { Field } from './layout/Card';
import { Segmented } from './layout/Segmented';
import { FIELD, QUIET_BUTTON } from './LabStatus';

type Kind = 'link' | 'note' | 'image' | 'clip';

const KINDS: readonly { readonly value: Kind; readonly label: string }[] = [
  { value: 'link', label: 'Link' },
  { value: 'note', label: 'Note' },
  { value: 'image', label: 'Picture' },
  { value: 'clip', label: 'Clip' },
];

interface Props {
  readonly onAdd: (source: IngredientSourceRequest) => Promise<string | null>;
}

interface Draft {
  readonly layer: IngredientLayer;
  readonly name: string;
  readonly text: string;
  readonly file: File | null;
}

const EMPTY: Draft = { layer: 'visual', name: '', text: '', file: null };

/** Sends a picture or a clip first, then names it as the source to add. */
async function sourceOf(kind: Kind, draft: Draft): Promise<IngredientSourceRequest | string> {
  const own = { layer: draft.layer, name: draft.name.trim() };
  if (kind === 'link') return { kind: 'link', url: draft.text.trim() };
  if (own.name === '') return 'Give it a short name.';
  if (kind === 'note') return { kind: 'note', ...own, text: draft.text };
  if (draft.file === null) return kind === 'image' ? 'Choose a picture.' : 'Choose a clip.';
  if (kind === 'image') {
    const problem = imageProblem(draft.file);
    if (problem !== null) return problem;
    const { file } = await uploadFormatImage(draft.file, () => undefined);
    return { kind: 'image', ...own, file };
  }
  const problem = fileProblem(draft.file);
  if (problem !== null) return problem;
  const saved = await uploadBreakdownFile(draft.file, fileType(draft.file) ?? '', () => undefined);
  return { kind: 'clip', ...own, file: saved.file };
}

function Fields({
  kind,
  draft,
  change,
}: {
  readonly kind: Kind;
  readonly draft: Draft;
  readonly change: (draft: Draft) => void;
}) {
  if (kind === 'link') {
    return (
      <input
        value={draft.text}
        onChange={(event) => change({ ...draft, text: event.target.value })}
        placeholder="A YouTube video link"
        aria-label="A YouTube video link"
        maxLength={300}
        className={FIELD}
      />
    );
  }
  return (
    <>
      <select
        value={draft.layer}
        aria-label="Layer"
        onChange={(event) => change({ ...draft, layer: event.target.value as IngredientLayer })}
        className={FIELD}
      >
        {INGREDIENT_LAYERS.map((layer) => (
          <option key={layer} value={layer}>
            {LAYER_LABELS[layer]}
          </option>
        ))}
      </select>
      <input
        value={draft.name}
        onChange={(event) => change({ ...draft, name: event.target.value })}
        placeholder="A short name"
        aria-label="A short name"
        maxLength={80}
        className={FIELD}
      />
      {kind === 'note' ? (
        <textarea
          value={draft.text}
          onChange={(event) => change({ ...draft, text: event.target.value })}
          placeholder="What you want to keep"
          aria-label="Your note"
          rows={3}
          maxLength={4000}
          className={FIELD}
        />
      ) : (
        <input
          type="file"
          aria-label={kind === 'image' ? 'A picture' : 'A clip'}
          accept={
            kind === 'image'
              ? 'image/png,image/jpeg,image/webp'
              : 'video/mp4,video/webm,video/quicktime'
          }
          onChange={(event) => change({ ...draft, file: event.target.files?.[0] ?? null })}
          className="min-w-0 text-body-sm text-on-surface-variant file:mr-3 file:rounded-full file:border-0 file:bg-surface-container-high file:px-3 file:py-1.5 file:text-on-surface"
        />
      )}
    </>
  );
}

/** Adds something of the owner's own: a link to a video, a note, a picture or a clip. */
export function AddYourOwn({ onAdd }: Props) {
  const [kind, setKind] = useState<Kind>('link');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A new round after each add, so the file field is emptied as well.
  const [round, setRound] = useState(0);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const source = await sourceOf(kind, draft);
      const problem = typeof source === 'string' ? source : await onAdd(source);
      setMessage(problem);
      if (problem === null) {
        setDraft({ ...EMPTY, layer: draft.layer });
        setRound((value) => value + 1);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-col gap-space-sm">
      <Field label="Add your own">
        <Segmented label="What to add" options={KINDS} value={kind} onChange={setKind} fill />
      </Field>
      <Fields key={round} kind={kind} draft={draft} change={setDraft} />
      <button type="submit" disabled={busy} className={`self-start ${QUIET_BUTTON}`}>
        {busy ? 'Adding…' : 'Add to the shelf'}
      </button>
      {message !== null && (
        <p role="alert" className="break-words text-body-sm text-error">
          {message}
        </p>
      )}
    </form>
  );
}
