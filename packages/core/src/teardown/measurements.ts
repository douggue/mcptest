import { z } from 'zod';

/**
 * What a teardown measured in code, with the method each number came from.
 * Kept as JSON and checked again whenever it is read, so a number on the page
 * is always one this module wrote.
 */

const seconds = z.number().finite().nonnegative();
const decibels = z.number().finite();
const method = z.string().min(1).max(1500);
const file = z.string().regex(/^(?:k-\d{3}|s-\d{3}|hook|chapter-\d{2})\.jpg$/);
const span = z.object({ start: seconds, end: seconds });

const frameRange = {
  start: seconds,
  end: seconds,
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().nonnegative(),
  frames: z.number().int().positive(),
};
const transitionKind = z.enum(['cut', 'dissolve', 'fade-black', 'fade-white', 'flash', 'whip']);
const cameraKind = z.enum([
  'static',
  'push-in',
  'pull-out',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'shake',
]);
const count = z.number().int().nonnegative();
const motionSchema = z.object({
  method,
  fps: z.number().finite().positive(),
  frames: count,
  transitions: z.array(z.object({ ...frameRange, kind: transitionKind })).max(20_000),
  transitionCounts: z.record(transitionKind, count),
  holds: z.object({ count, totalSeconds: seconds }),
  animations: z.array(z.object({ ...frameRange, change: z.number().finite() })).max(1000),
  shots: z
    .array(
      z.object({
        shot: count,
        start: seconds,
        end: seconds,
        camera: cameraKind,
        panPerSecond: z.number().finite(),
        tiltPerSecond: z.number().finite(),
        zoomPerSecond: z.number().finite(),
        intensity: z.number().finite(),
      }),
    )
    .max(20_000),
  cameraCounts: z.record(cameraKind, count),
  strips: z
    .array(
      z.object({
        ...frameRange,
        id: z.string().regex(/^s-\d{3}$/),
        kind: z.union([
          transitionKind.exclude(['cut']),
          z.literal('animation'),
          cameraKind.exclude(['static']),
        ]),
        file,
        fromFrame: count,
        step: z.number().int().positive(),
        shownFrames: z.number().int().positive(),
        durationSeconds: seconds,
      }),
    )
    .max(60),
});
export type MotionMeasurements = z.infer<typeof motionSchema>;

export const measurementsSchema = z.object({
  version: z.literal(1),
  measuredAt: z.string().min(1).max(40),
  video: z.object({
    durationSeconds: z.number().finite().positive(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    fps: z.number().finite().positive().nullable(),
    hasAudio: z.boolean(),
    method,
  }),
  shots: z.object({
    threshold: z.number().finite().positive(),
    cuts: z.array(seconds).max(20_000),
    cutCount: z.number().int().nonnegative(),
    shotCount: z.number().int().positive(),
    medianSeconds: seconds,
    averageSeconds: seconds,
    cutsPerMinute: seconds,
    method,
  }),
  loudness: z
    .object({
      integratedLufs: decibels.nullable(),
      lraLu: decibels.nullable(),
      truePeakDbfs: decibels.nullable(),
      method,
    })
    .nullable(),
  quietDips: z
    .object({ thresholdDb: decibels, minSeconds: seconds, items: z.array(span).max(5000), method })
    .nullable(),
  peaks: z
    .object({
      thresholdDb: decibels,
      windowSeconds: z.number().finite().positive(),
      items: z.array(z.object({ at: seconds, peakDb: decibels })).max(5000),
      method,
    })
    .nullable(),
  palette: z.object({
    items: z
      .array(z.object({ hex: z.string().regex(/^#[0-9A-F]{6}$/), share: z.number().min(0).max(1) }))
      .max(20),
    method,
  }),
  keyframes: z
    .array(
      z.object({
        id: z.string().regex(/^k-\d{3}$/),
        at: seconds,
        shot: z.number().int().nonnegative(),
        covers: seconds,
        file,
      }),
    )
    .max(100),
  hookSheet: z
    .object({
      file,
      fromSeconds: seconds,
      toSeconds: seconds,
      columns: z.number().int().positive(),
      rows: z.number().int().positive(),
      method,
    })
    .nullable(),
  motion: motionSchema.nullable(),
  /** What could not be measured, one plain sentence each. */
  problems: z.array(z.string().max(400)).max(20),
});

export type TeardownMeasurements = z.infer<typeof measurementsSchema>;

/** Measurements read back from JSON; null when they are not ones this module wrote. */
export function parseMeasurements(json: string): TeardownMeasurements | null {
  try {
    const parsed = measurementsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
