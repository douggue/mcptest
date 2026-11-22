import type { PlanView } from '@jgtube/core';
import { Target } from 'lucide-react';
import { useState } from 'react';
import { planCounts } from '../lib/plan';
import { Card, Field } from './layout/Card';
import { Details } from './layout/Details';
import { PanelButton } from './layout/PanelButton';
import { SplitView, ViewPage } from './layout/SplitView';
import { StatRow } from './layout/StatRow';
import { StatTile } from './layout/StatTile';
import { ViewHeader } from './layout/ViewHeader';
import { FIELD, NOTE } from './LabStatus';
import { OwnUploads } from './OwnUploads';
import { LinkedCard, PlanTable } from './OwnVideoParts';
import { usePlan, type Plan } from './usePlan';

const ALERT = 'rounded-lg bg-surface-card p-space-md text-body-md text-error';

/** The side panel: which kept concept became which published video, and the one button. */
interface FormProps {
  readonly plan: PlanView;
  readonly actions: Plan;
  /** The published video's link, shared with the uploads list's Link buttons. */
  readonly link: string;
  readonly setLink: (link: string) => void;
}

function LinkForm({ plan, actions, link, setLink }: FormProps) {
  const [conceptId, setConceptId] = useState<number | null>(null);
  const chosen = conceptId ?? plan.linkable[0]?.conceptId ?? null;
  if (plan.linkable.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        Every kept idea is linked, or none is kept yet. Keep an idea in Ideas to link it to the
        video it became.
      </p>
    );
  }
  return (
    <form
      className="flex min-w-0 flex-col gap-space-lg"
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen !== null && link.trim() !== '') actions.link(chosen, link.trim());
      }}
    >
      <Field label={<label htmlFor="plan-concept">Kept idea</label>}>
        <select
          id="plan-concept"
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
      </Field>
      <Field label={<label htmlFor="plan-video">Your published video (link or id)</label>}>
        <input
          id="plan-video"
          type="text"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className={FIELD}
        />
      </Field>
      <PanelButton
        submit
        disabled={actions.linking}
        blocked={link.trim() === '' ? 'Paste the link of your published video first.' : null}
      >
        {actions.linking ? 'Checking' : 'Link'}
      </PanelButton>
    </form>
  );
}

function Panel({ plan, ...form }: Omit<FormProps, 'plan'> & { readonly plan: PlanView | null }) {
  const { actions } = form;
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="own-videos-title" className="flex items-center gap-2 text-headline-md font-bold">
          <span className="text-on-surface">Link a video</span>
        </h2>
        <p className="text-body-sm text-on-surface-variant">
          Link a kept idea to the video you published from it.
        </p>
      </div>
      <Details summary="How this works">
        <p className="text-body-sm text-on-surface-variant">
          Its numbers come from what Jgtube has stored for this channel, read again by each refresh:
          no forecast and no advice. A video not stored yet is looked for by reading this channel
          once.
        </p>
      </Details>
      {plan && <LinkForm plan={plan} {...form} />}
      {actions.problem && (
        <p role="alert" className={ALERT}>
          {actions.problem}
        </p>
      )}
    </>
  );
}

/** The plan's counts, each with what it rests on. */
function Counts({ plan }: { readonly plan: PlanView }) {
  const counts = planCounts(plan);
  return (
    <StatRow columns={3}>
      <StatTile label="Linked videos" value={counts.linked} note="Kept ideas you published" />
      <StatTile label="Scored" value={counts.scored} note="Against your usual at the same age" />
      <StatTile label="Not linked yet" value={counts.notLinked} note="Kept ideas" />
    </StatRow>
  );
}

/** The linked videos in one column, then what they used and how they did. */
function Linked({ plan, actions }: { readonly plan: PlanView; readonly actions: Plan }) {
  if (plan.linked.length === 0) {
    return (
      <Card>
        <Target aria-hidden="true" className="h-6 w-6 text-metric-amber" />
        <p className="text-body-md text-on-surface">No video is linked yet.</p>
        <p className="text-body-sm text-on-surface-variant">
          When you publish a kept idea, link it under Link a video to see how it did against your
          usual.
        </p>
      </Card>
    );
  }
  return (
    <>
      <ol className="flex min-w-0 flex-col gap-space-md">
        {plan.linked.map((video) => (
          <LinkedCard
            key={video.conceptId}
            video={video}
            busy={actions.linking}
            onUnlink={() => actions.unlink(video.conceptId)}
          />
        ))}
      </ol>
      <PlanTable rows={plan.table} videos={plan.linked.length} />
    </>
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
  const [link, setLink] = useState('');
  const { state } = actions;
  if (state.status === 'idle') return null;
  const plan = state.status === 'ready' ? state.plan : null;
  return (
    <ViewPage id="own-videos" labelledBy="own-videos-title">
      <ViewHeader
        title="Your videos"
        lead="Each video against your channel's usual at the same age."
        count={plan && plan.linked.length > 0 ? plan.linked.length : undefined}
      />
      <SplitView
        sideLabel="Link a published video"
        mainFirst
        side={<Panel plan={plan} actions={actions} link={link} setLink={setLink} />}
      >
        {state.status === 'loading' && <p className={NOTE}>Reading the plan</p>}
        {state.status === 'failed' && (
          <p role="alert" className={ALERT}>
            It could not be loaded: {state.message}
          </p>
        )}
        {/* Before anything is linked, the uploads come first and no tiles of zeros are shown. */}
        {plan && plan.linked.length > 0 && <Counts plan={plan} />}
        {plan && plan.linked.length > 0 && <Linked plan={plan} actions={actions} />}
        {plan && plan.linked.length === 0 && channelId && (
          <OwnUploads
            channelId={channelId}
            reloadKey={String(reloadKey)}
            canLink={plan.linkable.length > 0}
            onLink={(videoId) => {
              setLink(`https://www.youtube.com/watch?v=${videoId}`);
              document.getElementById('plan-video')?.focus();
            }}
          />
        )}
      </SplitView>
    </ViewPage>
  );
}
