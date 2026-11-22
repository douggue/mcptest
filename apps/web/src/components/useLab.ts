import type { ConceptLength, DroppedFormula } from '@jgtube/core';
import { FORMULA_DEFAULT_WINDOW_DAYS } from '@jgtube/core/src/formulas/formulas';
import { useCallback, useEffect, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import type { HookLibrary } from '../lib/hookLibrary';
import {
  batchRequest,
  togglePick,
  withKept,
  withThumbnail,
  type AnswerOutcome,
  type ConceptThumbnailView,
  type ConceptView,
  type LabChoices,
  type Pick,
} from '../lib/ideaLab';
import type { FormulaList, LabApi, LabOutcome } from '../lib/labApi';
import type { LabJobs } from './useLabJob';

/** What the last formula run left out, for the page to say so. */
export interface FormulaNotes {
  readonly proposed: number;
  readonly unread: number;
  readonly dropped: readonly DroppedFormula[];
}

export interface Lab {
  readonly jobs: LabJobs;
  /** The channel's concepts, kept ones first; null until they are read. */
  readonly concepts: readonly ConceptView[] | null;
  /** One plain sentence about the last batch when it came back short. */
  readonly conceptNote: string | null;
  readonly whereElse: AnswerOutcome | null;
  readonly picks: readonly Pick[];
  readonly choices: LabChoices;
  readonly formulas: FormulaList | null;
  readonly formulaNotes: FormulaNotes | null;
  readonly formulaWindow: number;
  readonly library: HookLibrary | null;
  /** The thumbnail prompts of the channel's concepts; null until they are read. */
  readonly thumbnails: readonly ConceptThumbnailView[] | null;
  /** Something the owner did that could not be stored. */
  readonly problem: string | null;
  readonly pick: (pick: Pick) => void;
  readonly choose: (changes: Partial<LabChoices>) => void;
  readonly setFormulaWindow: (days: number) => void;
  readonly generate: () => void;
  readonly grow: (kind: 'twist' | 'more', conceptId: number) => void;
  readonly keep: (conceptId: number, kept: boolean) => void;
  /** Asks for a concept's thumbnail prompt, replacing the one stored. */
  readonly writeThumbnail: (conceptId: number) => void;
  readonly clear: () => void;
  readonly askWhereElse: () => void;
  readonly findFormulas: () => void;
  readonly buildHooks: () => void;
  readonly nameHooks: () => void;
}

const NO_CHOICES: LabChoices = { format: '', angle: '', length: 'long' satisfies ConceptLength };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'It could not be stored';

/**
 * The idea lab for the channel on screen: its concepts, title formulas and
 * hook library, what the owner picked, and the jobs that fill them. Each is
 * read when a map comes on screen and again when a job of its kind finishes.
 * Everything is asked for by the centre channel's id, so nothing from another
 * channel's map is ever shown.
 */
export function useLab(
  api: LabApi,
  jobs: LabJobs,
  centerId: string | null,
  mapId: number | null,
  engine: EngineChoice,
): Lab {
  const [concepts, setConcepts] = useState<readonly ConceptView[] | null>(null);
  const [conceptNote, setConceptNote] = useState<string | null>(null);
  const [whereElse, setWhereElse] = useState<AnswerOutcome | null>(null);
  const [picks, setPicks] = useState<readonly Pick[]>([]);
  const [choices, setChoices] = useState<LabChoices>(NO_CHOICES);
  const [formulas, setFormulas] = useState<FormulaList | null>(null);
  const [formulaNotes, setFormulaNotes] = useState<FormulaNotes | null>(null);
  const [formulaWindow, setFormulaWindow] = useState<number>(FORMULA_DEFAULT_WINDOW_DAYS);
  const [library, setLibrary] = useState<HookLibrary | null>(null);
  const [thumbnails, setThumbnails] = useState<readonly ConceptThumbnailView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Another channel on screen: nothing picked or answered for the last one carries over.
  useEffect(() => {
    setPicks([]);
    setChoices(NO_CHOICES);
    setWhereElse(null);
    setConceptNote(null);
    setFormulaNotes(null);
    setProblem(null);
  }, [centerId]);

  const readConcepts = useCallback(() => {
    if (centerId === null) return;
    api
      .concepts(centerId)
      .then(setConcepts)
      .catch((error: unknown) => setProblem(messageOf(error)));
  }, [api, centerId]);

  useEffect(() => {
    setConcepts(null);
    setLibrary(null);
    setThumbnails(null);
    if (centerId === null) return;
    readConcepts();
    api
      .conceptThumbnails(centerId)
      .then(setThumbnails)
      .catch(() => undefined);
    api
      .hooks(centerId)
      .then(setLibrary)
      .catch(() => undefined);
  }, [api, centerId, mapId, readConcepts]);

  useEffect(() => {
    setFormulas(null);
    if (centerId === null) return;
    let current = true;
    api
      .formulas(centerId, formulaWindow)
      .then((list) => {
        if (current) setFormulas(list);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api, centerId, mapId, formulaWindow]);

  /** What a finished job changes on the page. */
  const settle = useCallback(
    (outcome: LabOutcome) => {
      if (outcome.kind === 'concepts') {
        setConceptNote(outcome.note);
        readConcepts();
      } else if (outcome.kind === 'answer') {
        setWhereElse(outcome);
      } else if (outcome.kind === 'formulas') {
        setFormulas(outcome.list);
        setFormulaNotes(outcome);
      } else if (outcome.kind === 'concept-thumbnail') {
        setThumbnails((current) => withThumbnail(current, outcome.thumbnail));
      } else if (outcome.kind === 'hooks-built' || outcome.kind === 'hooks-labelled') {
        setLibrary(outcome.library);
      }
    },
    [readConcepts],
  );

  const { run } = jobs;
  const started = (task: Parameters<LabJobs['run']>[0], start: (id: string) => Promise<string>) => {
    if (centerId === null) return;
    setProblem(null);
    run(task, () => start(centerId), settle);
  };

  return {
    jobs,
    concepts,
    conceptNote,
    whereElse,
    picks,
    choices,
    formulas,
    formulaNotes,
    formulaWindow,
    library,
    thumbnails,
    problem,
    pick: (pick) => setPicks((current) => togglePick(current, pick)),
    choose: (changes) => setChoices((current) => ({ ...current, ...changes })),
    setFormulaWindow,
    generate: () =>
      started({ kind: 'batch' }, (id) => api.startBatch(batchRequest(id, picks, choices, engine))),
    grow: (kind, conceptId) =>
      started({ kind, conceptId }, (id) => api.grow(kind, id, conceptId, engine)),
    // Every AI may be chosen: Antigravity is shown the thumbnails as files.
    writeThumbnail: (conceptId) => {
      started({ kind: 'thumbnail', conceptId }, (id) => api.startThumbnail(id, conceptId, engine));
    },
    keep: (conceptId, kept) => {
      if (centerId === null) return;
      api
        .keep(centerId, conceptId, kept)
        .then(() => {
          setProblem(null);
          setConcepts((current) => current && withKept(current, conceptId, kept));
        })
        .catch((error: unknown) => setProblem(messageOf(error)));
    },
    clear: () => {
      if (centerId === null) return;
      api
        .clear(centerId)
        .then(() => {
          setProblem(null);
          setConceptNote(null);
          readConcepts();
        })
        .catch((error: unknown) => setProblem(messageOf(error)));
    },
    askWhereElse: () => started({ kind: 'where-else' }, (id) => api.startWhereElse(id, engine)),
    findFormulas: () =>
      started({ kind: 'formulas' }, (id) => api.startFormulas(id, formulaWindow, engine)),
    buildHooks: () => started({ kind: 'hooks-build' }, (id) => api.startHookBuild(id)),
    nameHooks: () => started({ kind: 'hooks-label' }, (id) => api.startHookLabels(id, engine)),
  };
}
