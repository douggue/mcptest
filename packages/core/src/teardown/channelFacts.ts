import type { TeardownMeasurements } from './measurements';
import { dominantColours } from './palette';
import { median } from './shots';
import { titleFacts, type TitleFacts } from './titlePatterns';
import { wordStats, type TimedLine } from './words';

/**
 * What code measured across a channel's studied videos, for every part of a
 * channel breakdown: the basis, title patterns, the thumbnail checklist
 * counted, script numbers and the style bible (palette, pace, loudness,
 * transitions, camera, pictures), each for the winners and the ordinary
 * videos side by side. Every number here is counted, never judged.
 */

export type VideoRole = 'winner' | 'ordinary';

export interface ChannelVideoInput {
  readonly videoId: string;
  readonly title: string;
  readonly role: VideoRole;
  readonly views: number;
  readonly score: number | null;
  readonly measured: TeardownMeasurements | null;
  readonly lines: readonly TimedLine[] | null;
  /** The engine that watched it with sound, when one did. */
  readonly heardBy: string | null;
  /** The checklist an engine filled in for its thumbnail, when one did. */
  readonly thumbnail: Readonly<Record<string, unknown>> | null;
}

export interface ChannelFactsInput {
  readonly videos: readonly ChannelVideoInput[];
  /** The titles of the high and low groups of the ranking by views. */
  readonly titles: { readonly winners: readonly string[]; readonly ordinary: readonly string[] };
}

/** The opening counted for the hook, in seconds. */
const HOOK_WINDOW = 60;
const MAX_HAMMERS_SHOWN = 8;
const MAX_KEYFRAMES_LISTED = 8;
const MINUTE = 60;
const round = (value: number, places = 2): number =>
  Math.round(value * 10 ** places) / 10 ** places;

function videoFacts(video: ChannelVideoInput) {
  const m = video.measured;
  const lines = video.lines ?? [];
  const duration = m?.video.durationSeconds ?? lines.at(-1)?.at ?? 0;
  const words =
    lines.length === 0 || duration === 0 ? null : wordStats(lines, { start: 0, end: duration });
  const hook =
    lines.length === 0
      ? null
      : wordStats(lines, { start: 0, end: Math.min(HOOK_WINDOW, duration || HOOK_WINDOW) });
  const motion = m?.motion ?? null;
  const minutes = duration / MINUTE;
  return {
    videoId: video.videoId,
    title: video.title,
    role: video.role,
    views: video.views,
    score: video.score,
    measured: m !== null,
    heardBy: video.heardBy,
    durationSeconds: m?.video.durationSeconds ?? null,
    pace:
      m === null
        ? null
        : {
            cuts: m.shots.cutCount,
            cutsPerMinute: m.shots.cutsPerMinute,
            medianShotSeconds: m.shots.medianSeconds,
            firstCutSeconds: m.shots.cuts[0] ?? null,
          },
    loudness: m?.loudness ?? null,
    quietDips: m?.quietDips?.items.length ?? null,
    peakImpacts: m?.peaks?.items.length ?? null,
    palette: m?.palette.items ?? [],
    transitions: motion?.transitionCounts ?? null,
    transitionsPerMinute:
      motion === null || minutes === 0
        ? null
        : round(
            Object.entries(motion.transitionCounts).reduce(
              (sum, [kind, count]) => (kind === 'cut' ? sum : sum + count),
              0,
            ) / minutes,
          ),
    camera: motion?.cameraCounts ?? null,
    animationsPerMinute:
      motion === null || minutes === 0 ? null : round(motion.animations.length / minutes),
    holds: motion?.holds ?? null,
    words: words === null ? null : { ...words, hammers: words.hammers.slice(0, MAX_HAMMERS_SHOWN) },
    hook:
      hook === null
        ? null
        : {
            seconds: Math.min(HOOK_WINDOW, duration),
            words: hook.wordCount,
            wordsPerMinute: hook.wordsPerMinute,
            firstLine: lines[0]?.text ?? null,
          },
    pictures: {
      keyframes: (m?.keyframes ?? [])
        .filter(
          (_, index, all) =>
            index % Math.max(1, Math.ceil(all.length / MAX_KEYFRAMES_LISTED)) === 0,
        )
        .map((frame) => ({ name: frame.file, at: frame.at })),
      strips: (motion?.strips ?? []).map((strip) => ({
        name: strip.file,
        kind: strip.kind,
        at: strip.start,
        frames: strip.frames,
        durationSeconds: strip.durationSeconds,
      })),
      hookSheet: m?.hookSheet?.file ?? null,
    },
    thumbnail: video.thumbnail,
  };
}

type VideoFacts = ReturnType<typeof videoFacts>;

const middle = (values: readonly (number | null | undefined)[]): number | null => {
  const known = values.filter((value): value is number => typeof value === 'number');
  return known.length === 0 ? null : round(median(known));
};

