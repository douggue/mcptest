import type { TeardownReport } from '@jgtube/core';
import { apiCaller, type Fetch } from './api';

/**
 * The production teardown of one video as the page shows it: the measured
 * numbers with their methods, the mixes counted in code, where its pictures
 * are served from, and how many AI runs one would take. The shapes are the
 * server's; every number here is one the server measured.
 */

export type TeardownView = TeardownReport;

export interface TeardownRuns {
  readonly runs: number;
  readonly kept: number;
  readonly watch: boolean;
}

export interface MetricRow {
  readonly label: string;
  readonly value: string;
  readonly method: string;
}

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;

const base = (videoId: string): string => `/api/video-teardowns/${encodeURIComponent(videoId)}`;
export const imageUrl = (videoId: string, name: string): string =>
  `${base(videoId)}/images/${encodeURIComponent(name)}`;
export const markdownUrl = (videoId: string): string => `${base(videoId)}/teardown.md`;
export const zipUrl = (videoId: string): string => `${base(videoId)}/export.zip`;

/** The measured numbers as rows, each with the method it was measured by. */
export function metricRows(view: TeardownView): readonly MetricRow[] {
  const m = view.measured;
  if (m === null) return [];
  const words = view.transcript.words;
  const heard = view.transcript.source === 'heard' ? 'the words an engine heard' : 'the captions';
  const rows: MetricRow[] = [
    {
      label: 'Runtime',
      value: `${clock(m.video.durationSeconds)} (${m.video.durationSeconds} s)`,
      method: m.video.method,
    },
    {
      label: 'Picture',
      value: `${m.video.width ?? '?'}×${m.video.height ?? '?'} at ${m.video.fps ?? '?'} fps`,
      method: m.video.method,
    },
    {
      label: 'Shot pacing',
      value: `${m.shots.cutCount} cuts · median shot ${m.shots.medianSeconds} s · average ${m.shots.averageSeconds} s · ${m.shots.cutsPerMinute} cuts/min`,
      method: m.shots.method,
    },
  ];
  if (words !== null) {
    rows.push({
      label: 'Words',
      value: `${words.wordCount} words · ${words.wordsPerMinute} words/min · median sentence ${words.medianSentenceWords} words`,
      method: `counted in code from ${heard}`,
    });
  }
  if (m.loudness !== null) {
    rows.push({
      label: 'Loudness',
      value: `${m.loudness.integratedLufs ?? '?'} LUFS · range ${m.loudness.lraLu ?? '?'} LU · true peak ${m.loudness.truePeakDbfs ?? '?'} dBFS`,
      method: m.loudness.method,
    });
  }
  if (m.quietDips !== null)
    rows.push({
      label: 'Quiet dips',
      value: String(m.quietDips.items.length),
      method: m.quietDips.method,
    });
  if (m.peaks !== null)
    rows.push({
      label: 'Peak impacts',
      value: String(m.peaks.items.length),
      method: m.peaks.method,
    });
  return rows;
}

const KIND_NAMES: Readonly<Record<string, string>> = {
  cut: 'Hard cut',
  dissolve: 'Dissolve',
  'fade-black': 'Fade to or from black',
  'fade-white': 'Fade to or from white',
  flash: 'Flash',
  whip: 'Whip-like',
  static: 'Still camera',
  'push-in': 'Push in',
  'pull-out': 'Pull out',
  'pan-left': 'Pan left',
  'pan-right': 'Pan right',
  'tilt-up': 'Tilt up',
  'tilt-down': 'Tilt down',
  shake: 'Shake',
  animation: 'On-screen animation',
};
export const kindName = (kind: string): string => KIND_NAMES[kind] ?? kind;

/** A count per kind, the most frequent first, kinds never seen left out. */
export function mixRows(
  counts: Readonly<Record<string, number>>,
): readonly { readonly kind: string; readonly count: number }[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ kind: kindName(kind), count }))
    .sort((a, b) => b.count - a.count);
}

/** The stage's state in one line when it was not made; null when it was. */
export function stageProblem(
  view: TeardownView,
  stage: keyof TeardownView['stages'],
): string | null {
  const state = view.stages[stage];
  return state.state === 'done' ? null : state.reason;
}

/** Who judged a stage, for the line under its heading. */
export function judgedBy(
  view: TeardownView,
  stage: keyof TeardownView['stages'],
  names: (engine: string) => string,
): string | null {
  const state = view.stages[stage];
  return state.state === 'done'
    ? `The AI's reading (${names(state.engine)}), checked in code.`
    : null;
}

/** What the AI runs come to, in one line, before starting. */
export function runsLine(runs: TeardownRuns): string {
  if (runs.runs === 0) return 'Everything is kept from the last run: no AI run is needed.';
  const watch = runs.watch ? ', one of them watching it with sound' : '';
  const kept =
    runs.kept > 0
      ? ` ${runs.kept} part${runs.kept === 1 ? ' is' : 's are'} kept from the last run.`
      : '';
  return `This takes up to ${runs.runs} AI run${runs.runs === 1 ? '' : 's'}${watch}, plus measuring in code.${kept}`;
}

export function createTeardownApi(fetcher?: Fetch) {
  const { call, unwrap } = apiCaller(fetcher);
  return {
    async runs(videoId: string | null, fresh: boolean): Promise<TeardownRuns> {
      const query = new URLSearchParams({
        ...(videoId === null ? {} : { video: videoId }),
        ...(fresh ? { fresh: '1' } : {}),
      });
      return unwrap<TeardownRuns>(await call(`/api/video-teardowns/runs?${query.toString()}`));
    },
  };
}
