import { parseMinutes } from '@jgtube/core/src/script/length';
import { useEffect, useState } from 'react';
import { lengthFields, rangeNote, readWords } from '../lib/scriptLength';
import type { ScriptView } from '../lib/scriptWriter';
import { FIELD } from './LabStatus';
import type { Script } from './useScript';

const LABEL = 'text-label-caps uppercase text-outline';

/**
 * The script's length in two fields kept in step: minutes (12:30 allowed) or
 * words. The one typed last is stored; the other follows through the rate.
 */
export function ScriptLengthFields({
  script,
  view,
}: {
  readonly script: Script;
  readonly view: ScriptView;
}) {
  const stored = view.script;
  const shown = lengthFields(
    stored?.targetSeconds ?? null,
    stored?.wordsPerMinute ?? null,
    view.typedLength ?? null,
  );
  const [minutes, setMinutes] = useState(shown.minutes);
  const [words, setWords] = useState(shown.words);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setMinutes(shown.minutes);
    setWords(shown.words);
  }, [shown.minutes, shown.words]);

  const takeMinutes = (): void => {
    if (minutes === shown.minutes) return;
    const seconds = parseMinutes(minutes);
    if (seconds === null) {
      setProblem('Type minutes as 12 or 12:30.');
      return;
    }
    setProblem(null);
    script.setLength({ typed: 'minutes', seconds });
  };
  const takeWords = (): void => {
    if (words === shown.words) return;
    const count = readWords(words);
    if (count === null) {
      setProblem('Type the words as a whole number, such as 1800.');
      return;
    }
    setProblem(null);
    script.setLength({ typed: 'words', words: count });
  };
  const enter = (take: () => void) => (event: { key: string }) => {
    if (event.key === 'Enter') take();
  };
  const note = stored?.targetSeconds ? rangeNote(stored.targetSeconds, view.lengthRange) : '';
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>Length, minutes</span>
          <input
            type="text"
            inputMode="decimal"
            value={minutes}
            placeholder="12:30"
            onChange={(event) => setMinutes(event.target.value)}
            onBlur={takeMinutes}
            onKeyDown={enter(takeMinutes)}
            className={FIELD}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={LABEL}>or words</span>
          <input
            type="text"
            inputMode="numeric"
            value={words}
            placeholder={stored?.wordsPerMinute ? '1800' : 'Set a rate first'}
            onChange={(event) => setWords(event.target.value)}
            onBlur={takeWords}
            onKeyDown={enter(takeWords)}
            className={FIELD}
          />
        </label>
      </div>
      {problem && <span className="text-body-sm text-error">{problem}</span>}
      {note && <span className="text-body-sm text-outline">{note}</span>}
    </div>
  );
}
