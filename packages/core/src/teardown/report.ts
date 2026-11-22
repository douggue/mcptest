import { MAX_CHAPTERS } from './constants';
import type { TeardownMeasurements } from './measurements';
import type { Span } from './parse';
import { shotStats } from './shots';
import { stageSchemas, type StageData, type TeardownStage } from './stages';
import { quoteFound, wordStats, type TimedLine, type WordStats } from './words';

/**
 * A teardown put together from its stored parts: what code measured, what
 * each engine judged (checked again here), and what code adds to the judged
 * parts so they can be trusted: per-chapter numbers, the narration of the
 * hook from the transcript, measured sound where none was heard, colours
 * kept only when measured, keyframes and strips kept only when they exist,
 * and quotes marked found or not found in the transcript.
 */

export type TranscriptSource = 'captions' | 'heard' | 'none';

export interface StoredTranscript {
  readonly source: TranscriptSource;
  readonly lines: readonly TimedLine[];
}

export interface TeardownAbout {
  readonly title: string;
  readonly source: 'youtube' | 'file';
  readonly channelId: string | null;
  /** How the video was seen, one plain line each. */
  readonly seen: readonly string[];
}

export type StageState<S extends TeardownStage> =
  | { readonly state: 'done'; readonly engine: string; readonly data: StageData<S> }
  | { readonly state: 'failed' | 'missing'; readonly reason: string };

export interface ChapterRow {
  readonly index: number;
  readonly title: string;
  readonly role: string;
  readonly summary: string;
  readonly start: number;
  readonly end: number;
  readonly cutsPerMinute: number;
  readonly medianShotSeconds: number;
  readonly wordsPerMinute: number | null;
  readonly transitions: number;
  readonly animations: number;
  /** Mean change a frame over the chapter (%), from the motion pass. */
  readonly motionIntensity: number | null;
  readonly sheet: string | null;
}

export interface HookRow {
  readonly start: number;
  readonly end: number;
  readonly visual: string;
  readonly camera: string;
  readonly onScreenText: string;
  /** From the transcript, by time. */
  readonly narration: string;
  readonly sound: string;
  readonly soundFrom: 'heard' | 'measured' | 'none';
}

export interface TeardownInput {
  readonly videoId: string;
  readonly about: TeardownAbout | null;
  readonly measured: TeardownMeasurements | null;
  readonly measuredProblem: string | null;
  readonly transcript: StoredTranscript | null;
  /** The chapter sheets made, by chapter number from 1. */
  readonly sheets: Readonly<Record<string, string>>;
  readonly stages: {
    readonly [S in TeardownStage]?:
      { readonly engine: string; readonly json: string } | { readonly problem: string };
  };
}

const STAGE_NAMES: readonly TeardownStage[] = Object.keys(stageSchemas) as TeardownStage[];
const NOT_RUN = 'Not made yet.';
const EVEN_CHAPTER_SECONDS = 60;
const EVEN_CHAPTERS = 5;

function stageOf<S extends TeardownStage>(stage: S, input: TeardownInput): StageState<S> {
  const stored = input.stages[stage];
  if (stored === undefined) return { state: 'missing', reason: NOT_RUN };
  if ('problem' in stored) return { state: 'failed', reason: stored.problem };
  try {
    const parsed = stageSchemas[stage].safeParse(JSON.parse(stored.json));
    if (parsed.success)
      return { state: 'done', engine: stored.engine, data: parsed.data as StageData<S> };
  } catch {
    // Unreadable: treated as failed below.
  }
  return { state: 'failed', reason: 'What was stored could not be read back.' };
}

const clampSpan = (span: Span, end: number): Span => ({
  start: Math.max(0, Math.min(span.start, end)),
  end: Math.max(0, Math.min(Math.max(span.end, span.start), end)),
});

/** The chapters an engine named, else the video cut into even parts (and said so). */
function chapterSpans(structure: StageState<'structure'>, duration: number) {
  if (structure.state === 'done') {
    const named = structure.data.chapters
      .map((chapter) => ({ ...chapter, ...clampSpan(chapter, duration) }))
      .filter((chapter) => chapter.end > chapter.start)
      .slice(0, MAX_CHAPTERS);
    if (named.length > 0) return { from: 'engine' as const, items: named };
  }
  const count = Math.max(1, Math.min(EVEN_CHAPTERS, Math.ceil(duration / EVEN_CHAPTER_SECONDS)));
  const items = Array.from({ length: count }, (_, index) => ({
    title: `Part ${index + 1}`,
    role: 'even split',
    summary: 'Cut evenly in code: no chapters were named.',
    start: (index * duration) / count,
    end: ((index + 1) * duration) / count,
  }));
  return { from: 'even' as const, items };
}

const inSpan = (at: number, span: Span): boolean => at >= span.start && at < span.end;

