import type { CalendarItem, CalendarView } from '@jgtube/core';
import { CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';
import { paceLine, weekLabel, weekNote } from '../lib/calendar';
import { CalendarItemRow } from './CalendarItemRow';
import { NOTE } from './LabStatus';
import { useCalendar, type Calendar } from './useCalendar';

const LABEL = 'text-label-caps uppercase text-outline';

function Items({
  items,
  save,
}: {
  readonly items: readonly CalendarItem[];
  readonly save: Calendar['save'];
}) {
  return (
    <ul className="flex flex-col gap-space-sm">
      {items.map((item) => (
        <CalendarItemRow
          key={item.conceptId}
          item={item}
          onSave={(status, plannedDate) => save(item.conceptId, { status, plannedDate })}
        />
      ))}
    </ul>
  );
}

function Group({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={LABEL}>{title}</h3>
        {note && <p className="text-body-sm text-outline">{note}</p>}
      </div>
      {children}
    </div>
  );
}

function Weeks({
  calendar,
  save,
}: {
  readonly calendar: CalendarView;
  readonly save: Calendar['save'];
}) {
  const { weeks, undated, earlier, later, pace, today } = calendar;
  return (
    <div className="flex flex-col gap-space-lg">
      {earlier.length > 0 && (
        <Group title="Planned before this week">
          <Items items={earlier} save={save} />
        </Group>
      )}
      {weeks.map((week) => (
        <Group key={week.start} title={weekLabel(week.start, today)} note={weekNote(week, pace)}>
          {week.items.length > 0 && <Items items={week.items} save={save} />}
        </Group>
      ))}
      {later.length > 0 && (
        <Group title="Planned later">
          <Items items={later} save={save} />
        </Group>
      )}
      <Group title="No date yet">
        {undated.length === 0 ? (
          <p className="text-body-sm text-outline">Every kept concept has a date.</p>
        ) : (
          <Items items={undated} save={save} />
        )}
      </Group>
    </div>
  );
}

interface Props {
  readonly channelId: string | null;
  readonly reloadKey: unknown;
}

/** The kept concepts of the channel on screen, by the week they are planned for. */
export function UploadCalendar({ channelId, reloadKey }: Props) {
  const { state, problem, save } = useCalendar(channelId, reloadKey);
  if (state.status === 'idle') return null;
  const calendar = state.status === 'ready' ? state.calendar : null;
  const empty =
    calendar !== null &&
    calendar.weeks.every((week) => week.planned === 0) &&
    calendar.undated.length + calendar.earlier.length + calendar.later.length === 0;
  return (
    <section
      id="upload-calendar"
      aria-labelledby="upload-calendar-title"
      className="w-full scroll-mt-16 bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays
              aria-hidden="true"
              className="h-[22px] w-[22px] flex-none text-metric-amber"
            />
            <h2
              id="upload-calendar-title"
              className="text-headline-lg font-bold tracking-tight text-on-surface"
            >
              Upload calendar
            </h2>
          </div>
          <p className="mt-1 max-w-4xl text-body-md text-on-surface-variant">
            Your kept concepts and scripts by the week you plan to publish them. Give each a status
            and, if you like, a date. A concept with a script shares its status with the script
            writer; one linked to its published video counts as published.
          </p>
          {calendar && (
            <p className="mt-1 max-w-4xl text-body-sm text-outline">{paceLine(calendar.pace)}</p>
          )}
        </div>
        {state.status === 'loading' && <p className={NOTE}>Reading the calendar</p>}
        {state.status === 'failed' && (
          <p role="alert" className="text-body-md text-error">
            It could not be loaded: {state.message}
          </p>
        )}
        {problem && (
          <p role="alert" className="text-body-md text-error">
            {problem}
          </p>
        )}
        {empty && (
          <p className={NOTE}>
            No kept concepts yet. Keep a concept in the idea lab to plan it here.
          </p>
        )}
        {calendar && !empty && <Weeks calendar={calendar} save={save} />}
      </div>
    </section>
  );
}
