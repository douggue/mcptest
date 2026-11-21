import type { PlanView } from '@jgtube/core';
import { Target } from 'lucide-react';
import { useState } from 'react';
import { FIELD, NOTE, PRIMARY_BUTTON } from './LabStatus';
import { LinkedCard, PlanTable } from './OwnVideoParts';
import { usePlan, type Plan } from './usePlan';

const LABEL = 'text-label-caps uppercase text-outline';

function LinkForm({ plan, actions }: { readonly plan: PlanView; readonly actions: Plan }) {
  const [conceptId, setConceptId] = useState<number | null>(null);
  const [link, setLink] = useState('');
  const chosen = conceptId ?? plan.linkable[0]?.conceptId ?? null;
  if (plan.linkable.length === 0) {
    return (
      <p className={NOTE}>
        Every kept concept is linked, or none is kept yet. Keep a concept in the idea lab to link it
        to the video it became.
      </p>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-space-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen !== null && link.trim() !== '') actions.link(chosen, link.trim());
      }}
    >
      <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className={LABEL}>Kept concept</span>
        <select
          value={chosen ?? ''}
          onChange={(event) => setConceptId(Number(event.target.value))}
          className={FIELD}
        >
          {plan.linkable.map((entry) => (
            <option key={entry.conceptId} value={entry.conceptId}>
              {entry.title}
              {entry.hasScript ? ' (script)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className={LABEL}>Your published video (link or id)</span>
        <input
          type="text"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className={FIELD}
        />
      </label>
      <button
        type="submit"
        disabled={actions.linking || link.trim() === ''}
        className={PRIMARY_BUTTON}
      >
        {actions.linking ? 'Checking' : 'Link'}
      </button>
    </form>
  );
}

interface Props {
  readonly channelId: string | null;
  /** Changes whenever a refresh ends, which brings new view counts. */
  readonly reloadKey: unknown;
}

/** The owner's own published videos against the concepts they came from. */
export function OwnVideos({ channelId, reloadKey }: Props) {
  const actions = usePlan(channelId, reloadKey);
  const { state } = actions;
  if (state.status === 'idle') return null;
  const plan = state.status === 'ready' ? state.plan : null;
  return (
    <section
      id="own-videos"
      aria-labelledby="own-videos-title"
      className="w-full scroll-mt-16 bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div>
          <div className="flex items-center gap-2">
            <Target aria-hidden="true" className="h-[22px] w-[22px] flex-none text-metric-amber" />
            <h2
              id="own-videos-title"
              className="text-headline-lg font-bold tracking-tight text-on-surface"
            >
              Your videos against the plan
            </h2>
          </div>
          <p className="mt-1 max-w-4xl text-body-md text-on-surface-variant">
            Link a kept concept to the video you published from it. Its numbers come from what
            Jgtube has stored for this channel, read again by each refresh: no forecast and no
            advice. A video not stored yet is looked for by reading this channel once.
          </p>
        </div>
        {state.status === 'loading' && <p className={NOTE}>Reading the plan</p>}
        {state.status === 'failed' && (
          <p role="alert" className="text-body-md text-error">
            It could not be loaded: {state.message}
          </p>
        )}
        {plan && <LinkForm plan={plan} actions={actions} />}
        {actions.problem && (
          <p role="alert" className="text-body-md text-error">
            {actions.problem}
          </p>
        )}
        {plan && plan.linked.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
              {plan.linked.map((video) => (
                <LinkedCard
                  key={video.conceptId}
                  video={video}
                  busy={actions.linking}
                  onUnlink={() => actions.unlink(video.conceptId)}
                />
              ))}
            </div>
            <PlanTable rows={plan.table} videos={plan.linked.length} />
          </>
        )}
      </div>
    </section>
  );
}