/** The typical numbers of one group of measured videos. */
function groupFacts(videos: readonly VideoFacts[]) {
  const measured = videos.filter((video) => video.measured);
  const sum = (pick: (video: VideoFacts) => Readonly<Record<string, number>> | null) =>
    measured.reduce<Record<string, number>>((total, video) => {
      for (const [kind, count] of Object.entries(pick(video) ?? {}))
        total[kind] = (total[kind] ?? 0) + count;
      return total;
    }, {});
  return {
    videos: videos.length,
    measured: measured.length,
    medianCutsPerMinute: middle(measured.map((video) => video.pace?.cutsPerMinute)),
    medianShotSeconds: middle(measured.map((video) => video.pace?.medianShotSeconds)),
    medianWordsPerMinute: middle(videos.map((video) => video.words?.wordsPerMinute)),
    medianSentenceWords: middle(videos.map((video) => video.words?.medianSentenceWords)),
    medianHookWordsPerMinute: middle(videos.map((video) => video.hook?.wordsPerMinute)),
    medianIntegratedLufs: middle(measured.map((video) => video.loudness?.integratedLufs)),
    medianLoudnessRangeLu: middle(measured.map((video) => video.loudness?.lraLu)),
    medianTransitionsPerMinute: middle(measured.map((video) => video.transitionsPerMinute)),
    medianAnimationsPerMinute: middle(measured.map((video) => video.animationsPerMinute)),
    transitions: sum((video) => video.transitions),
    camera: sum((video) => video.camera),
  };
}

/** The palette shared across videos: every video's colours, weighted by its length, grouped again. */
function sharedPalette(videos: readonly VideoFacts[]) {
  const frames = videos.flatMap((video) =>
    video.palette.map((colour) => {
      const value = Number.parseInt(colour.hex.slice(1), 16);
      return {
        rgb: Uint8Array.from([(value >> 16) & 255, (value >> 8) & 255, value & 255]),
        weight: colour.share * (video.durationSeconds ?? 1),
      };
    }),
  );
  return dominantColours(frames);
}

/** The thumbnail checklist counted: for each attribute, how many winners and ordinary ones show each value. */
function thumbnailCounts(videos: readonly VideoFacts[]) {
  const tagged = videos.filter((video) => video.thumbnail !== null);
  const counts: Record<string, Record<string, { winners: number; ordinary: number }>> = {};
  for (const video of tagged) {
    for (const [key, raw] of Object.entries(video.thumbnail ?? {})) {
      if (key === 'description') continue;
      for (const value of (Array.isArray(raw) ? raw : [raw]).map(String)) {
        const slot = ((counts[key] ??= {})[value] ??= { winners: 0, ordinary: 0 });
        if (video.role === 'winner') slot.winners += 1;
        else slot.ordinary += 1;
      }
    }
  }
  return {
    tagged: {
      winners: tagged.filter((video) => video.role === 'winner').length,
      ordinary: tagged.filter((video) => video.role === 'ordinary').length,
    },
    counts,
    method:
      'the fixed thumbnail checklist an engine filled in when a thumbnail review ran, counted in code; a thumbnail never reviewed is not counted',
  };
}

export interface ChannelFacts {
  readonly basis: ReturnType<typeof basisOf>;
  readonly titles: TitleFacts;
  readonly thumbnails: ReturnType<typeof thumbnailCounts>;
  readonly videos: readonly VideoFacts[];
  readonly winners: ReturnType<typeof groupFacts>;
  readonly ordinary: ReturnType<typeof groupFacts>;
  readonly palette: { readonly items: ReturnType<typeof dominantColours>; readonly method: string };
  readonly methods: Readonly<Record<string, string>>;
}

function basisOf(videos: readonly VideoFacts[]) {
  const measured = videos.filter((video) => video.measured);
  return {
    winners: videos.filter((video) => video.role === 'winner').length,
    ordinary: videos.filter((video) => video.role === 'ordinary').length,
    measured: measured.length,
    totalMinutes: round(
      measured.reduce((sum, video) => sum + (video.durationSeconds ?? 0), 0) / MINUTE,
      1,
    ),
    cutsMeasured: measured.reduce((sum, video) => sum + (video.pace?.cuts ?? 0), 0),
    withTranscript: videos.filter((video) => video.words !== null).length,
    heardWithSound: videos
      .filter((video) => video.heardBy !== null)
      .map((video) => ({ videoId: video.videoId, by: video.heardBy })),
    framesOnly: measured.filter((video) => video.heardBy === null).map((video) => video.videoId),
  };
}

export function channelFacts(input: ChannelFactsInput): ChannelFacts {
  const videos = input.videos.map(videoFacts);
  const measured = videos.filter((video) => video.measured);
  return {
    basis: basisOf(videos),
    titles: titleFacts(input.titles.winners, input.titles.ordinary),
    thumbnails: thumbnailCounts(videos),
    videos,
    winners: groupFacts(videos.filter((video) => video.role === 'winner')),
    ordinary: groupFacts(videos.filter((video) => video.role === 'ordinary')),
    palette: {
      items: sharedPalette(measured),
      method:
        "every measured video's palette, weighted by its share of runtime and the video's length, grouped again by k-means",
    },
    methods: {
      pace: 'ffmpeg scene detection, a cut where the scene score passes 0.3; median shot is the median time between cuts',
      words:
        'counted in code from the captions; hammer lines are sentences of 2 to 5 words; the hook is the first 60 seconds',
      loudness: 'ffmpeg ebur128 (EBU R128): integrated loudness and loudness range',
      transitions:
        'every frame compared in code; dissolves, fades, flashes and whip-like moves per minute (plain cuts not counted)',
      camera: 'camera move per shot from the shift and zoom between frames, counted per shot',
      pictures: 'pictures named here can be looked at with view_teardown_images for their video',
    },
  };
}
