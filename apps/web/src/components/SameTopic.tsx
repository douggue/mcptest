import type { CompetitorStatus, SameTopicList } from '@jgtube/core';
import { useState } from 'react';
import { SAME_TOPIC_PAGE_SIZE, describeOtherAlphabet, describeSameTopic } from '../lib/sameTopic';
import { Field } from './layout/Card';
import { Details } from './layout/Details';
import { Notice, ShowMore } from './layout/Notice';
import { SplitView, ViewPage } from './layout/SplitView';
import { StatTile } from './layout/StatTile';
import { ViewHeader } from './layout/ViewHeader';
import { SameTopicCard } from './SameTopicCard';
import type { SameTopicState } from './useSameTopic';

type Choose = (channelId: string, status: CompetitorStatus) => void;

interface ListProps {
  readonly list: SameTopicList;
  readonly busy: boolean;
  readonly onChoose: Choose;
}

/** The channels the owner kept from this list, each with a way back. */
function Kept({ list, busy, onChoose }: ListProps) {
  if (list.kept.length === 0) return null;
  return (
    <Field label="Kept by you">
      <ul className="flex flex-col divide-y divide-border-subtle">
        {list.kept.map((channel) => (
          <li key={channel.id} className="flex min-w-0 items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-body-md text-on-surface">
              {channel.title}
            </span>
            <button
              type="button"
              disabled={busy}
              aria-label={`Stop keeping ${channel.title} as a competitor`}
              onClick={() => onChoose(channel.id, 'auto')}
              className="min-h-9 flex-none rounded-full px-3 text-body-sm font-semibold text-primary transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
            >
              Undo
            </button>
          </li>
        ))}
      </ul>
    </Field>
  );
}

/** The side panel: how many are left to look at, the kept ones, and how the list is made. */
function Side({ list, busy, onChoose, centerTitle }: ListProps & { readonly centerTitle: string }) {
  const leftOut = describeOtherAlphabet(list.otherAlphabet);
  return (
    <>
      <dl className="grid grid-cols-2 gap-2">
        <StatTile label="To look at" value={list.channels.length} note="left out for wording" />
        <StatTile label="Kept" value={list.kept.length} note="as competitors" />
      </dl>
      <Kept list={list} busy={busy} onChoose={onChoose} />
      <Details summary="How this works">
        <p className="text-body-sm text-on-surface-variant">
          {describeSameTopic(list, centerTitle)}
        </p>
        {leftOut && <p className="text-body-sm text-outline">{leftOut}</p>}
      </Details>
    </>
  );
}

/** The undecided channels, in one column, a few at a time. */
function Cards({ list, busy, onChoose }: ListProps) {
  const [shown, setShown] = useState(SAME_TOPIC_PAGE_SIZE);
  const hidden = list.channels.length - shown;
  return (
    <>
      <ol className="flex flex-col gap-space-md">
        {list.channels.slice(0, shown).map((channel, index) => (
          <li key={channel.id}>
            <SameTopicCard
              number={index + 1}
              channel={channel}
              busy={busy}
              onKeep={() => onChoose(channel.id, 'kept')}
            />
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <ShowMore
          left={hidden}
          noun="channels"
          onClick={() => setShown((count) => count + SAME_TOPIC_PAGE_SIZE)}
        />
      )}
    </>
  );
}

interface Props {
  readonly state: SameTopicState;
  readonly centerTitle: string;
  /** Keeps a channel as a competitor or leaves it to the filter again; rejects when not saved. */
  readonly onSetStatus: (channelId: string, status: CompetitorStatus) => Promise<void>;
}

/**
 * Channels that fit the centre on size and pace but were left out for their
 * wording. The owner reads their titles and keeps the ones on the same subject.
 */
export function SameTopic({ state, centerTitle, onSetStatus }: Props) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (state.status === 'idle') return null;
  const list = state.status === 'ready' ? state.list : null;

  const choose: Choose = (channelId, status) => {
    setBusy(true);
    setProblem(null);
    onSetStatus(channelId, status)
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : 'Something went wrong'),
      )
      .finally(() => setBusy(false));
  };

  const main = (
    <>
      <ViewHeader
        titleId="same-topic-title"
        title="Same topic"
        count={list?.channels.length}
        lead={`Channels that pass the size and pace check against ${centerTitle} but title their videos in other words, closest wording first.`}
      />
      {state.status === 'loading' && (
        <Notice tone="working">Going through the channels the filter left out</Notice>
      )}
      {state.status === 'failed' && (
        <Notice tone="problem">The list could not be loaded: {state.message}</Notice>
      )}
      {problem && <Notice tone="problem">Your choice was not saved: {problem}</Notice>}
      {list && list.channels.length === 0 && (
        <Notice>{describeSameTopic(list, centerTitle)}</Notice>
      )}
      {list && list.channels.length > 0 && (
        <Cards key={list.mapId} list={list} busy={busy} onChoose={choose} />
      )}
    </>
  );

  return (
    <ViewPage id="same-topic" labelledBy="same-topic-title">
      {list ? (
        <SplitView
          sideLabel="Channels kept and how this works"
          width="narrow"
          side={<Side list={list} busy={busy} onChoose={choose} centerTitle={centerTitle} />}
        >
          {main}
        </SplitView>
      ) : (
        main
      )}
    </ViewPage>
  );
}
