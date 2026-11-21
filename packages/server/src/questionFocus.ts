/**
 * What a fixed question is told besides the channel. Everything in a focus
 * was chosen or checked in code: video ids, whole numbers, a length, a window
 * of days and, for a batch of concepts, the owner's one line.
 */
import { NO_FOCUS, type BreakdownFocus } from './breakdownParts';
import type { WindowFocus } from './formulaQuestions';
import type { ConceptFocus, ConceptsFocus } from './ideaQuestions';
import type { ScriptFocus } from './scriptQuestions';
import type { ExtrasFocus } from './extrasAnalyses';

/** The focus of an idea-lab question, told apart by its kind. */
export type LabFocus = ConceptsFocus | ConceptFocus | WindowFocus | ScriptFocus;
export type QuestionFocus = BreakdownFocus | LabFocus | ExtrasFocus;

/** The videos a breakdown rests on; none when the focus is absent or is another question's. */
export function breakdownFocusOf(focus: QuestionFocus | undefined): BreakdownFocus {
  return focus !== undefined && 'top' in focus ? focus : NO_FOCUS;
}

/**
 * The focus as the kind a question needs. Throws when it was given none or
 * another question's: such a question must never be asked half-filled.
 */
export function labFocusOf<K extends LabFocus['kind']>(
  focus: QuestionFocus | undefined,
  kind: K,
): Extract<LabFocus, { kind: K }> {
  if (focus === undefined || !('kind' in focus) || focus.kind !== kind) {
    throw new Error('This question was started without what it is to be asked about');
  }
  return focus as Extract<LabFocus, { kind: K }>;
}
