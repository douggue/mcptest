import type { MapMemberData } from '../src/map/view';
import businessDecline from './fixtures/peer-map-business-decline.json';
import retroTech from './fixtures/peer-map-retro-tech.json';
import modelMap from './fixtures/peer-map.json';

/**
 * The three real maps the look-alike tests run on, with the groups their
 * channels were sorted into by reading the titles, not from the scores. The
 * lists live here so that every test judges the same channels the same way.
 */

export interface FixtureVideo {
  readonly title: string;
  readonly durationSeconds: number | null;
  readonly daysAgo: number;
}

export interface FixtureChannel {
  readonly id: string;
  readonly title: string;
  readonly subscribers: number | null;
  readonly steps: number;
  readonly videos: readonly FixtureVideo[];
}

export interface Fixture {
  readonly now: string;
  readonly modelId?: string;
  readonly centre: FixtureChannel;
  readonly channels: readonly FixtureChannel[];
}

const DAY_MS = 86_400_000;

/** A fixture channel as the map view takes it. */
export function toMember(channel: FixtureChannel, now: Date): MapMemberData {
  return {
    channel: {
      id: channel.id,
      title: channel.title,
      handle: null,
      subscribers: channel.subscribers,
      subscribersHidden: channel.subscribers === null,
      videoCount: null,
      fetchedAt: now,
    },
    steps: channel.steps,
    videos: channel.videos.map((video, index) => ({
      id: `${channel.id}-${index}`,
      channelId: channel.id,
      title: video.title,
      views: 0,
      durationSeconds: video.durationSeconds,
      published: {
        date: new Date(now.getTime() - video.daysAgo * DAY_MS),
        precision: 'day',
        raw: `${video.daysAgo}d ago`,
      },
      fetchedAt: now,
    })),
  };
}

/** Make the model's kind of video: a nation's or company's new invention, told as a breakthrough. */
export const LOOK_ALIKES = [
  'Modern Frontier',
  'Jaime Heinecke',
  'Williamson',
  'States 2050',
  'Frontier States',
  'Hans Bender',
  'Marcus Bennett',
  'America Invents 2050',
  'Gael',
  'Valtrum',
  'Snap Shift',
];

/** Share subjects (aircraft, Tesla, rockets, batteries) or stock phrases with the model, not its format. */
export const LOUD_OUTSIDERS = ['Mentour Now!', 'Farzad', 'JoshSullivanSpace', 'Wild Line'];

/** Every tenth channel the map had already rejected on titles; other niches altogether. */
export const OTHER_NICHES = [
  'All Out Aviation',
  'Astron17',
  'Beyond Sky',
  'C Spinner Watch Restorations',
  'GOLOVOLOM TV',
  'GREAT SPACE',
  'Jake Broe',
  'KRAFTY',
  'Part That Changed American History',
  'TECH HUB',
  'TECH WAVE',
  'TerraDecoded',
  'Uncharted Mysteries',
  'Vanished Gears & Dials',
  'World Travel Doc',
];

export interface Niche {
  readonly name: string;
  readonly fixture: Fixture;
  /** Make the centre's kind of video, judged by reading their titles. */
  readonly lookAlikes: readonly string[];
  /** Other niches altogether. */
  readonly otherNiches: readonly string[];
  /** Make the centre's kind of video but have stopped uploading. */
  readonly dormant: readonly string[];
}

/** Two maps centred on small established channels in unrelated niches, with no model channel. */
export const NICHES: readonly Niche[] = [
  {
    name: 'retro technology: what happened to old software, chips and companies',
    fixture: retroTech,
    lookAlikes: [
      'Tech Fallout',
      'Byte & Fall',
      'Jason Stewards',
      'Tech Rewind',
      'Silicon Hindsight',
      'Ctrl+Alt+Fail',
      'The Great Bet',
      'Gadget Afterlife',
    ],
    otherNiches: [
      'Paper Globe',
      'Nick',
      'Uncle Nav',
      'Hysterical History',
      'polymatt',
      'Neural Nutshell',
      'Cece Carmen',
      'Animated Physics',
      'Kate Kite',
      'TerraDecoded',
      'StandFirm',
      'biplav',
    ],
    dormant: ['Tech Assembly'],
  },
  {
    name: 'companies and brands in decline',
    fixture: businessDecline,
    lookAlikes: [
      'John Harrison',
      'SHUTTER DESK',
      'Snake Oil Inc',
      'Final Sale',
      'Burnt Empires',
      'Business Behind Brands',
    ],
    otherNiches: [
      'Money Rehab with Nicole Lapin',
      'Paycheckology',
      'Depression Era Secrets',
      'rooked.',
      'Michael Bordenaro Clips',
      'Jake Morrison',
      'Brits React',
      'BuiltOnMargins',
      'pulp.',
      'Kitco Mining',
      'Canadian Chronicler',
    ],
    dormant: [],
  },
];

/** The map measured against a model channel, in the same form as the two above. */
export const MODEL_NICHE: Niche = {
  name: 'a nation’s new inventions, measured against a model channel',
  fixture: modelMap,
  lookAlikes: LOOK_ALIKES,
  otherNiches: [...LOUD_OUTSIDERS, ...OTHER_NICHES],
  dormant: [],
};
