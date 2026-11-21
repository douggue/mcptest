/**
 * One channel's view: its stored numbers as labelled tiles, when it was read,
 * and the buttons that take it into the other views. Every number comes from
 * the store or is computed from it; none is a forecast.
 */
import type { ChannelProfile } from '@jgtube/core';
import { formatAge, formatCount } from './format';
import type { Route } from './routes';

export interface ProfileTile {
  readonly label: string;
  readonly value: string;
  /** What the number rests on. */
  readonly note: string;
}

const DAY_MS = 86_400_000;
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

function subscribersTile(profile: ChannelProfile): ProfileTile {
  if (profile.subscribersHidden) {
    return { label: 'Subscribers', value: 'Hidden', note: 'The channel hides its count' };
  }
  return profile.subscribers === null
    ? { label: 'Subscribers', value: '—', note: 'Not read yet' }
    : {
        label: 'Subscribers',
        value: formatCount(profile.subscribers),
        note: 'As YouTube shows it',
      };
}

function videosTile({ videoCount, stored }: ChannelProfile): ProfileTile {
  if (videoCount === null) {
    return {
      label: 'Videos',
      value: formatCount(stored.videos),
      note: 'Stored by Jgtube; YouTube did not give a total',
    };
  }
  const kept = stored.capped
    ? `Jgtube stores the newest ${stored.videos}`
    : `Jgtube stores ${stored.videos}`;
  return { label: 'Videos', value: formatCount(videoCount), note: `On YouTube; ${kept}` };
}

/** The channel's numbers, each with what it rests on. */
export function profileTiles(profile: ChannelProfile): readonly ProfileTile[] {
  const { stored, uploads, lastUpload, outliers } = profile;
  return [
    subscribersTile(profile),
    videosTile(profile),
    {
      label: 'Views',
      value: formatCount(stored.views),
      note: `Added up over the ${plural(stored.videos, 'stored video')}`,
    },
    {
      label: 'Uploads',
      value: `${uploads.perWeek} a week`,
      note: `${uploads.last90Days} in the last 90 days, ${uploads.last30Days} in the last 30`,
    },
    lastUpload
      ? { label: 'Last upload', value: lastUpload.publishedRaw, note: 'As YouTube dated it' }
      : { label: 'Last upload', value: '—', note: 'No videos stored' },
    {
      label: 'Outliers',
      value: String(outliers.recent),
      note: `Videos at ${outliers.minScore}× or more of its usual in the last ${outliers.windowDays} days; ${outliers.all} among all stored`,
    },
  ];
}

/** When the channel was last read from YouTube, in words. */
export function readLine(profile: ChannelProfile, now: Date): string {
  const days = (now.getTime() - new Date(profile.readAt).getTime()) / DAY_MS;
  return `Read from YouTube ${formatAge(days)} ago.`;
}

export interface ChannelAction {
  readonly id: 'breakdown' | 'ideas' | 'comments' | 'what-changed' | 'alerts' | 'make-map';
  readonly label: string;
  readonly route: Route;
  /** The action works on the channel's own map, which must be the one on screen. */
  readonly needsMap: boolean;
}

const view = (name: Route['view'], anchor: string | null = null): Route => ({
  view: name,
  channelId: null,
  anchor,
});

const BREAKDOWN: ChannelAction = {
  id: 'breakdown',
  label: 'Break it down',
  route: view('ask'),
  needsMap: false,
};

/** The buttons into the other views; most need a map made for the channel. */
export function channelActions(hasMap: boolean): readonly ChannelAction[] {
  if (!hasMap) {
    return [
      BREAKDOWN,
      { id: 'make-map', label: 'Make its map', route: view('home'), needsMap: false },
    ];
  }
  return [
    BREAKDOWN,
    { id: 'ideas', label: 'Ideas for it', route: view('ideas'), needsMap: true },
    { id: 'comments', label: 'What viewers ask for', route: view('comments'), needsMap: true },
    { id: 'what-changed', label: 'What changed', route: view('what-changed'), needsMap: true },
    {
      id: 'alerts',
      label: 'Alerts',
      route: view('what-changed', 'alerts-title'),
      needsMap: true,
    },
  ];
}
