import { CONCEPT_STATUSES, type CalendarItem, type ConceptStatus } from '@jgtube/core';
import { STATUS_LABELS } from '../lib/calendar';
import { watchUrl } from '../lib/format';
import { FIELD } from './LabStatus';

const LINK = 'text-primary underline-offset-2 hover:underline';

const statusOf = (value: string): ConceptStatus | undefined =>
  CONCEPT_STATUSES.find((status) => status === value);

interface Props {
  readonly item: CalendarItem;
  readonly onSave: (status: ConceptStatus | null, plannedDate: string | null) => void;
}

/** One kept concept: its status and planned date, saved as soon as either changes. */
export function CalendarItemRow({ item, onSave }: Props) {
  const href = item.linkedVideoId ? watchUrl(item.linkedVideoId) : null;
  return (
    <li className="flex min-w-0 flex-col gap-space-sm rounded bg-surface-card p-space-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-body-md font-semibold text-on-surface">{item.title}</p>
        <p className="text-body-sm text-outline">
          {item.hasScript ? 'Has a script' : 'No script yet'}
          {item.status === 'published' && (
            <>
              {' · '}
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Watch
                </a>
              )}
              {href && ' · '}
              <a href="#own-videos-title" className={LINK}>
                {item.linkedVideoId ? 'How it did' : 'Link its video'}
              </a>
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-space-sm">
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Status of {item.title}</span>
          <select
            value={item.status}
            disabled={item.linkedVideoId !== null}
            onChange={(event) =>
              onSave(statusOf(event.target.value) ?? item.status, item.plannedDate)
            }
            className={`${FIELD} w-32`}
          >
            {CONCEPT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Planned date of {item.title}</span>
          <input
            type="date"
            value={item.plannedDate ?? ''}
            onChange={(event) =>
              onSave(item.status, event.target.value === '' ? null : event.target.value)
            }
            className={`${FIELD} w-40`}
          />
        </label>
      </div>
    </li>
  );
}
