/**
 * How fast a video is gaining views, from the readings kept of it. Pure
 * arithmetic over readings: nothing here says what counts as fast. That is
 * decided later, from evidence across several niches, not here.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * The rate is measured over the last six hours. With a reading an hour that
 * is seven readings: enough to smooth one late or odd reading, short enough
 * that a video taking off shows within the same morning.
 */
export const RATE_WINDOW_MS = 6 * MS_PER_HOUR;
/**
 * Two readings closer than half an hour give no rate. YouTube updates its
 * counts in steps, so over a few minutes the difference is mostly the step,
 * and dividing it by a small part of an hour magnifies it.
 */
export const MIN_SPAN_MS = 30 * 60 * 1000;

/**
 * A rate whose newest reading is more than seven hours old is marked stale.
 * The slowest tier reads every six hours, so a tracked video's newest reading
 * is never older than that plus the round it waits for; seven hours on, the
 * figure describes the past, and nothing should be reported "now" on it.
 */
export const STALE_AFTER_MS = 7 * MS_PER_HOUR;

export interface ViewReading {
  readonly capturedAt: Date;
  readonly views: number;
}

export interface Velocity {
  /** Views gained per hour; null when the readings cannot say. */
  readonly viewsPerHour: number | null;
  /**
   * The latest window's rate divided by the rate of the window before it:
   * above 1 the video is speeding up, below 1 slowing down. Null when unknown.
   */
  readonly acceleration: number | null;
  /**
   * True when the video gained nothing in the window before and is gaining
   * now. The acceleration is null then, as a ratio to zero has no value, but
   * "started moving" is not the same as "unknown", and this says which.
   */
  readonly startedFromZero: boolean;
  /** The readings the rate was measured between; null when there is no rate. */
  readonly measuredFrom: Date | null;
  readonly measuredTo: Date | null;
  /**
   * True when the newest reading the rate uses is older than `STALE_AFTER_MS`
   * at `now`: the rate is what the video was doing then, not what it does now.
   * False when there is no rate.
   */
  readonly stale: boolean;
}

interface Span {
  readonly first: ViewReading;
  readonly last: ViewReading;
}

const oldestFirst = (readings: readonly ViewReading[]): readonly ViewReading[] =>
  readings.toSorted((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

/** The first and last of the readings from `from` to `to`, both ends included; null with fewer than two. */
function spanWithin(sorted: readonly ViewReading[], from: number, to: number): Span | null {
  // Both ends count, so hourly readings on the hour span the whole window and
  // the reading on the boundary between two windows closes one and opens the next.
  const inside = sorted.filter((reading) => {
    const at = reading.capturedAt.getTime();
    return at >= from && at <= to;
  });
  const first = inside[0];
  const last = inside.at(-1);
  return inside.length < 2 || first === undefined || last === undefined ? null : { first, last };
}

/**
 * The latest reading and the latest one at least the minimum span before it,
 * for when the window cannot give a rate: it holds fewer than two readings, or
 * only readings too close together to divide by.
 */
function latestApart(sorted: readonly ViewReading[]): Span | null {
  const last = sorted.at(-1);
  if (last === undefined) return null;
  const first = sorted.findLast(
    (reading) => last.capturedAt.getTime() - reading.capturedAt.getTime() >= MIN_SPAN_MS,
  );
  return first === undefined ? null : { first, last };
}

const spans = (span: Span): number =>
  span.last.capturedAt.getTime() - span.first.capturedAt.getTime();

function rateOver(span: Span | null): number | null {
  if (span === null) return null;
  const elapsed = spans(span);
  if (elapsed < MIN_SPAN_MS) return null;
  // The gain is the last count less the first. A count that fell (YouTube
  // removes views it judges invalid) is no gain rather than a negative one:
  // the figure answers "how fast is it gaining", and less than nothing is not
  // an answer to that. A dip between the two ends does not matter for the same reason.
  const gained = Math.max(0, span.last.views - span.first.views);
  return gained / (elapsed / MS_PER_HOUR);
}

/**
 * The rate and how it is changing, at `now`, over windows of `windowMs`.
 *
 * The rate uses the readings of the last window; when that holds fewer than
 * two (a video read every six hours, or after a gap), or only readings closer
 * together than the minimum span, it falls back to the latest reading and the
 * latest one far enough before it, however old. `measuredFrom`/`measuredTo`
 * say which they were and `stale` says when the newest is too old to speak
 * for now, so a rate from old readings is not taken for a current one.
 *
 * The acceleration compares the last window with the one before it, each from
 * its own readings only, with no fallback: a ratio of two rates measured over
 * different lengths of time would mean nothing. It is null when either window
 * has no rate, and when the earlier rate is zero, where a ratio has no value;
 * `startedFromZero` tells that last case apart when the video is gaining now.
 */
export function velocity(
  readings: readonly ViewReading[],
  now: Date,
  windowMs: number = RATE_WINDOW_MS,
): Velocity {
  const end = now.getTime();
  // Readings after `now` are left out, so the same call gives the same answer later.
  const sorted = oldestFirst(readings).filter((reading) => reading.capturedAt.getTime() <= end);
  const latest = spanWithin(sorted, end - windowMs, end);
  const measured = latest !== null && spans(latest) >= MIN_SPAN_MS ? latest : latestApart(sorted);
  const viewsPerHour = rateOver(measured);
  const before = rateOver(spanWithin(sorted, end - 2 * windowMs, end - windowMs));
  const latestRate = rateOver(latest);
  const comparable = latestRate !== null && before !== null;
  const to = viewsPerHour === null || measured === null ? null : measured.last.capturedAt;
  return {
    viewsPerHour,
    acceleration: comparable && before !== 0 ? latestRate / before : null,
    startedFromZero: comparable && before === 0 && latestRate > 0,
    measuredFrom: viewsPerHour === null || measured === null ? null : measured.first.capturedAt,
    measuredTo: to,
    stale: to !== null && end - to.getTime() > STALE_AFTER_MS,
  };
}

/** Views gained per hour at `now`; see `velocity` for how it is measured. Null when unknown. */
export function viewsPerHour(
  readings: readonly ViewReading[],
  now: Date,
  windowMs: number = RATE_WINDOW_MS,
): number | null {
  return velocity(readings, now, windowMs).viewsPerHour;
}

/**
 * Whether a video is gaining faster than before, by its last three readings:
 * the rate between the last two against the rate between the two before
 * them. Unlike `velocity`'s acceleration it needs no two full windows, so it
 * can speak for a video read every six hours. False when it cannot tell
 * (fewer than three readings, or readings too close together).
 */
export function speedingUp(readings: readonly ViewReading[]): boolean {
  const [first, middle, last] = oldestFirst(readings).slice(-3);
  if (first === undefined || middle === undefined || last === undefined) return false;
  const earlier = rateOver({ first, last: middle });
  const later = rateOver({ first: middle, last });
  return earlier !== null && later !== null && later > earlier;
}
