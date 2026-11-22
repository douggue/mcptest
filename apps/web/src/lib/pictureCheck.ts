/**
 * The picture check as the page shows it: which engines see pictures, which
 * could be checked, and one line on each result. The server keeps the results.
 *
 * Every engine sees pictures by default: Claude Code and Codex through a
 * tool, Antigravity as files written into its folder. The check is an
 * optional diagnostic; only a failed check keeps Antigravity from questions
 * about pictures.
 */
import type { EngineId, EngineReport } from './analyses';

/** One engine's last picture check, as the server keeps it. */
export interface PictureCheck {
  readonly engine: EngineId;
  readonly passed: boolean;
  /** What the engine answered, cut to one short line. */
  readonly answer: string;
  /** The colours that were shown, in order. */
  readonly shown: readonly string[];
  readonly checkedAt: string;
}

/** The engines that see a tool's pictures and need no check, as the server's TOOL_PICTURE_ENGINES. */
export const TOOL_PICTURE_ENGINES: readonly EngineId[] = ['claude', 'codex'];
/** Every engine that sees pictures by default, as the server's PICTURE_ENGINES. */
export const PICTURE_ENGINES: readonly EngineId[] = [...TOOL_PICTURE_ENGINES, 'agy'];

const checksOf = (report: EngineReport | null): readonly PictureCheck[] =>
  report?.pictureChecks ?? [];

/** Whether an engine's last picture check failed: the only thing that keeps it from pictures. */
export const failedCheck = (report: EngineReport | null, engine: EngineId): boolean =>
  checksOf(report).some((check) => check.engine === engine && !check.passed);

/** The engines that see pictures: all of them, less one whose last picture check failed. */
export const seeingEngines = (report: EngineReport | null): readonly EngineId[] =>
  PICTURE_ENGINES.filter(
    (engine) => TOOL_PICTURE_ENGINES.includes(engine) || !failedCheck(report, engine),
  );

export interface CheckableEngine {
  readonly engine: EngineId;
  readonly check: PictureCheck | null;
}

/** The engines in use that are shown pictures as files, each with its last check. */
export const enginesToCheck = (report: EngineReport | null): readonly CheckableEngine[] =>
  (report?.order ?? [])
    .filter((engine) => !TOOL_PICTURE_ENGINES.includes(engine))
    .map((engine) => ({
      engine,
      check: checksOf(report).find((check) => check.engine === engine) ?? null,
    }));

/** One line on an engine's last check, or on what it does before one has run. */
export function pictureCheckLine(check: PictureCheck | null): string {
  if (check === null) {
    return 'Sees pictures as files; the check is optional. Run it if its picture answers look wrong.';
  }
  if (check.passed) return 'Passed the picture check: it named both colours.';
  const said = check.answer.trim() === '' ? 'it gave no answer.' : `it answered “${check.answer}”`;
  return `Did not see the pictures: ${said} The pictures were ${check.shown.join(' and ')}. Until it passes, questions about pictures go to Claude Code or Codex.`;
}

/** The report with a new result in place of the engine's last one. */
export function withCheck(report: EngineReport | null, check: PictureCheck): EngineReport | null {
  if (report === null) return null;
  const others = checksOf(report).filter((entry) => entry.engine !== check.engine);
  return { ...report, pictureChecks: [...others, check] };
}
