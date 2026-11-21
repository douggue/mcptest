const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;

export function formatCount(value: number | null): string {
  return value === null ? 'hidden' : compact.format(value);
}

/** A breakout multiple: "7.9×" below ten, "83×" and "1,542×" above. */
export function formatScore(score: number): string {
  return `${score < 10 ? score.toFixed(1) : whole.format(score)}×`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Up to two initials, used where a channel has no stored avatar. */
export function initials(title: string): string {
  const letters = title
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase());
  return letters.join('') || '?';
}

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Links are built only from ids of the expected shape, never from stored text. */
export function watchUrl(videoId: string): string | null {
  return VIDEO_ID.test(videoId) ? `https://www.youtube.com/watch?v=${videoId}` : null;
}

export function thumbnailUrl(videoId: string): string | null {
  return VIDEO_ID.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
}

/** The one host a channel's logo is loaded from; the page's security policy allows no other. */
const LOGO_ORIGIN = 'https://yt3.googleusercontent.com';

/**
 * A stored logo address when it is on the channel image host, else null. The
 * address came from a YouTube page, so it is checked again before it is used.
 */
export function logoUrl(stored: string | null): string | null {
  if (stored === null) return null;
  try {
    return new URL(stored).origin === LOGO_ORIGIN ? stored : null;
  } catch {
    return null;
  }
}

export function channelUrl(channelId: string): string | null {
  return CHANNEL_ID.test(channelId) ? `https://www.youtube.com/channel/${channelId}` : null;
}

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** A length of time in the largest unit that reads naturally, such as "5 months". */
export function formatAge(days: number): string {
  const whole = Math.floor(days);
  if (whole < 1) return 'under a day';
  if (whole < 14) return plural(whole, 'day');
  if (whole < 60) return plural(Math.floor(whole / 7), 'week');
  if (whole < 730) return plural(Math.floor(whole / 30), 'month');
  return plural(Math.floor(whole / 365), 'year');
}
