import { Check, ClipboardCopy, Download, Square } from 'lucide-react';
import { useState } from 'react';
import {
  checklist,
  clockOf,
  exportMarkdown,
  exportName,
  exportShotList,
  exportText,
  gradeNote,
  scriptStats,
  voiceoverCopy,
  type ScriptStats,
  type ScriptView,
} from '../lib/scriptWriter';
import { QUIET_BUTTON } from './LabStatus';

const LABEL = 'text-label-caps uppercase text-outline';
const AREA =
  'min-h-[28rem] w-full min-w-0 rounded bg-space-deep p-space-md font-mono text-body-sm text-on-surface shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';
/** How long "Copied" stays on the button. */
const COPIED_MS = 2500;

/** Hands the browser a file to save. */
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

interface ExportProps {
  readonly title: string;
  readonly text: string;
  readonly wordsPerMinute: number | null;
}

/**
 * The three ways out: the clean voiceover to the clipboard, the whole script
 * as a text or Markdown file, and the shot list as a CSV file. The voiceover
 * leaves the check markers out, so it is never copied silently while facts
 * are still unchecked: the first press says how many, the second copies.
 */
function Exports({ title, text, wordsPerMinute }: ExportProps) {
  const [copy, setCopy] = useState<'idle' | 'warned' | 'copied' | 'refused'>('idle');
  const voiceover = voiceoverCopy(text);
  const empty = text.trim() === '';
  const copyVoiceover = (): void => {
    if (voiceover.unchecked > 0 && copy !== 'warned') {
      setCopy('warned');
      return;
    }
    navigator.clipboard
      .writeText(voiceover.text)
      .then(() => setCopy('copied'))
      .catch(() => setCopy('refused'))
      .finally(() => window.setTimeout(() => setCopy('idle'), COPIED_MS));
  };
  const ICON = 'h-4 w-4';
  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>Export</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={empty}
          onClick={copyVoiceover}
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <ClipboardCopy aria-hidden="true" className={ICON} />
          <span aria-live="polite">
            {copy === 'warned'
              ? 'Copy anyway'
              : copy === 'copied'
                ? 'Copied'
                : copy === 'refused'
                  ? 'Could not copy'
                  : 'Copy clean voiceover text'}
          </span>
        </button>
        <button
          type="button"
          disabled={empty}
          onClick={() => download(exportName(title, 'txt'), exportText(title, text), 'text/plain')}
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className={ICON} />
          Text file (.txt)
        </button>
        <button
          type="button"
          disabled={empty}
          onClick={() =>
            download(exportName(title, 'md'), exportMarkdown(title, text), 'text/markdown')
          }
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className={ICON} />
          Markdown file (.md)
        </button>
        <button
          type="button"
          disabled={empty || wordsPerMinute === null}
          onClick={() =>
            download(exportName(title, 'csv'), exportShotList(text, wordsPerMinute), 'text/csv')
          }
          className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Download aria-hidden="true" className={ICON} />
          B-roll shot list (.csv)
        </button>
      </div>
      {copy === 'warned' && (
        <p role="alert" className="text-body-sm text-metric-amber">
          {voiceover.unchecked} {voiceover.unchecked === 1 ? 'fact is' : 'facts are'} still marked
          to be checked. The clean text leaves the markers out and keeps the claims. Check them
          first, or press Copy anyway.
        </p>
      )}
      <p className="text-body-sm text-outline">
        The clean voiceover is only what is spoken. The text and Markdown files carry the headings,
        the picture cues and every check marker. The shot list has one row per picture cue, with
        times worked out from the words at the speaking rate.
      </p>
    </div>
  );
}

