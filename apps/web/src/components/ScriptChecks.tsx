import { Check, Square } from 'lucide-react';
import {
  checklist,
  clockOf,
  gradeNote,
  type ScriptStats,
  type ScriptView,
} from '../lib/scriptWriter';

const LABEL = 'text-label text-outline';

/** What is counted about the text, with the facts still to check listed beside it. */
export function Counts({
  stats,
  view,
}: {
  readonly stats: ScriptStats;
  readonly view: ScriptView;
}) {
  const markFacts = view.markFacts ?? true;
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
      {markFacts && (
        <div
          className={`flex flex-col gap-1 rounded p-space-sm ${stats.markers.length > 0 ? 'bg-metric-amber-bg' : 'bg-space-deep'}`}
        >
          <span
            className={`text-label ${stats.markers.length > 0 ? 'text-metric-amber' : 'text-outline'}`}
          >
            Facts to check · {stats.markers.length}
          </span>
          {stats.markers.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No marker in this text.</p>
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
      )}
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
export function Checklist({ beats, text }: { readonly beats: string; readonly text: string }) {
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
