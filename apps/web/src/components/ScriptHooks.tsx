import { liftedFrom } from '@jgtube/core/src/hooks/lift';
import { formatScore } from '../lib/format';
import type { LibraryHook } from '../lib/hookLibrary';
import { MAX_MODELS, toggleModel, type ScriptView } from '../lib/scriptWriter';
import { PILL, QUIET_BUTTON } from './LabStatus';
import type { Script } from './useScript';

const LABEL = 'text-label text-outline';
const AREA =
  'w-full min-w-0 rounded bg-space-deep p-space-sm text-body-sm text-on-surface shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container';

export interface ScriptPartProps {
  readonly script: Script;
  readonly view: ScriptView;
  readonly busy: boolean;
}

/** The library hooks the owner can take as models, up to three. */
export function Models({
  script,
  view,
  hooks,
}: ScriptPartProps & { readonly hooks: readonly LibraryHook[] }) {
  const chosen = view.script?.hookModels ?? [];
  const usable = hooks.filter((hook) => hook.text !== null);
  if (usable.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        The hook library has not been built for this channel, so the hooks cannot learn from how its
        breakout videos open. Build it under Hook library; the script writer works without it.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>
        Openings to model · {chosen.length} of {MAX_MODELS}. With none chosen, the AI picks three
        from the library itself.
      </span>
      <div className="flex flex-wrap gap-1.5">
        {usable.map((hook) => (
          <button
            key={hook.videoId}
            type="button"
            aria-pressed={chosen.includes(hook.videoId)}
            title={hook.title}
            onClick={() => script.change({ hookModels: toggleModel(chosen, hook.videoId) })}
            className={`max-w-full truncate rounded-full px-3 py-1 text-body-sm transition-colors ${
              chosen.includes(hook.videoId)
                ? 'bg-primary-container font-semibold text-on-primary'
                : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {hook.style ?? 'unnamed'} · {formatScore(hook.score)} · {hook.title}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Step 1: three hooks side by side, the one the owner takes, and the beat sheet. */
export function HooksAndBeats({
  script,
  view,
  hooks,
}: ScriptPartProps & { readonly hooks: readonly LibraryHook[] }) {
  const stored = view.script;
  if (!stored || stored.hooks.length === 0) return null;
  return (
    <div className="flex flex-col gap-space-md">
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-3">
        {stored.hooks.map((hook, index) => {
          const model = hooks.find((entry) => entry.videoId === hook.model);
          const lift = liftedFrom(hook.text, hooks);
          return (
            <div
              key={`${index}-${hook.way}`}
              className="flex min-w-0 flex-col gap-2 rounded bg-space-deep p-space-md"
            >
              <span className={`${PILL} self-start text-primary-fixed-dim`}>{hook.way}</span>
              <p className="whitespace-pre-line break-words text-body-sm text-on-surface">
                {hook.text}
              </p>
              {model && (
                <p className="text-body-sm text-outline">
                  Learns from{' '}
                  <a href={`#hook-${model.videoId}`} className="text-primary hover:underline">
                    {model.title}
                  </a>
                  : its way of opening, never its words.
                </p>
              )}
              {lift && (
                <p role="note" className="break-words text-body-sm text-metric-amber">
                  Shares {lift.words} words in a row with a hook in the library: &ldquo;
                  {lift.phrase}
                  &rdquo;. Reword it.
                </p>
              )}
              <button
                type="button"
                aria-pressed={stored.chosenHook === hook.text}
                onClick={() => script.change({ chosenHook: hook.text })}
                className={`self-start ${QUIET_BUTTON}`}
              >
                {stored.chosenHook === hook.text ? 'This is the hook' : 'Use this hook'}
              </button>
            </div>
          );
        })}
      </div>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>The hook you chose (you can edit it)</span>
        <textarea
          value={stored.chosenHook}
          onChange={(event) => script.change({ chosenHook: event.target.value })}
          rows={6}
          className={AREA}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={LABEL}>
          Beat sheet (you can edit it): one beat to a line, as time | name | what happens
        </span>
        <textarea
          value={stored.beats}
          onChange={(event) => script.change({ beats: event.target.value })}
          rows={10}
          className={AREA}
        />
      </label>
    </div>
  );
}