/** What is counted about the text, with the facts still to check listed beside it. */
function Counts({ stats, view }: { readonly stats: ScriptStats; readonly view: ScriptView }) {
  const target = view.script?.targetSeconds ?? null;
  const grade = gradeNote(stats.grade, view.script?.targetGrade ?? null);
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="grid grid-cols-2 gap-space-sm">
        <div className="rounded bg-space-deep p-space-sm">
          <span className={LABEL}>Words spoken</span>
          <p className="text-title-md text-on-surface">{stats.words}</p>
          <p className="text-body-sm text-outline">of about {view.plan.targetWords ?? '—'}</p>
        </div>
        <div className="rounded bg-space-deep p-space-sm">
          <span className={LABEL}>Spoken time</span>
          <p className="text-title-md text-on-surface">{clockOf(stats.seconds)}</p>
          <p className="text-body-sm text-outline">aiming at {clockOf(target)}</p>
        </div>
      </div>
      <p className="text-body-sm text-on-surface-variant">{grade}</p>
      <div
        className={`flex flex-col gap-1 rounded p-space-sm ${stats.markers.length > 0 ? 'bg-metric-amber-bg' : 'bg-space-deep'}`}
      >
        <span
          className={`text-label-caps uppercase ${stats.markers.length > 0 ? 'text-metric-amber' : 'text-outline'}`}
        >
          Facts to check · {stats.markers.length}
        </span>
        {stats.markers.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            No marker in this text. That does not make its facts true: an AI wrote it without being
            able to look anything up.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {stats.markers.map((marker, index) => (
              <li
                key={`${index}-${marker.what}`}
                className="break-words text-body-sm text-on-surface"
              >
                {marker.what}
                <span className="text-outline"> · in: {marker.near}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {stats.unmarkedFigures.length > 0 && (
        <div className="flex flex-col gap-1 rounded bg-space-deep p-space-sm">
          <span className={LABEL}>
            Sentences with a number and no marker · {stats.unmarkedFigures.length}
          </span>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {stats.unmarkedFigures.map((sentence, index) => (
              <li
                key={`${index}-${sentence}`}
                className="break-words text-body-sm text-on-surface-variant"
              >
                {sentence}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The beat sheet as a checklist: a beat is ticked when the text has a part with its name. */
function Checklist({ beats, text }: { readonly beats: string; readonly text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>Checklist from the beat sheet</span>
      <ul className="flex flex-col gap-1">
        {checklist(beats, text).map((item, index) => {
          const Icon = item.done ? Check : Square;
          return (
            <li key={`${index}-${item.name}`} className="flex items-start gap-2 text-body-sm">
              <Icon
                aria-hidden="true"
                className={`mt-0.5 h-4 w-4 flex-none ${item.done ? 'text-primary' : 'text-outline'}`}
              />
              <span className={item.done ? 'text-on-surface' : 'text-on-surface-variant'}>
                <span className="text-outline">{item.time} </span>
                {item.name}
                <span className="sr-only">
                  {item.done ? ' (in the script)' : ' (not in the script yet)'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface Props {
  readonly view: ScriptView;
  /** Which text is in the editor. */
  readonly which: 'draft' | 'tightened';
  readonly onChange: (text: string) => void;
}

/**
 * The editor for the draft or the tightened draft, with what is counted
 * about the text beside it: words, spoken time, reading grade, the facts
 * still to check, the checklist, and the exports.
 */
export function ScriptEditor({ view, which, onChange }: Props) {
  const text = view.script?.[which] ?? '';
  const rate = view.script?.wordsPerMinute ?? null;
  const stats = scriptStats(text, rate);
  return (
    <div className="grid grid-cols-1 gap-space-md xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>
            {which === 'draft' ? 'The draft' : 'The tightened draft'} · {stats.cues} picture cues
          </span>
          <textarea
            value={text}
            onChange={(event) => onChange(event.target.value)}
            spellCheck
            className={AREA}
          />
        </label>
        <p className="text-body-sm text-outline">
          A line starting with ## is a heading. A line like [B-ROLL: what to show | search phrase |
          sound] is a picture cue. [CHECK: what to verify] after a claim marks a fact to check;
          delete the marker once you have checked it. None of the three counts as spoken words.
        </p>
        <Exports title={view.concept.title} text={text} wordsPerMinute={rate} />
      </div>
      <div className="flex min-w-0 flex-col gap-space-md">
        <Counts stats={stats} view={view} />
        <Checklist beats={view.script?.beats ?? ''} text={text} />
      </div>
    </div>
  );
}
