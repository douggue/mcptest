import type { Ingredient } from '@jgtube/core';
import { Film, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  LAYER_LABELS,
  evidenceLine,
  isReading,
  measuredText,
  mediaUrl,
  paletteOf,
} from '../lib/formatShelf';
import { videoHref } from '../lib/routes';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { FIELD, PILL } from './LabStatus';

const PICTURES_SHOWN = 3;
const ICON_BUTTON =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface';

/** Its pictures (thumbnails, keyframes, strips, the owner's own) and measured colours. */
function Media({ item }: { readonly item: Ingredient }) {
  const pictures = item.media.flatMap((media) => {
    const url = mediaUrl(media);
    return url === null ? [] : [url];
  });
  const palette = paletteOf(item);
  if (pictures.length === 0 && palette.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {pictures.length > 0 && (
        <div className="grid min-w-0 grid-cols-3 gap-1.5">
          {pictures.slice(0, PICTURES_SHOWN).map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="aspect-video w-full rounded bg-surface-container-high object-cover"
            />
          ))}
        </div>
      )}
      {palette.length > 0 && (
        <div className="flex h-6 min-w-0 overflow-hidden rounded" aria-label="Measured palette">
          {palette.map((colour) => (
            <span
              key={colour.hex}
              title={`${colour.hex} · ${Math.round(colour.share * 100)}% of runtime`}
              style={{ backgroundColor: colour.hex, flexGrow: Math.max(colour.share, 0.02) }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Quote({ item }: { readonly item: Ingredient }) {
  const quote = item.media.find((media) => media.kind === 'quote');
  if (!quote || quote.kind !== 'quote') return null;
  return (
    <blockquote className="border-l-2 border-border-subtle pl-3 text-body-sm italic text-on-surface-variant">
      {quote.text}
    </blockquote>
  );
}

/** What code measured, each with how. */
function Measured({ item }: { readonly item: Ingredient }) {
  const numbers = item.evidence.measured;
  if (numbers.length === 0) return null;
  return (
    <Details summary={`Measured (${numbers.length})`}>
      <ul className="flex flex-col gap-1 text-body-sm">
        {numbers.map((number) => (
          <li key={`${number.label}-${number.value}`} className="min-w-0 break-words">
            <span className="text-on-surface">{number.label}:</span>{' '}
            <span className="tabular-nums text-on-surface">{measuredText(number)}</span>{' '}
            <span className="text-outline">({number.method})</span>
          </li>
        ))}
      </ul>
    </Details>
  );
}

/** What an engine wrote about it, kept apart and said to be a reading. */
function Reading({ item }: { readonly item: Ingredient }) {
  if (!isReading(item)) return null;
  const reading = item.details['reading'];
  const text = typeof reading === 'string' ? reading : JSON.stringify(reading, null, 2);
  return (
    <Details summary="AI’s reading">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-body-sm text-on-surface-variant">
        {text}
      </pre>
    </Details>
  );
}

function OwnText({ item }: { readonly item: Ingredient }) {
  const text = item.details['text'];
  return typeof text === 'string' ? (
    <p className="whitespace-pre-wrap break-words text-body-sm text-on-surface-variant">{text}</p>
  ) : null;
}

function NoteField({
  item,
  onSave,
}: {
  readonly item: Ingredient;
  readonly onSave: (note: string) => void;
}) {
  const [note, setNote] = useState(item.note);
  const field = (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-label text-outline">Your note</span>
      <textarea
        value={note}
        maxLength={2000}
        rows={2}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== item.note && onSave(note)}
        className={FIELD}
      />
    </label>
  );
  // An empty note waits behind a disclosure, so the shelf stays calm.
  return item.note === '' ? <Details summary="Add a note">{field}</Details> : field;
}

const videoOf = (item: Ingredient): string | null => {
  const id = item.details['videoId'];
  return ['video', 'link', 'own-video'].includes(item.source) && typeof id === 'string' ? id : null;
};

interface Props {
  readonly item: Ingredient;
  readonly onRemove: () => void;
  readonly onNote: (note: string) => void;
  /** Puts it in the format being built; absent when there is none or it is there already. */
  readonly use?: { readonly label: string; readonly run: () => void } | undefined;
}

/** One ingredient on the shelf: its pictures, what it rests on, and the owner's note. */
export function IngredientCard({ item, onRemove, onNote, use }: Props) {
  const video = videoOf(item);
  return (
    <Card as="li" medium highlighted={item.proven}>
      <Media item={item} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={`${PILL} text-on-surface-variant`}>{LAYER_LABELS[item.layer]}</span>
        <span className="min-w-0 truncate text-body-sm text-outline">{item.sourceLabel}</span>
      </div>
      <h3 className="break-words text-title-md text-on-surface">{item.name}</h3>
      <p className="text-body-sm text-on-surface-variant">
        {evidenceLine(item.evidence, item.proven)}
      </p>
      <Quote item={item} />
      <OwnText item={item} />
      <Measured item={item} />
      <Reading item={item} />
      <NoteField item={item} onSave={onNote} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {use && (
          <button type="button" onClick={use.run} className={ICON_BUTTON}>
            <Plus aria-hidden="true" className="h-4 w-4 flex-none" />
            <span className="min-w-0 truncate">{use.label}</span>
          </button>
        )}
        {video !== null && (
          <a href={videoHref(video, 'teardown')} className={ICON_BUTTON}>
            <Film aria-hidden="true" className="h-4 w-4" />
            Analyse it
          </a>
        )}
        <button type="button" onClick={onRemove} className={ICON_BUTTON}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Take off
        </button>
      </div>
    </Card>
  );
}
