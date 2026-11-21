import type { CalendarItem, CalendarView, CalendarWeek } from '@jgtube/core';
import { CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';
import { calendarTiles, paceLine, weekLabel, weekNote } from '../lib/calendar';
import { CalendarItemRow } from './CalendarItemRow';
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';
import { ViewPage } from './layout/SplitView';
import { TileRow } from './layout/StatRow';
import { ViewHeader } from './layout/ViewHeader';
import { NOTE } from './LabStatus';
import { useCalendar, type Calendar } from './useCalendar';

const ALERT = 'rounded-lg bg-surface-card p-space-md text-body-md text-error';

function Items({
  items,
  save,
}: {
  readonly items: readonly CalendarItem[];
  readonly save: Calendar['save'];
}) {
  return (
    <ul className="flex min-w-0 flex-col">
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

/** A list of concepts outside the weeks shown, on a card of its own. */
function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card as="section" label={title}>
      <Label>{title}</Label>
      {children}
    </Card>
  );
}

/** One week: its label and what it holds, then its concepts; a slim line when it holds none. */
function Week({
  week,
  calendar,
  save,
}: {
  readonly week: CalendarWeek;
  readonly calendar: CalendarView;
  readonly save: Calendar['save'];
}) {
  return (
    <li
      className={`flex min-w-0 flex-col gap-1 border-t border-border-subtle first:border-t-0 ${
        week.items.length > 0 ? 'py-space-sm' : 'py-1.5'
      }`}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-space-md gap-y-0.5">
        <span className="text-body-md font-semibold text-on-surface">
          {weekLabel(week.start, calendar.today)}
        </span>
        <span className={`text-body-sm ${week.gap ? 'text-outline' : 'text-on-surface-variant'}`}>
          {weekNote(week)}
        </span>
      </div>
      {week.items.length > 0 && <Items items={week.items} save={save} />}
    </li>
  );
}

function Weeks({
  calendar,
  save,
}: {
  readonly calendar: CalendarView;
  readonly save: Calendar['save'];
}) {
  const { weeks, undated, earlier, later } = calendar;
  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      {earlier.length > 0 && (
        <Group title="Planned before this week">
          <Items items={earlier} save={save} />
        </Group>
      )}
      <Card as="section" label="The weeks ahead">
        <Label>The weeks ahead</Label>
        <ol className="flex min-w-0 flex-col">
          {weeks.map((week) => (
            <Week key={week.start} week={week} calendar={calendar} save={save} />
          ))}
        </ol>
      </Card>
      {later.length > 0 && (
        <Group title="Planned later">
          <Items items={later} save={save} />
        </Group>
      )}
      <Group title="No date yet">
        {undated.length === 0 ? (
          <p className="text-body-sm text-outline">Every kept idea has a date.</p>
        ) : (
          <Items items={undated} save={save} />
        )}
      </Group>
    </div>
  );
}

function HowItWorks({ calendar }: { readonly calendar: CalendarView | null }) {
  return (
    <Details summary="How this works">
      <p className="text-body-sm text-on-surface-variant">
        Give each kept concept a status and, if you like, a date. A concept with a script shares its
        status with the script writer; one linked to its published video counts as published.
      </p>
      {calendar && <p className="text-body-sm text-outline">{paceLine(calendar.pace)}</p>}
    </Details>
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
    <ViewPage id="upload-calendar" labelledBy="upload-calendar-title">
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-space-lg">
        <ViewHeader
          titleId="upload-calendar-title"
          title="Calendar"
          icon={CalendarDays}
          lead="Your kept concepts and scripts by the week you plan to publish them."
        />
        <HowItWorks calendar={calendar} />
        {state.status === 'loading' && <p className={NOTE}>Reading the calendar</p>}
        {state.status === 'failed' && (
          <p role="alert" className={ALERT}>
            It could not be loaded: {state.message}
          </p>
        )}
        {problem && (
          <p role="alert" className={ALERT}>
            {problem}
          </p>
        )}
        {calendar && <TileRow tiles={calendarTiles(calendar)} />}
        {empty && (
          <Card>
            <p className="text-body-md text-on-surface">No kept ideas yet.</p>
            <p className="text-body-sm text-on-surface-variant">
              Keep an idea in Ideas to plan it here.
            </p>
          </Card>
        )}
        {calendar && !empty && <Weeks calendar={calendar} save={save} />}
      </div>
    </ViewPage>
  );
}
