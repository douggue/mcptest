import type { RunProgram } from '../downloads/program';
import { pathInside } from '../downloads/folder';
import {
  ANIMATION_ABOVE_USUAL,
  BLACK_LUMA,
  CAMERA_KINDS,
  DISSOLVE_ABOVE_USUAL,
  DISSOLVE_END_CHANGE,
  FADE_MIN_FRAMES,
  FLASH_JUMP,
  HOLD_SECONDS,
  PAN_RATE,
  SHAKE_PIXELS,
  STILL_DIFF,
  TRANSITION_KINDS,
  WHIP_DIFF,
  WHITE_LUMA,
  ZOOM_RATE,
  classifyMotion,
} from './motionClassify';
import { ANALYSIS_HEIGHT, ANALYSIS_WIDTH } from './motionFrames';
import { readFrameStream, type StreamProgram } from './motionStream';
import type { Span } from './parse';
import { motionEvents, planStrips, stripArgs, STRIP_FRAMES } from './strips';

/**
 * The motion layer of a teardown: every frame read and compared, the
 * transitions, holds, animations and camera moves classified, and a strip
 * of frames cut around the chosen ones.
 */

export interface MotionTools {
  readonly ffmpeg: string;
  readonly run: RunProgram;
  readonly stream?: StreamProgram | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** The rate assumed when the file does not say. */
const DEFAULT_FPS = 25;

export const MOTION_METHOD = [
  `every frame shrunk to ${ANALYSIS_WIDTH}×${ANALYSIS_HEIGHT} grey and compared with the one before (mean absolute difference; global shift and zoom from row and column brightness profiles).`,
  `Flash: ${FLASH_JUMP} grey levels brighter and back within 3 frames. Fade: at least ${FADE_MIN_FRAMES} frames ramping to black (≤${BLACK_LUMA}) or white (≥${WHITE_LUMA}).`,
  `Whip-like: 2 to 10 frames in a row changing ${WHIP_DIFF}% or more. Dissolve: ${DISSOLVE_ABOVE_USUAL}% above the usual change for 6 frames to 3 s, ends differing ${DISSOLVE_END_CHANGE}% or more.`,
  `Animation: ${ANIMATION_ABOVE_USUAL}% above the usual change for 3 frames or more with the camera still. Hold: under ${STILL_DIFF}% for ${HOLD_SECONDS} s or more.`,
  `Camera per shot (mean of its frames, top and bottom tenth left out): zoom ${ZOOM_RATE}%/s, pan or tilt ${PAN_RATE}% of the frame per s, shake ${SHAKE_PIXELS} px. Cuts come from the scene pass; one inside or at the edge of a flash or fade counts as that.`,
].join(' ');

const countBy = <K extends string>(kinds: readonly K[], items: readonly { readonly kind: K }[]) =>
  Object.fromEntries(
    kinds.map((kind) => [kind, items.filter((item) => item.kind === kind).length]),
  ) as Record<K, number>;

const round = (value: number): number => Math.round(value * 100) / 100;

export async function measureMotion(
  tools: MotionTools,
  path: string,
  folder: string,
  fpsKnown: number | null,
  cuts: readonly number[],
  shots: readonly Span[],
) {
  const fps = fpsKnown ?? DEFAULT_FPS;
  const read = await readFrameStream(tools.ffmpeg, path, fps, tools.stream, tools.signal);
  if (tools.signal?.aborted) throw new Error('the measuring was stopped because Jgtube is closing');
  if (read === null) return null;
  const findings = classifyMotion({ samples: read.samples, thumbs: read.thumbs, fps, cuts, shots });
  const strips = [];
  for (const strip of planStrips(motionEvents(findings, fps))) {
    const file = `${strip.id}.jpg`;
    const result = await tools.run(
      tools.ffmpeg,
      stripArgs(path, strip.fromFrame / fps, strip.step, pathInside(folder, file)),
      tools.signal,
    );
    if (result.code === 0) {
      strips.push({
        ...strip,
        file,
        shownFrames: STRIP_FRAMES,
        durationSeconds: round(strip.end - strip.start),
      });
    }
  }
  const shotsMotion = findings.shots.map((shot) => ({ ...shot, kind: shot.camera }));
  return {
    method: MOTION_METHOD,
    fps,
    frames: read.samples.length,
    transitions: [...findings.transitions],
    transitionCounts: countBy(TRANSITION_KINDS, findings.transitions),
    holds: {
      count: findings.holds.length,
      totalSeconds: round(findings.holds.reduce((sum, hold) => sum + hold.end - hold.start, 0)),
    },
    animations: [...findings.animations],
    shots: [...findings.shots],
    cameraCounts: countBy(CAMERA_KINDS, shotsMotion),
    strips,
  };
}
