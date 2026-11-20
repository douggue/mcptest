/**
 * The owner's clock. The daily cap on alerts and the daily summary go by the
 * owner's day, not by UTC, so a day and an hour are worked out in a named
 * time zone, which follows daylight saving by itself.
 */

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export interface LocalMoment {
  /** The calendar day in the zone, as YYYY-MM-DD. */
  readonly day: string;
  /** The hour of that day, 0 to 23. */
  readonly hour: number;
}

/** Whether the text names a time zone this computer knows, such as Europe/London. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface Fields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function fieldsIn(at: Date, zone: string): Fields {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/** The day and the hour an instant falls on in a zone. */
export function localMoment(at: Date, zone: string): LocalMoment {
  const fields = fieldsIn(at, zone);
  return {
    day: `${fields.year}-${twoDigits(fields.month)}-${twoDigits(fields.day)}`,
    hour: fields.hour,
  };
}

/** How far the zone's clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(at: Date, zone: string): number {
  const f = fieldsIn(at, zone);
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the zone's calendar day began for the day `at` falls on. */
export function startOfLocalDay(at: Date, zone: string): Date {
  const f = fieldsIn(at, zone);
  const midnightAsUtc = Date.UTC(f.year, f.month - 1, f.day);
  // The offset now is right for midnight unless the clocks changed since; the
  // second pass uses the offset in force at the first answer, which settles it.
  const first = midnightAsUtc - offsetAt(at, zone);
  return new Date(midnightAsUtc - offsetAt(new Date(first), zone));
}

/** The instant the zone's next calendar day begins. */
export function endOfLocalDay(at: Date, zone: string): Date {
  const start = startOfLocalDay(at, zone);
  // A day is 23 to 25 hours long; a moment 26 hours on is always in the next one.
  return startOfLocalDay(new Date(start.getTime() + MS_PER_DAY + 2 * 60 * MS_PER_MINUTE), zone);
}
