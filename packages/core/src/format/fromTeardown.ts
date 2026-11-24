/**
 * Ingredients from one section of a video's production teardown. Numbers are
 * the ones code measured (each with its method); what an engine judged is
 * kept under `reading` and never counted. One video is never proven.
 */
import type { TeardownReport } from '../teardown/report';
import { shortName } from './fromLab';
import type { IngredientDraft, IngredientLayer, IngredientMedia, MeasuredNumber } from './types';

export const TEARDOWN_SECTIONS = [
  'metrics',
  'palette',
  'typography',
  'component',
  'motion',
  'transitions',
  'hook',
  'structure',
  'sound',
] as const;
export type TeardownSection = (typeof TEARDOWN_SECTIONS)[number];

const LAYERS: Readonly<Record<TeardownSection, IngredientLayer>> = {
  metrics: 'pacing',
  palette: 'visual',
  typography: 'visual',
  component: 'visual',
  motion: 'motion',
  transitions: 'motion',
  hook: 'hook',
  structure: 'structure',
  sound: 'sound',
};

const NAMES: Readonly<Record<TeardownSection, string>> = {
  metrics: 'Pacing',
  palette: 'Palette',
  typography: 'Typography',
  component: 'Component',
  motion: 'Motion',
  transitions: 'Transitions',
  hook: 'Hook beats',
  structure: 'Chapter structure',
  sound: 'Sound and mix',
};

const KEYFRAME_EXAMPLES = 3;
const round = (value: number, places = 1): number =>
  Math.round(value * 10 ** places) / 10 ** places;

interface Part {
  readonly name?: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly measured: readonly MeasuredNumber[];
  readonly media: readonly IngredientMedia[];
}

type Measured = NonNullable<TeardownReport['measured']>;

function keyframes(report: TeardownReport, measured: Measured): readonly IngredientMedia[] {
  return measured.keyframes
    .slice(0, KEYFRAME_EXAMPLES)
    .map((frame) => ({ kind: 'keyframe', videoId: report.videoId, file: frame.file }));
}

function metrics(report: TeardownReport, measured: Measured): Part {
  const { shots } = measured;
  const words = report.transcript.words;
  return {
    details: {},
    measured: [
      {
        label: 'Cuts a minute',
        value: round(shots.cutsPerMinute),
        unit: 'a minute',
        method: shots.method,
      },
      {
        label: 'Median shot',
        value: round(shots.medianSeconds),
        unit: 'seconds',
        method: shots.method,
      },
      {
        label: 'Average shot',
        value: round(shots.averageSeconds),
        unit: 'seconds',
        method: shots.method,
      },
      ...(words === null
        ? []
        : [
            {
              label: 'Words a minute',
              value: round(words.wordsPerMinute, 0),
              unit: 'words a minute',
              method: `counted in the ${report.transcript.source === 'heard' ? 'words an engine heard' : 'captions'}`,
            },
          ]),
    ],
    media: keyframes(report, measured),
  };
}

function palette(report: TeardownReport, measured: Measured): Part {
  const items = measured.palette.items;
  return {
    details: { palette: items.map((item) => ({ hex: item.hex, share: round(item.share, 3) })) },
    measured: items.map((item) => ({
      label: item.hex,
      value: round(item.share * 100),
      unit: '% of runtime',
      method: measured.palette.method,
    })),
    media: keyframes(report, measured),
  };
}

function soundPart(report: TeardownReport, measured: Measured): Part {
  const loudness = measured.loudness;
  const stage = report.stages.sound;
  const numbers: readonly MeasuredNumber[] =
    loudness === null
      ? []
      : [
          ['Integrated loudness', loudness.integratedLufs, 'LUFS'] as const,
          ['Loudness range', loudness.lraLu, 'LU'] as const,
          ['True peak', loudness.truePeakDbfs, 'dBFS'] as const,
        ].flatMap(([label, value, unit]) =>
          value === null ? [] : [{ label, value: round(value), unit, method: loudness.method }],
        );
  return {
    details: { reading: stage.state === 'done' ? stage.data : null },
    measured: numbers,
    media: [],
  };
}

function transitions(measured: Measured): Part {
  const motion = measured.motion;
  if (motion === null) return { details: {}, measured: [], media: [] };
  const counts = Object.entries(motion.transitionCounts).filter(([, count]) => (count ?? 0) > 0);
  return {
    details: { cameraCounts: motion.cameraCounts },
    measured: counts.map(([kind, count]) => ({
      label: `Transitions: ${kind}`,
      value: count ?? 0,
      unit: '',
      method: motion.method,
    })),
    media: [],
  };
}

