import { type BreakdownOutcome, restsOn, studiedLines, type VideoToSupply } from '../lib/breakdown';
import { runLines } from '../lib/breakdownParts';
import type { PartsRun } from '../lib/partFixes';
import { BreakdownParts } from './BreakdownParts';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { NOTE, QUIET_BUTTON } from './LabStatus';
import { SupplyVideos, type SendVideo } from './SupplyVideos';
import type { Breakdown, BreakdownChannel } from './useBreakdown';

const ALERT = 'rounded-lg bg-surface-card p-space-lg text-body-md text-error';

interface StatusProps {
  readonly breakdown: Breakdown;
  readonly busy: boolean;
  readonly onSend: SendVideo;
  /**
   * Runs the breakdown of a channel again; `fresh` studies and writes
   * everything again; `only` writes chosen parts alone, from what is stored.
   */
  readonly onRun: (channel: BreakdownChannel, fresh: boolean, only?: PartsRun) => void;
}

interface SupplyProps extends Pick<StatusProps, 'busy' | 'onSend' | 'onRun'> {
  readonly videos: readonly VideoToSupply[];
  readonly folder: string | null;
  readonly channel: BreakdownChannel;
}

/** The videos to give a file for, and the press that picks the files up. */
function Supply({ videos, folder, channel, busy, onSend, onRun }: SupplyProps) {
  if (videos.length === 0) return null;
  return (
    <Card>
      <SupplyVideos videos={videos} folder={folder} onSend={onSend} />
      <button
        type="button"
        onClick={() => onRun(channel, false)}
        disabled={busy}
        className={`self-start ${QUIET_BUTTON}`}
      >
        Run the breakdown again
      </button>
    </Card>
  );
}

interface ResultProps extends Pick<StatusProps, 'busy' | 'onSend' | 'onRun'> {
  readonly outcome: BreakdownOutcome;
  readonly channel: BreakdownChannel;
}

/** A breakdown that has just finished: its parts, then how the run went and what could be deeper. */
function Result({ outcome, channel, busy, onSend, onRun }: ResultProps) {
  const lines = [restsOn(outcome), ...runLines(outcome.parts), ...studiedLines(outcome)];
  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <BreakdownParts
        view={outcome.breakdown}
        notSaved={outcome.notSaved}
        busy={busy}
        onRun={onRun}
      />
      <Details summary="How this run went">
        <div className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
          {lines.map((line) => (
            <p key={line} className="break-words">
              {line}
            </p>
          ))}
        </div>
      </Details>
      <Supply
        videos={outcome.supply}
        folder={outcome.ownVideosFolder}
        channel={channel}
        {...{ busy, onSend, onRun }}
      />
    </div>
  );
}

/**
 * What a breakdown is doing, or what it found. While one runs: the step in
 * words. Otherwise, for the channel that is picked: the breakdown that has
 * just finished, or the one kept from before, with the control to run it again.
 */
export function BreakdownStatus({ breakdown, busy, onSend, onRun }: StatusProps) {
  const { state, picked, stored } = breakdown;
  if (state.status === 'running') {
    return (
      <div className="flex flex-col gap-space-sm">
        <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
          <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
          <span className="min-w-0 break-words">
            Breaking down {state.channel.title}. {state.progress?.text ?? 'Starting'}.
          </span>
        </p>
        <SupplyVideos videos={state.progress?.supply ?? []} folder={null} onSend={onSend} />
      </div>
    );
  }
  const ofPicked = state.status !== 'idle' && state.channel.id === picked?.id;
  if (state.status === 'done' && ofPicked) {
    return <Result outcome={state.outcome} channel={state.channel} {...{ busy, onSend, onRun }} />;
  }
  const kept =
    stored.status === 'ready' ? (
      <BreakdownParts view={stored.view} notSaved={null} busy={busy} onRun={onRun} />
    ) : null;
  if (state.status === 'failed' && ofPicked) {
    return (
      <div className="flex min-w-0 flex-col gap-space-lg">
        <p role="alert" className={ALERT}>
          The breakdown of {state.channel.title} did not finish: {state.message}
        </p>
        <Supply
          videos={state.supply}
          folder={null}
          channel={state.channel}
          {...{ busy, onSend, onRun }}
        />
        {kept}
      </div>
    );
  }
  if (stored.status === 'failed') {
    return (
      <p role="alert" className={ALERT}>
        The stored breakdown could not be read: {stored.message}
      </p>
    );
  }
  if (stored.status === 'loading') {
    return (
      <p role="status" className={NOTE}>
        Reading the breakdown kept for {picked?.title ?? 'this channel'}.
      </p>
    );
  }
  return kept ?? <NoBreakdown title={picked?.title ?? null} />;
}

/** Said when the channel picked has no breakdown kept yet. */
function NoBreakdown({ title }: { readonly title: string | null }) {
  return (
    <Card>
      <p className="text-body-md text-on-surface">
        No breakdown of {title ?? 'this channel'} is kept yet.
      </p>
      <p className="text-body-sm text-on-surface-variant">
        Press Break it down. It runs for half an hour or more, even if you leave this page; the
        parts appear here as cards when it is done.
      </p>
    </Card>
  );
}
