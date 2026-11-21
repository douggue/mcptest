import { useState } from 'react';
import { engineName, type EngineId, type EngineReport } from '../lib/analyses';
import { enginesToCheck, pictureCheckLine, type PictureCheck } from '../lib/pictureCheck';
import { useRunningOnOpen } from './useReattach';

interface Props {
  readonly report: EngineReport | null;
  /** An AI run is under way: a check waits until it is done. */
  readonly busy: boolean;
  readonly check: (engine: EngineId) => Promise<PictureCheck>;
}

type Running = { readonly engine: EngineId } | null;

const PICTURE_KINDS: readonly string[] = ['picture-check'];

const QUIET =
  'min-h-11 self-start rounded-lg border border-border-subtle px-3 py-1.5 text-body-sm text-on-surface-variant transition-colors hover:border-border-highlight hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50';

/**
 * For each engine not known to see pictures: a quiet button that runs the
 * picture check, and the last result. A pass lets the picture questions use it.
 */
export function PictureChecks({ report, busy, check }: Props) {
  const [started, setStarted] = useState<Running>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A check started before the owner left Settings still runs; its result arrives by itself.
  const elsewhere = useRunningOnOpen(PICTURE_KINDS);
  const running: Running =
    started ?? (elsewhere?.engine ? { engine: elsewhere.engine as EngineId } : null);
  const engines = enginesToCheck(report);
  if (engines.length === 0) return null;

  const start = (engine: EngineId): void => {
    setStarted({ engine });
    setProblem(null);
    check(engine)
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : 'The picture check did not finish.'),
      )
      .finally(() => setStarted(null));
  };

  return (
    <ul className="flex flex-col gap-space-sm">
      {engines.map(({ engine, check: last }) => {
        const line = pictureCheckLine(last);
        const working = running?.engine === engine;
        return (
          <li key={engine} className="flex min-w-0 flex-col gap-1">
            <p className={`text-body-sm ${last?.passed ? 'text-primary' : 'text-outline'}`}>
              {engineName(engine)}: {line || 'not checked for pictures yet.'}
            </p>
            {!last?.passed && (
              <button
                type="button"
                className={QUIET}
                disabled={busy || running !== null}
                onClick={() => start(engine)}
              >
                {working ? 'Checking…' : 'Check it can see pictures'}
              </button>
            )}
            {working && (
              <p className="text-body-sm text-outline">
                Shows it two small pictures and asks their colours. Takes up to three minutes.
              </p>
            )}
            {problem && !working && running === null && (
              <p role="alert" className="text-body-sm text-error">
                {problem}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