function component(report: TeardownReport, index: number): Part | null {
  const item = report.archetypes[index];
  if (item === undefined) return null;
  const { image, ...reading } = item;
  return {
    name: item.name,
    details: { reading },
    measured: [],
    media: image === null ? [] : [{ kind: 'keyframe', videoId: report.videoId, file: image }],
  };
}

function motionItem(report: TeardownReport, index: number): Part | null {
  const item = report.animations[index];
  if (item === undefined) return null;
  const { shown, ...reading } = item;
  return {
    name: item.name,
    details: { reading },
    measured: [],
    media: shown.map((strip) => ({ kind: 'strip', videoId: report.videoId, file: strip.file })),
  };
}

function hook(report: TeardownReport, measured: Measured): Part {
  const sheet = measured.hookSheet;
  return {
    details: { rows: report.hookRows },
    measured: [],
    media: sheet === null ? [] : [{ kind: 'keyframe', videoId: report.videoId, file: sheet.file }],
  };
}

function structure(report: TeardownReport, measured: Measured): Part {
  const chapters = report.chapters.items;
  return {
    details: {
      from: report.chapters.from,
      chapters: chapters.map(({ sheet: _sheet, ...chapter }) => chapter),
    },
    measured: [
      { label: 'Chapters', value: chapters.length, unit: '', method: 'counted' },
      {
        label: 'Length',
        value: round(measured.video.durationSeconds),
        unit: 'seconds',
        method: measured.video.method,
      },
    ],
    media: [],
  };
}

function typography(report: TeardownReport): Part | null {
  const design = report.stages.design;
  if (design.state !== 'done') return null;
  return { details: { reading: design.data.typography }, measured: [], media: [] };
}

function partOf(
  report: TeardownReport,
  measured: Measured,
  section: TeardownSection,
  index: number,
): Part | null {
  switch (section) {
    case 'metrics':
      return metrics(report, measured);
    case 'palette':
      return palette(report, measured);
    case 'typography':
      return typography(report);
    case 'component':
      return component(report, index);
    case 'motion':
      return motionItem(report, index);
    case 'transitions':
      return transitions(measured);
    case 'hook':
      return hook(report, measured);
    case 'structure':
      return structure(report, measured);
    case 'sound':
      return soundPart(report, measured);
  }
}

/** The sections whose look or motion is tied to how fast the video they came from cuts. */
const PACED: ReadonlySet<TeardownSection> = new Set([
  'palette',
  'typography',
  'component',
  'motion',
  'transitions',
]);

/** How fast the video cuts, kept beside a look or a motion so the fit check can compare paces. */
function videoPace(section: TeardownSection, measured: Measured): readonly MeasuredNumber[] {
  if (!PACED.has(section)) return [];
  const { shots } = measured;
  return [
    {
      label: 'Cuts a minute of its video',
      value: round(shots.cutsPerMinute),
      unit: 'a minute',
      method: shots.method,
    },
  ];
}

/**
 * The ingredient one section of a teardown makes; null when the teardown has
 * no measurements yet, or the section (or its numbered item) is not there.
 */
export function ingredientFromTeardown(
  report: TeardownReport,
  section: TeardownSection,
  index = 0,
): IngredientDraft | null {
  const measured = report.measured;
  if (measured === null) return null;
  const part = partOf(report, measured, section, index);
  if (part === null) return null;
  const title = report.about?.title ?? `Video ${report.videoId}`;
  const channelId = report.about?.channelId ?? null;
  const indexed = section === 'component' || section === 'motion';
  return {
    layer: LAYERS[section],
    name: shortName(`${part.name ?? NAMES[section]} · ${title}`),
    source: 'teardown',
    sourceKey: `${report.videoId}:${section}${indexed ? `:${index}` : ''}`,
    sourceLabel: `Teardown of “${shortName(title, 60)}”`,
    centerChannelId: null,
    channelIds: channelId === null ? [] : [channelId],
    details: { section, videoId: report.videoId, ...part.details },
    evidence: {
      score: null,
      scoredVideos: 0,
      videos: 1,
      channels: channelId === null ? null : 1,
      measured: [...part.measured, ...videoPace(section, measured)],
    },
    media: part.media,
  };
}
