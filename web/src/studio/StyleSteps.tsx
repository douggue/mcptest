import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../ui';
import type { EditSpec } from './logic';
import type { StyleProfile, StyleStep } from './types';
import type { Ctx } from './Editor';

/* Each built-in style has its own steps (server/studio/presets.py "workflow"). This shows them as a checklist above
   every tool panel: steps the program can see are ticked by themselves, the rest are ticked by hand, and a step's
   name opens the tool where it is done. */

let cache: Promise<StyleProfile[]> | null = null;
export function useStyleProfile(id: string): StyleProfile | undefined {
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  useEffect(() => {
    if (!id) return;
    cache ??= api.get<StyleProfile[]>('/api/profiles').catch(() => { cache = null; return []; });
    cache.then(setStyles);
  }, [id]);
  return styles.find((s) => s.id === id);
}

const TOOL_NAMES: Record<string, string> = { frame: 'Framing', style: 'Style', words: 'Words', motion: 'Motion', post: 'Export' };

/** true / false when the program can tell from the clip; null when the person ticks it. */
export function stepDone(step: StyleStep, spec: EditSpec, seconds: number): boolean | null {
  const c = step.check;
  const title = spec.graphics.find((g) => g.origin === 'style' && g.type === 'label' && g.duration > (spec.out - spec.in) * 0.6);
  if (c === 'music') return !!spec.audio.music?.src;
  if (c === 'no-music') return !spec.audio.music?.src;
  if (c === 'voiceover') return !!spec.audio.voiceover?.src;
  if (c === 'planned') return spec.graphics.some((g) => g.origin === 'ai') || (spec.freezes?.length ?? 0) > 0;
  if (c === 'title') return title ? !!title.primary.trim() && !/YOUR \{TITLE\}/.test(title.primary) : !!spec.hook.text.trim();
  if (c === 'header') return !!spec.header?.name && spec.header.name !== 'Your channel';
  const m = /^length:(\d+)-(\d+)$/.exec(c);
  if (m) return seconds >= +m[1] && seconds <= +m[2];
  return null;
}

const KEY = (clip: string) => `cutroom.steps.${clip}`;
function readTicks(clip: string): number[] {
  try { return JSON.parse(localStorage.getItem(KEY(clip)) || '[]'); } catch { return []; }
}

export function StyleSteps({ ctx, tab, openTool }: { ctx: Ctx; tab: string; openTool: (id: string) => void }) {
  const style = useStyleProfile(ctx.profileId);
  const [ticks, setTicks] = useState<number[]>(() => readTicks(ctx.clip.id));
  useEffect(() => setTicks(readTicks(ctx.clip.id)), [ctx.clip.id]);
  const steps = style?.workflow ?? [];
  if (!steps.length) return null;

  const done = steps.map((s, i) => stepDone(s, ctx.spec, ctx.seconds) ?? ticks.includes(i));
  const required = steps.map((s) => s.check !== 'optional');
  const left = done.filter((d, i) => !d && required[i]).length;
  const next = done.findIndex((d, i) => !d && required[i]);
  const toggle = (i: number) => {
    const n = ticks.includes(i) ? ticks.filter((x) => x !== i) : [...ticks, i];
    setTicks(n);
    try { localStorage.setItem(KEY(ctx.clip.id), JSON.stringify(n)); } catch { /* private window */ }
  };

  return (
    <details className="style-steps" open={left > 0}>
      <summary>
        <b>{style!.name} steps</b>
        <span className="small muted">{left ? `${steps.length - left - required.filter((r) => !r).length} of ${required.filter(Boolean).length} done` : 'All done'}</span>
      </summary>
      <ol>
        {steps.map((s, i) => {
          const auto = stepDone(s, ctx.spec, ctx.seconds) !== null;
          return (
            <li key={i} className={`${done[i] ? 'done' : ''} ${i === next ? 'next' : ''}`}>
              <button className="tick" disabled={auto} onClick={() => toggle(i)}
                title={auto ? 'Ticked by itself when the clip has it' : done[i] ? 'Mark as not done' : 'Mark as done'}
                aria-label={done[i] ? 'Done' : 'Not done'}>
                {done[i] ? <Icon name="check" size={13} /> : null}
              </button>
              <span className="grow">{s.text}</span>
              {s.tool && s.tool !== tab && (
                <button className="link small" onClick={() => openTool(s.tool)}>{TOOL_NAMES[s.tool]}</button>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
