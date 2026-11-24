/**
 * The small item in the top bar that says, on every view, which AI answers:
 * on Automatic the engine that would be tried first and is ready, else the
 * one the owner chose; and whether each engine is ready or not set up.
 */
import {
  AUTOMATIC,
  engineName,
  type EngineChoice,
  type EngineId,
  type EngineReport,
} from './analyses';

export interface EngineLine {
  readonly id: EngineId;
  readonly name: string;
  readonly ready: boolean;
  readonly state: 'ready' | 'not set up';
}

export interface AiBadge {
  /** The engine that answers, or what stands in for one. */
  readonly name: string;
  readonly automatic: boolean;
  /** Whether that engine can answer now. */
  readonly ready: boolean;
  /** One sentence for the badge's label and the settings view. */
  readonly summary: string;
  /** The answering engines in the order they are tried; one switched off comes last. */
  readonly lines: readonly EngineLine[];
}

const ANSWERING: ReadonlySet<string> = new Set<EngineId>(['agy', 'claude', 'codex']);
const isAnswering = (id: string): id is EngineId => ANSWERING.has(id);

function linesOf(report: EngineReport): readonly EngineLine[] {
  const rank = (id: EngineId): number => {
    const at = report.order.indexOf(id);
    return at === -1 ? report.order.length : at;
  };
  return report.engines
    .flatMap((status) => (isAnswering(status.id) ? [{ ...status, id: status.id }] : []))
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((status) => {
      const ready = status.ready && report.order.includes(status.id);
      return {
        id: status.id,
        name: engineName(status.id),
        ready,
        state: ready ? 'ready' : 'not set up',
      };
    });
}

function automaticBadge(lines: readonly EngineLine[]): AiBadge {
  const first = lines.find((line) => line.ready);
  return first
    ? {
        name: first.name,
        automatic: true,
        ready: true,
        summary: `Automatic: ${first.name} answers first.`,
        lines,
      }
    : {
        name: NONE_READY,
        automatic: true,
        ready: false,
        summary: 'Automatic: no AI is set up on this computer.',
        lines,
      };
}

/** What the badge says for the owner's choice and the engines the server reported. */
/** The badge's name while the server has not said which AI is set up, and when none is. */
const CHECKING = 'Checking';
const NONE_READY = 'No AI ready';

/** The answering engines that are set up and can be chosen; none before the report is in. */
export function readyEngines(report: EngineReport | null): ReadonlySet<string> {
  if (report === null) return new Set();
  return new Set(linesOf(report).flatMap((line) => (line.ready ? [line.id] : [])));
}

export function aiBadge(choice: EngineChoice, report: EngineReport | null): AiBadge {
  if (report === null) {
    return {
      name: CHECKING,
      automatic: choice === AUTOMATIC,
      ready: false,
      summary: 'Checking which AI is set up on this computer.',
      lines: [],
    };
  }
  const lines = linesOf(report);
  if (choice === AUTOMATIC) return automaticBadge(lines);
  const name = engineName(choice);
  const ready = lines.some((line) => line.id === choice && line.ready);
  return {
    name,
    automatic: false,
    ready,
    summary: `Chosen: only ${name} answers${ready ? '' : ', and it is not set up'}.`,
    lines,
  };
}

/**
 * Who answers, in the few words the Ask header has room for: "Checking…"
 * while the server has not said, the AI's name when it is ready, and plainly
 * that it is not set up when it is not.
 */
export function answersLine(badge: Pick<AiBadge, 'name' | 'ready'>): string {
  if (badge.ready) return `${badge.name} answers`;
  if (badge.name === CHECKING) return 'Checking…';
  return badge.name === NONE_READY ? NONE_READY : `${badge.name} is not set up`;
}