function chapterRows(
  spans: ReturnType<typeof chapterSpans>['items'],
  input: TeardownInput,
  measured: TeardownMeasurements,
): readonly ChapterRow[] {
  const motion = measured.motion;
  const lines = input.transcript?.lines ?? [];
  return spans.map((span, index) => {
    const shots = shotStats(measured.shots.cuts, span);
    const frames =
      motion?.shots.filter((shot) => shot.start < span.end && shot.end > span.start) ?? [];
    return {
      index: index + 1,
      title: span.title,
      role: span.role,
      summary: span.summary,
      start: span.start,
      end: span.end,
      cutsPerMinute: shots.cutsPerMinute,
      medianShotSeconds: shots.medianSeconds,
      wordsPerMinute: lines.length === 0 ? null : wordStats(lines, span).wordsPerMinute,
      transitions: motion?.transitions.filter((item) => inSpan(item.start, span)).length ?? 0,
      animations: motion?.animations.filter((item) => inSpan(item.start, span)).length ?? 0,
      motionIntensity:
        frames.length === 0
          ? null
          : Math.round(
              (frames.reduce((sum, shot) => sum + shot.intensity, 0) / frames.length) * 100,
            ) / 100,
      sheet: input.sheets[String(index + 1)] ?? null,
    };
  });
}

const clock = (seconds: number): string => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** What was measured of the sound inside one span, when nothing was heard. */
function measuredSound(span: Span, measured: TeardownMeasurements | null): string {
  if (measured === null) return '';
  const dips = (measured.quietDips?.items ?? [])
    .filter((dip) => dip.start < span.end && dip.end > span.start)
    .map((dip) => `quiet dip ${clock(dip.start)}–${clock(dip.end)}`);
  const peaks = (measured.peaks?.items ?? [])
    .filter((peak) => inSpan(peak.at, span))
    .map((peak) => `peak ${peak.peakDb} dBFS at ${clock(peak.at)}`);
  return [...dips, ...peaks].join('; ');
}

function hookRows(
  input: TeardownInput,
  hook: StageState<'hook'>,
  watch: StageState<'watch'>,
): readonly HookRow[] {
  if (hook.state !== 'done') return [];
  const lines = input.transcript?.lines ?? [];
  const heard = watch.state === 'done' ? watch.data.hook : [];
  return hook.data.rows.map((row) => {
    const said = lines
      .filter((line) => inSpan(line.at, row))
      .map((line) => line.text.trim())
      .join(' ');
    const sound = heard
      .filter((item) => item.start < row.end && item.end > row.start)
      .map((item) => item.sound)
      .join(' ');
    const measuredText = measuredSound(row, input.measured);
    return {
      ...row,
      narration: said,
      sound: sound !== '' ? sound : measuredText,
      soundFrom: sound !== '' ? 'heard' : measuredText !== '' ? 'measured' : 'none',
    };
  });
}

export function buildTeardownReport(input: TeardownInput) {
  const stages = Object.fromEntries(STAGE_NAMES.map((stage) => [stage, stageOf(stage, input)])) as {
    readonly [S in TeardownStage]: StageState<S>;
  };
  const measured = input.measured;
  const duration = measured?.video.durationSeconds ?? 0;
  const spans = chapterSpans(stages.structure, duration);
  const lines = input.transcript?.lines ?? [];
  const palette = new Set(measured?.palette.items.map((colour) => colour.hex) ?? []);
  const keyframes = new Map(measured?.keyframes.map((frame) => [frame.id, frame]) ?? []);
  const strips = new Map(measured?.motion?.strips.map((strip) => [strip.id, strip]) ?? []);
  const words: WordStats | null =
    lines.length === 0 || duration === 0 ? null : wordStats(lines, { start: 0, end: duration });
  return {
    videoId: input.videoId,
    about: input.about,
    measured,
    measuredProblem: input.measuredProblem,
    transcript: { source: input.transcript?.source ?? 'none', lineCount: lines.length, words },
    chapters: {
      from: spans.from,
      items: measured === null ? [] : chapterRows(spans.items, input, measured),
    },
    stages,
    hookRows: hookRows(input, stages.hook, stages.watch),
    colourModes:
      stages.design.state === 'done'
        ? stages.design.data.colourModes.map((mode) => {
            const hexes = mode.hexes.map((hex) => `#${hex.replace('#', '').toUpperCase()}`);
            return {
              ...mode,
              hexes: hexes.filter((hex) => palette.has(hex)),
              unmeasured: hexes.filter((hex) => !palette.has(hex)),
            };
          })
        : [],
    archetypes:
      stages.archetypes.state === 'done'
        ? stages.archetypes.data.items.map((item) => ({
            ...item,
            image: item.keyframe === null ? null : (keyframes.get(item.keyframe)?.file ?? null),
          }))
        : [],
    techniques:
      stages.techniques.state === 'done'
        ? stages.techniques.data.items.map((item) => ({
            ...item,
            quotes: item.quotes.map((quote) => ({
              ...quote,
              found: quoteFound(lines, quote.text),
            })),
          }))
        : [],
    animations:
      stages.motion.state === 'done'
        ? stages.motion.data.items.map((item) => {
            const shown = item.strips.flatMap((id) => strips.get(id) ?? []);
            return { ...item, shown };
          })
        : [],
    soundHeard:
      stages.watch.state === 'done' &&
      stages.watch.data.chapters.some((chapter) => chapter.sound !== ''),
  };
}

export type TeardownReport = ReturnType<typeof buildTeardownReport>;
