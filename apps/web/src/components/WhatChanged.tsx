import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SinceKind } from '@jgtube/core';
import { SINCE_OPTIONS, describeFreshness, describeSince } from '../lib/changes';
import { Findings } from './ChangeParts';
import { Card, Label } from './layout/Card';
import { Notice } from './layout/Notice';
import { Segmented } from './layout/Segmented';
import { ViewHeader } from './layout/ViewHeader';
import { QUIET_BUTTON } from './LabStatus';
import type { Changes } from './useChanges';

interface Props {
  readonly changes: Changes;
  readonly centerTitle: string;
  /** More to show beside the findings, such as alerts. */
  readonly children?: ReactNode;
  /** The refresh line, right under the title, as comparing needs fresh readings. */
  readonly toolbar?: ReactNode;
}

/** How old the readings are, in one line; what to do when some are over a day old. */
function Freshness({ text, stale }: { readonly text: string; readonly stale: boolean }) {
  if (!stale) return <p className="text-body-sm text-outline">{text}</p>;
  return (
    <p className="text-body-sm text-metric-amber">
      Some readings are more than a day old. Press Refresh now above to compare the latest.
    </p>
  );
}

/**
 * What changed among the look-alikes of the channel on screen since the owner
 * last looked: worked out from stored readings, with when those were taken.
 * The findings fill the main column; the alerts stand beside them.
 */
export function WhatChanged({ changes, centerTitle, children, toolbar }: Props) {
  const { state, since, setSince, markSeen } = changes;
  if (state.status === 'idle') return null;
  const reply = state.status === 'ready' ? state.reply : null;
  const now = new Date();
  const freshness = reply ? describeFreshness(reply.freshness, now) : null;

  return (
    <>
      <ViewHeader
        titleId="what-changed-title"
        title={`What changed around ${centerTitle}`}
        lead={
          reply
            ? describeSince(reply, now)
            : 'New breakouts and channel moves among the look-alikes on this map.'
        }
        actions={
          <button
            type="button"
            onClick={markSeen}
            disabled={reply === null}
            className={`flex min-h-10 items-center gap-1.5 ${QUIET_BUTTON}`}
          >
            <Check aria-hidden="true" className="h-4 w-4" />
            Mark as seen
          </button>
        }
      />
      {toolbar}
      <div className="flex min-w-0">
        <Segmented<SinceKind>
          label="Compare from"
          options={SINCE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          value={since}
          onChange={setSince}
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-space-lg lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <Label>Changes</Label>
          {state.status === 'loading' && (
            <Notice tone="working">Comparing the stored readings</Notice>
          )}
          {state.status === 'failed' && (
            <Notice tone="problem">What changed could not be loaded: {state.message}</Notice>
          )}
          {state.status === 'ready' && state.problem && (
            <Notice tone="problem">{state.problem}</Notice>
          )}
          {reply && <Findings reply={reply} />}
          {freshness && <Freshness text={freshness.text} stale={freshness.stale} />}
        </Card>
        {children}
      </div>
    </>
  );
}
