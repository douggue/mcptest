/**
 * A video's length as the official API writes it: an ISO-8601 duration such as
 * `PT42S`, `PT1M30S`, `PT1H2M3S` or, for a very long video, `P1DT2H`.
 */
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;

/** The length in seconds, or null when the text is not a duration the API writes. */
export function parseIsoDuration(text: string): number | null {
  const match = ISO_DURATION.exec(text);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  // "P" and "PT" match the pattern but name no length at all.
  if ([days, hours, minutes, seconds].every((part) => part === undefined)) return null;
  return (
    Number(days ?? 0) * SECONDS_PER_DAY +
    Number(hours ?? 0) * SECONDS_PER_HOUR +
    Number(minutes ?? 0) * SECONDS_PER_MINUTE +
    Number(seconds ?? 0)
  );
}
