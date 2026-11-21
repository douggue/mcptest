import type { PacingView } from '@jgtube/core';
import { Ruler } from 'lucide-react';
import { pacingTiles, shortsNote, winnersRule } from '../lib/pacing';
import { Details } from './layout/Details';
import { ViewPage } from './layout/SplitView';
import { TileRow } from './layout/StatRow';
import { ViewHeader } from './layout/ViewHeader';
import { NOTE } from './LabStatus';
import { PacingChart } from './PacingChart';
import { usePacing } from './usePacing';

interface Props {
  readonly channelId: string | null;
  readonly reloadKey: unknown;
}

/** What the figures rest on: who counts as a winner, the Shorts left out, where the pace comes from. */
function HowMeasured({ pacing }: { readonly pacing: PacingView }) {
  const shorts = shortsNote(pacing.shortsLeftOut);
  return (
    <Details summary="How this is measured">
      <div className="flex max-w-3xl flex-col gap-1 text-body-sm text-on-surface-variant">
        <p>{winnersRule(pacing.rule, pacing.lookalikes)}</p>
        {shorts && <p>{shorts}</p>}
        <p>
          Words a minute come only from videos whose captions Jgtube has stored, for example with
          Download transcripts, counted from the first caption line to the last.
        </p>
      </div>
    </Details>
  );
}

function Figures({ pacing }: { readonly pacing: PacingView }) {
  return (
    <>
      <TileRow tiles={pacingTiles(pacing)} />
      <div className="grid min-w-0 grid-cols-1 gap-space-md lg:grid-cols-2">
        <PacingChart
          title="Length"
          measure="length"
          rows={[
            { label: 'Yours', spread: pacing.lengths.own },
            { label: 'Winners', spread: pacing.lengths.winners },
          ]}
        />
        <PacingChart
          title="Words a minute"
          measure="pace"
          rows={[
            { label: 'Yours', spread: pacing.wordsPerMinute.own },
            { label: 'Winners', spread: pacing.wordsPerMinute.winners },
          ]}
        />
      </div>
      <HowMeasured pacing={pacing} />
    </>
  );
}

/** The channel's own lengths and speaking pace beside the breakouts of the look-alikes on its map. */
export function LengthPacing({ channelId, reloadKey }: Props) {
  const state = usePacing(channelId, reloadKey);
  if (state.status === 'idle') return null;
  return (
    <ViewPage id="length-pacing" labelledBy="length-pacing-title">
      <ViewHeader
        titleId="length-pacing-title"
        title="Length and pacing against the winners"
        icon={Ruler}
        lead="Your videos beside the breakouts of channels like yours on this map. A comparison only."
      />
      {state.status === 'loading' && <p className={NOTE}>Measuring the stored videos</p>}
      {state.status === 'failed' && (
        <p role="alert" className="rounded-lg bg-surface-card p-space-md text-body-md text-error">
          It could not be loaded: {state.message}
        </p>
      )}
      {state.status === 'ready' && <Figures pacing={state.pacing} />}
    </ViewPage>
  );
}
