/**
 * The picture check as the page shows it: which engines see pictures, which
 * could be checked, and one line on each result. The server keeps the results.
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

/** The engines known to see pictures without a check, as the server's PICTURE_ENGINES. */
export const PICTURE_ENGINES: readonly EngineId[] = ['claude', 'codex'];

const checksOf = (report: EngineReport | null): readonly PictureCheck[] =>
  report?.pictureChecks ?? [];

/** The engines that see pictures: Claude Code and Codex, then any whose last check passed. */
export function seeingEngines(report: EngineReport | null): readonly EngineId[] {
  const passed = checksOf(report)
    .filter((check) => check.passed && !PICTURE_ENGINES.includes(check.engine))
    .map((check) => check.engine);
  return [...PICTURE_ENGINES, ...passed];
}

export interface CheckableEngine {
  readonly engine: EngineId;
  readonly check: PictureCheck | null;
}

/** The engines in use that are not known to see pictures, each with its last check. */
export const enginesToCheck = (report: EngineReport | null): readonly CheckableEngine[] =>
  (report?.order ?? [])
    .filter((engine) => !PICTURE_ENGINES.includes(engine))
    .map((engine) => ({
      engine,
      check: checksOf(report).find((check) => check.engine === engine) ?? null,
    }));

/** One line on a check's result; empty before one has run. */
export function pictureCheckLine(check: PictureCheck | null): string {
  if (check === null) return '';
  if (check.passed) return 'Sees pictures: picture questions can use it.';
  const said = check.answer.trim() === '' ? 'it gave no answer.' : `it answered “${check.answer}”`;
  return `Did not see the pictures: ${said} The pictures were ${check.shown.join(' and ')}.`;
}

/** The report with a new result in place of the engine's last one. */
export function withCheck(report: EngineReport | null, check: PictureCheck): EngineReport | null {
  if (report === null) return null;
  const others = checksOf(report).filter((entry) => entry.engine !== check.engine);
  return { ...report, pictureChecks: [...others, check] };
}
