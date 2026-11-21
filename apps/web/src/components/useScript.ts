import type { ScriptFields } from '@jgtube/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import type { LabApi } from '../lib/labApi';
import type { ScriptStage, ScriptView } from '../lib/scriptWriter';
import type { LabJobs } from './useLabJob';

export type SaveState = 'saved' | 'saving' | 'failed';

export interface Script {
  /** The script that is open; null when none is. */
  readonly view: ScriptView | null;
  readonly saving: SaveState;
  /** Why the last save or the last opening did not work. */
  readonly problem: string | null;
  /** Opens a concept's script, starting it when there is none. */
  readonly open: (conceptId: number) => void;
  readonly close: () => void;
  /** Changes the script on screen at once and stores the change a moment later. */
  readonly change: (changes: Partial<ScriptFields>) => void;
  readonly runStage: (stage: ScriptStage) => void;
  /** Reads from YouTube the captions of the voice channel's best videos, then measures it again. */
  readonly readVoice: () => void;
}

/** How long typing must pause before a change is stored. */
const SAVE_AFTER_MS = 600;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'It could not be stored';

/**
 * The script writer for the channel on screen: one concept's script at a
 * time. What the owner types is shown at once and stored after a short
 * pause; a stage waits for that save, so an engine always reads what is on
 * screen.
 */
export function useScript(
  api: LabApi,
  jobs: LabJobs,
  centerId: string | null,
  engine: EngineChoice,
): Script {
  const [view, setView] = useState<ScriptView | null>(null);
  const [saving, setSaving] = useState<SaveState>('saved');
  const [problem, setProblem] = useState<string | null>(null);
  // What has been typed and not stored yet, and the timer that will store it.
  const pending = useRef<Partial<ScriptFields>>({});
  const timer = useRef<number | null>(null);
  const conceptId = view?.concept.id ?? null;

  // Another channel on screen: its scripts are its own.
  useEffect(() => {
    setView(null);
    setProblem(null);
    pending.current = {};
  }, [centerId]);

  /** Stores what is pending now; resolves when the server has it. */
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const changes = pending.current;
    if (centerId === null || conceptId === null || Object.keys(changes).length === 0) return;
    pending.current = {};
    setSaving('saving');
    try {
      const saved = await api.saveScript(centerId, conceptId, changes);
      // Text typed since the save was sent stays on screen; everything else is as the server has it.
      setView((current) =>
        current?.script && saved.script
          ? { ...saved, script: { ...saved.script, ...pending.current } }
          : saved,
      );
      setSaving('saved');
      setProblem(null);
    } catch (error) {
      setSaving('failed');
      setProblem(messageOf(error));
    }
  }, [api, centerId, conceptId]);

  const change = useCallback(
    (changes: Partial<ScriptFields>) => {
      pending.current = { ...pending.current, ...changes };
      setView((current) =>
        current?.script ? { ...current, script: { ...current.script, ...changes } } : current,
      );
      setSaving('saving');
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_AFTER_MS);
    },
    [flush],
  );

  const open = useCallback(
    (concept: number) => {
      if (centerId === null) return;
      api
        .openScript(centerId, concept)
        .then((opened) => {
          pending.current = {};
          setView(opened);
          setProblem(null);
        })
        .catch((error: unknown) => setProblem(messageOf(error)));
    },
    [api, centerId],
  );

  const { run } = jobs;
  const runStage = (stage: ScriptStage): void => {
    if (centerId === null || conceptId === null) return;
    run(
      { kind: `script-${stage}` },
      async () => {
        await flush();
        return api.startStage(centerId, conceptId, stage, engine);
      },
      (outcome) => {
        if (outcome.kind === 'script') setView(outcome.view);
      },
    );
  };

  const readVoice = (): void => {
    const voiceId = view?.script?.voiceChannelId;
    if (centerId === null || conceptId === null || !voiceId) return;
    run(
      { kind: 'voice-read' },
      () => api.startVoiceRead(centerId, voiceId),
      // Choosing the voice again brings its freshly measured rate and grade into the script.
      () => change({ voiceChannelId: voiceId }),
    );
  };

  return { view, saving, problem, open, close: () => setView(null), change, runStage, readVoice };
}
