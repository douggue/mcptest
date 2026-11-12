// Time-zone aware scheduling. Times are stored in UTC; recurring rules are evaluated in the
// broadcast's own time zone so "every weekday at 20:00" survives daylight-saving changes.
//
// schedule shapes:
//   { type: 'manual' }
//   { type: 'once', at: '2026-11-12T20:00:00.000Z' }
//   { type: 'recurring', time: '20:00', days: [1,2,3,4,5], tz: 'America/New_York', from?: 'YYYY-MM-DD', until?: 'YYYY-MM-DD' }

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return fmtCache.get(tz);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function wallParts(ms, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, weekday: WEEKDAYS[p.weekday] };
}

function tzOffset(ms, tz) {
  const w = wallParts(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

// Convert a wall-clock time in `tz` to a UTC timestamp.
function zonedToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffset(guess, tz);
  let t = guess - off1;
  const off2 = tzOffset(t, tz);
  if (off2 !== off1) t = guess - off2;
  return t;
}

function isValidTz(tz) {
  try { formatter(tz); return true; } catch { return false; }
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

// First occurrence strictly after `afterMs`, or null.
function nextAfter(schedule, afterMs) {
  if (!schedule || schedule.type === 'manual') return null;
  if (schedule.type === 'once') {
    const t = new Date(schedule.at).getTime();
    return t > afterMs ? t : null;
  }
  if (schedule.type !== 'recurring') return null;
  const tz = schedule.tz || 'UTC';
  const [hh, mm] = String(schedule.time || '00:00').split(':').map(Number);
  const days = new Set(schedule.days && schedule.days.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6]);
  const from = parseDate(schedule.from);
  const until = parseDate(schedule.until);
  const fromMs = from ? zonedToUtc(from.y, from.mo, from.d, 0, 0, tz) : -Infinity;
  const untilMs = until ? zonedToUtc(until.y, until.mo, until.d, 23, 59, tz) : Infinity;

  const start = wallParts(Math.max(afterMs, fromMs === -Infinity ? afterMs : fromMs), tz);
  // Walk calendar days in the target zone (using a UTC date as a day counter).
  let day = Date.UTC(start.y, start.mo - 1, start.d);
  for (let i = 0; i < 400; i++, day += 86400000) {
    const dt = new Date(day);
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    if (!days.has(dt.getUTCDay())) continue;
    const t = zonedToUtc(y, mo, d, hh, mm, tz);
    if (t <= afterMs || t < fromMs) continue;
    if (t > untilMs) return null;
    return t;
  }
  return null;
}

// Latest occurrence in (afterMs, nowMs], or null.
function latestDue(schedule, afterMs, nowMs) {
  let t = nextAfter(schedule, afterMs);
  if (t == null || t > nowMs) return null;
  for (let i = 0; i < 2000; i++) {
    const n = nextAfter(schedule, t);
    if (n == null || n > nowMs) return t;
    t = n;
  }
  return t;
}

module.exports = { nextAfter, latestDue, zonedToUtc, wallParts, isValidTz };
