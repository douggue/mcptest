/**
 * Reading what ffprobe and ffmpeg print into numbers. Pure functions: the
 * programs are started elsewhere, and a test can hand these their output.
 * A value the output does not hold is null, never guessed.
 */

export interface ProbedVideo {
  readonly durationSeconds: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly hasAudio: boolean;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface LoudnessSummary {
  readonly integratedLufs: number | null;
  readonly lraLu: number | null;
  readonly truePeakDbfs: number | null;
}

export interface PeakWindow {
  readonly at: number;
  readonly peakDb: number;
}

const DECIMALS = 2;
const round = (value: number, places = DECIMALS): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const numberOr = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return typeof value !== 'boolean' && value !== '' && Number.isFinite(parsed) ? parsed : null;
};

/** A frame rate as ffprobe writes it ("30000/1001"), as frames a second. */
export function frameRate(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const [top, bottom = '1'] = text.split('/');
  const rate = Number(top) / Number(bottom);
  return Number.isFinite(rate) && rate > 0 ? round(rate) : null;
}

interface ProbeStream {
  readonly codec_type?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly avg_frame_rate?: unknown;
  readonly r_frame_rate?: unknown;
  readonly duration?: unknown;
}

/** ffprobe's JSON (`-show_streams -show_format`) as the facts a teardown keeps; null when it has no length. */
export function parseProbe(json: string): ProbedVideo | null {
  let data: { streams?: unknown; format?: { duration?: unknown } };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    return null;
  }
  const streams = (Array.isArray(data.streams) ? data.streams : []) as ProbeStream[];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const duration = numberOr(data.format?.duration) ?? numberOr(video?.duration);
  if (duration === null || duration <= 0) return null;
  return {
    durationSeconds: round(duration),
    width: numberOr(video?.width),
    height: numberOr(video?.height),
    fps: frameRate(video?.avg_frame_rate) ?? frameRate(video?.r_frame_rate),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

/** The times `showinfo` printed for the frames a scene filter let through: the cuts, in order. */
export function parseSceneCuts(stderr: string): readonly number[] {
  const times = [...stderr.matchAll(/pts_time:\s*(-?[\d.]+)/g)].map((match) => Number(match[1]));
  const cuts = times
    .filter((time) => Number.isFinite(time) && time > 0)
    .map((time) => round(time, 3));
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/** The summary the `ebur128` filter prints at the end: integrated loudness, range and true peak. */
export function parseEbur128(stderr: string): LoudnessSummary {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const value = (pattern: RegExp): number | null => {
    if (!stderr.includes('Summary:')) return null;
    const match = pattern.exec(summary);
    return match ? numberOr(match[1]) : null;
  };
  return {
    integratedLufs: value(/\bI:\s*(-?[\d.]+)\s*LUFS/),
    lraLu: value(/\bLRA:\s*(-?[\d.]+)\s*LU\b/),
    truePeakDbfs: value(/\bPeak:\s*(-?[\d.]+)\s*dBFS/),
  };
}

/**
 * The quiet stretches `silencedetect` printed, each from its start to its
 * end. One still quiet when the file ends closes at the video's end.
 */
export function parseSilences(stderr: string, durationSeconds: number): readonly Span[] {
  const marks = [...stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)];
  const spans: Span[] = [];
  let open: number | null = null;
  for (const [, kind, time] of marks) {
    const at = Math.max(0, Number(time));
    if (kind === 'start') open = at;
    else if (open !== null) {
      spans.push({ start: round(open), end: round(at) });
      open = null;
    }
  }
  if (open !== null && durationSeconds > open) {
    spans.push({ start: round(open), end: round(durationSeconds) });
  }
  return spans;
}

/** The peak of each window `astats` measured, from the lines `ametadata` printed. */
export function parsePeakWindows(stderr: string): readonly PeakWindow[] {
  const windows: PeakWindow[] = [];
  let at: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const time = /pts_time:\s*(-?[\d.]+)/.exec(line);
    if (time) at = Number(time[1]);
    const peak = /Peak_level=(-?[\d.]+|-inf)/.exec(line);
    if (peak && at !== null) {
      const value = peak[1] === '-inf' ? -Infinity : Number(peak[1]);
      if (!Number.isNaN(value)) windows.push({ at: round(at), peakDb: round(value, 1) });
      at = null;
    }
  }
  return windows;
}

/**
 * The peak impacts: windows louder than `thresholdDb` whose window before was
 * not, so a long loud stretch counts once, at its start.
 */
export function peakImpacts(
  windows: readonly PeakWindow[],
  thresholdDb: number,
): readonly PeakWindow[] {
  return windows.filter(
    (window, index) =>
      window.peakDb > thresholdDb &&
      (index === 0 || (windows[index - 1]?.peakDb ?? -Infinity) <= thresholdDb),
  );
}
