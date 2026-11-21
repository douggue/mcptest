import { Ruler } from 'lucide-react';
import { shortsNote, winnersRule } from '../lib/pacing';
import { NOTE } from './LabStatus';
import { PacingChart } from './PacingChart';
import { usePacing } from './usePacing';

interface Props {
  readonly channelId: string | null;
  readonly reloadKey: unknown;
}

/** The channel's own lengths and speaking pace beside the breakouts of the look-alikes on its map. */
export function LengthPacing({ channelId, reloadKey }: Props) {
  const state = usePacing(channelId, reloadKey);
  if (state.status === 'idle') return null;
  const pacing = state.status === 'ready' ? state.pacing : null;
  const shorts = pacing ? shortsNote(pacing.shortsLeftOut) : null;
  return (
    <section
      id="length-pacing"
      aria-labelledby="length-pacing-title"
      className="w-full scroll-mt-16 bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div>
          <div className="flex items-center gap-2">
            <Ruler aria-hidden="true" className="h-[22px] w-[22px] flex-none text-metric-amber" />
            <h2
              id="length-pacing-title"
              className="text-headline-lg font-bold tracking-tight text-on-surface"
            >
              Length and pacing against the winners
            </h2>
          </div>
          <p className="mt-1 max-w-4xl text-body-md text-on-surface-variant">
            How long your videos run, and how fast they are spoken, beside the videos that broke out
            among the channels like yours on this map. From what Jgtube has stored; a comparison
            only, with how many videos each figure rests on.
          </p>
        </div>
        {state.status === 'loading' && <p className={NOTE}>Measuring the stored videos</p>}
        {state.status === 'failed' && (
          <p role="alert" className="text-body-md text-error">
            It could not be loaded: {state.message}
          </p>
        )}
        {pacing && (
          <>
            <div className="grid grid-cols-1 gap-space-md lg:grid-cols-2">
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
            <div className="flex max-w-4xl flex-col gap-1 text-body-sm text-outline">
              <p>{winnersRule(pacing.rule, pacing.lookalikes)}</p>
              {shorts && <p>{shorts}</p>}
              <p>
                Words a minute come only from videos whose captions are stored (Download
                transcripts, the hook library or the script writer store them), counted from the
                first caption line to the last.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
