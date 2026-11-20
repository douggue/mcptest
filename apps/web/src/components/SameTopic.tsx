import type { CompetitorStatus, SameTopicList } from '@jgtube/core';
import { Languages } from 'lucide-react';
import { useState } from 'react';
import { SAME_TOPIC_PAGE_SIZE, describeOtherAlphabet, describeSameTopic } from '../lib/sameTopic';
import { SameTopicCard } from './SameTopicCard';
import type { SameTopicState } from './useSameTopic';

const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';

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
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-label-caps uppercase text-outline">Kept by you</span>
      {list.kept.map((channel) => (
        <span
          key={channel.id}
          className="flex min-w-0 items-center gap-1 rounded-full bg-surface-container-high py-0.5 pl-3 pr-0.5 text-label-caps text-primary-fixed-dim"
        >
          <span className="truncate">{channel.title}</span>
          <button
            type="button"
            disabled={busy}
            aria-label={`Stop keeping ${channel.title} as a competitor`}
            onClick={() => onChoose(channel.id, 'auto')}
            className="flex-none rounded-full px-2 py-1 text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-60"
          >
            Undo
          </button>
        </span>
      ))}
    </div>
  );
}

/** The undecided channels, a few at a time. */
function Cards({ list, busy, onChoose }: ListProps) {
  const [shown, setShown] = useState(SAME_TOPIC_PAGE_SIZE);
  const hidden = list.channels.length - shown;
  return (
    <div className="flex flex-col gap-space-md">
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
        {list.channels.slice(0, shown).map((channel) => (
          <SameTopicCard
            key={channel.id}
            channel={channel}
            busy={busy}
            onKeep={() => onChoose(channel.id, 'kept')}
          />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShown((count) => count + SAME_TOPIC_PAGE_SIZE)}
          className="self-center rounded-full bg-surface-container px-5 py-2.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-card"
        >
          Show more channels ({hidden} left)
        </button>
      )}
    </div>
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
  const leftOut = list ? describeOtherAlphabet(list.otherAlphabet) : null;

  const choose: Choose = (channelId, status) => {
    setBusy(true);
    setProblem(null);
    onSetStatus(channelId, status)
      .catch((error: unknown) =>
        setProblem(error instanceof Error ? error.message : 'Something went wrong'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section
      aria-labelledby="same-topic-title"
      className="w-full bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div className="pb-space-sm">
          <div className="flex items-center gap-2">
            <Languages
              aria-hidden="true"
              className="h-[22px] w-[22px] flex-none text-metric-amber"
            />
            <h2
              id="same-topic-title"
              className="text-headline-lg font-bold tracking-tight text-on-surface"
            >
              Same topic, different wording?
            </h2>
          </div>
          <p className="mt-1 max-w-4xl text-body-md text-on-surface-variant">
            {list
              ? describeSameTopic(list, centerTitle)
              : `Channels that fit ${centerTitle} on size and pace but use different words in their titles.`}
          </p>
        </div>

        {state.status === 'loading' && (
          <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
            Going through the channels the filter left out
          </p>
        )}
        {state.status === 'failed' && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            The list could not be loaded: {state.message}
          </p>
        )}
        {problem && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            Your choice was not saved: {problem}
          </p>
        )}
        {list && <Kept list={list} busy={busy} onChoose={choose} />}
        {list && list.channels.length > 0 && (
          <Cards key={list.mapId} list={list} busy={busy} onChoose={choose} />
        )}
        {leftOut && <p className="text-label-caps text-outline">{leftOut}</p>}
      </div>
    </section>
  );
}
