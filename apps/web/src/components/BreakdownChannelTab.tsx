import { Microscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { breakdownHref } from '../lib/routes';
import type { Candidate } from '../lib/breakdownPicks';
import { brokenDownText } from '../lib/breakdownPicks';
import { SLOW_NOTE } from '../lib/breakdown';
import { uploadVideoFile } from '../lib/upload';
import { BreakdownStatus } from './Breakdown';
import { AllCandidates, PasteChannel, SuggestedCandidates } from './BreakdownChooser';
import { CandidateLogo, CandidateMeta, NO_BADGE, TopStrip } from './CandidateRow';
import { Details } from './layout/Details';
import { Notice } from './layout/Notice';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { PRIMARY_BUTTON } from './LabStatus';
import { useCandidates } from './useCandidates';
import type { ViewParts } from './viewParts';

/** The kept breakdowns among the channels on offer, newest first. */
function KeptBreakdowns({ candidates }: { readonly candidates: readonly Candidate[] }) {
  const kept = candidates
    .filter((candidate) => candidate.brokenDownAt !== null)
    .sort((a, b) => (b.brokenDownAt ?? '').localeCompare(a.brokenDownAt ?? ''));
  if (kept.length === 0) return null;
  return (
    <section aria-labelledby="breakdown-kept" className="flex min-w-0 flex-col gap-space-sm">
      <h3 id="breakdown-kept" className="text-headline-md font-bold text-on-surface">
        Your breakdowns
      </h3>
      <ul className="flex min-w-0 flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-card px-space-md">
        {kept.map((candidate) => (
          <li key={candidate.id} className="flex min-w-0 items-center gap-space-sm py-2">
            <CandidateLogo facts={candidate} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-md text-on-surface">{candidate.title}</span>
              <span className="text-body-sm text-outline">
                {brokenDownText(candidate.brokenDownAt)}
              </span>
            </span>
            <a
              href={breakdownHref(candidate.id)}
              className="flex min-h-11 flex-none items-center rounded-full px-3 text-body-sm font-semibold text-primary hover:bg-surface-container-high"
            >
              Open
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One channel opened in Breakdown: who it is, the one button, and its kept breakdown. */
function OneChannel({
  candidate,
  parts,
}: {
  readonly candidate: Candidate;
  readonly parts: ViewParts;
}) {
  const { breakdown, analysis, asking } = parts.work;
  const [fresh, setFresh] = useState(false);
  const pick = breakdown.pick;
  useEffect(
    () => pick({ id: candidate.id, title: candidate.title }),
    [pick, candidate.id, candidate.title],
  );
  const running = breakdown.state.status === 'running';
  const start = (again: boolean): void =>
    breakdown.start({ id: candidate.id, title: candidate.title }, analysis.choice, again);
  return (
    <>
      <ViewHeader
        titleId="breakdown-title"
        title={candidate.title}
        lead={<CandidateMeta candidate={candidate} />}
        back={{ href: breakdownHref(), label: 'Back to all channels', history: true }}
        media={<CandidateLogo facts={candidate} size="lg" />}
        actions={
          <button
            type="button"
            disabled={asking}
            onClick={() => start(fresh)}
            className={`min-h-11 ${PRIMARY_BUTTON}`}
          >
            {running ? 'Working…' : 'Break it down'}
          </button>
        }
      />
      {asking && !running && (
        <Notice>Another AI run is under way. Break it down when it is done.</Notice>
      )}
      <TopStrip facts={candidate} />
      <Details summary="How this works">
        <div className="flex flex-col gap-2 text-body-sm text-on-surface-variant">
          <p>
            {SLOW_NOTE.replace(
              ' Keep this page open.',
              ' You can leave this page; it keeps running.',
            )}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={fresh}
              onChange={(event) => setFresh(event.target.checked)}
              className="h-4 w-4 accent-primary-container"
            />
            Start again from nothing (watch and study the videos again)
          </label>
        </div>
      </Details>
      <BreakdownStatus
        breakdown={breakdown}
        busy={asking}
        onSend={uploadVideoFile}
        onRun={(_c, again) => start(again)}
      />
    </>
  );
}

/**
 * Breakdown's Channel tab. With no channel open: paste a channel, the ones
 * suggested first, your breakdowns, and every channel on offer with a
 * search. With one open (`#/breakdown/<id>`): that channel and its breakdown.
 */
export function BreakdownChannelTab({
  parts,
  channelId,
}: {
  readonly parts: ViewParts;
  readonly channelId: string | null;
}) {
  const { work, page } = parts;
  const { state, paste, readChannel } = useCandidates(
    work.breakdownChannels,
    page.snapshot,
    channelId,
  );
  const [now] = useState(() => new Date());
  const open =
    state.status === 'ready' && channelId
      ? state.candidates.find((c) => c.id === channelId)
      : undefined;
  return (
    <ViewPage id="breakdown" labelledBy="breakdown-title">
      {open ? (
        <OneChannel key={open.id} candidate={open} parts={parts} />
      ) : (
        <>
          <ViewHeader
            titleId="breakdown-title"
            icon={Microscope}
            title="Break down a channel"
            lead="See how a channel makes its videos, from titles to a master prompt."
          />
          <PasteChannel paste={paste} onRead={readChannel} />
          {channelId && state.status === 'ready' && (
            <Notice tone="problem">
              That channel is not stored yet. Paste its link above to read it.
            </Notice>
          )}
          {state.status === 'loading' && (
            <Notice tone="working">Reading the channels you can break down.</Notice>
          )}
          {state.status === 'failed' && <Notice tone="problem">{state.message}</Notice>}
          {state.status === 'ready' && (
            <>
              <SuggestedCandidates candidates={state.candidates} now={now} badge={NO_BADGE} />
              <KeptBreakdowns candidates={state.candidates} />
              <AllCandidates candidates={state.candidates} badge={NO_BADGE} />
            </>
          )}
        </>
      )}
    </ViewPage>
  );
}
