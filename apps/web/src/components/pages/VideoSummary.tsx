import type { BankVideo } from '@jgtube/core';
import { ArrowRight, Sparkles } from 'lucide-react';
import { videoHref } from '../../lib/routes';
import {
  TEARDOWN_PARTS,
  measuredFacts,
  paletteOf,
  scoreBasis,
  storedFacts,
  timelineOf,
  type Fact,
  type Timeline,
} from '../../lib/videoPage';
import type { VideoBreakdownView } from '../../lib/videoBreakdown';
import { TeardownAdds } from '../teardown/TeardownBits';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Row } from '../ui/Row';
import { Stat, Stats } from '../ui/Stat';
import { TeardownDownloads } from '../VideoTeardown';

/** The colours of the timeline's parts, in turn; cyan first, never amber. */
const PART_COLOURS = ['#00D2FF', '#38BDF8', '#4C6EF5', '#A78BFA', '#34D399', '#7DD3FC'] as const;

function Facts({ facts }: { readonly facts: readonly Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <Stats columns={facts.length >= 4 ? 4 : 3}>
      {facts.map((fact) => (
        <Stat
          key={fact.label}
          label={fact.label}
          value={fact.value}
          note={fact.note}
          score={fact.score}
        />
      ))}
    </Stats>
  );
}

/** How the video is built: its chapters as one bar, each as wide as its share of the runtime. */
function Built({ timeline }: { readonly timeline: Timeline }) {
  return (
    <Card title="How it is built" aside={<span className="text-dim">{timeline.end}</span>}>
      <div className="flex h-11 gap-0.5 overflow-hidden rounded-md" aria-hidden="true">
        {timeline.parts.map((part, index) => (
          <span
            key={`${part.at}${part.title}`}
            title={`${part.at} · ${part.title}`}
            className="flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap px-1 text-[13px] font-semibold text-on-signal"
            style={{
              flex: Math.max(part.share, 0.01),
              background: PART_COLOURS[index % PART_COLOURS.length],
            }}
          >
            <span className="hidden truncate sm:inline">{part.title}</span>
          </span>
        ))}
      </div>
      <ol className="mt-3 flex min-w-0 flex-col">
        {timeline.parts.map((part) => (
          <li
            key={`${part.at}${part.title}`}
            className="flex min-w-0 items-baseline gap-3 border-t border-line py-2 first:border-t-0"
          >
            <span className="w-12 flex-none text-body-sm tabular-nums text-dim">{part.at}</span>
            <span className="min-w-0 flex-1 break-words text-body-md text-ink">{part.title}</span>
            <span className="flex-none text-body-sm text-muted">{part.role}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3.5 flex items-center gap-2 text-[13px] leading-[18px] text-dim">
        <Sparkles aria-hidden="true" className="h-4 w-4 flex-none text-link" />
        {timeline.named
          ? 'The chapters are the AI’s reading. Every time beside them is measured from the file.'
          : 'No chapters were named, so the video is cut evenly in code.'}
      </p>
    </Card>
  );
}

function Palette({ colours }: { readonly colours: readonly string[] }) {
  if (colours.length === 0) return null;
  return (
    <Card title="Palette" aside={<span className="text-dim">measured from its frames</span>}>
      <div className="flex flex-wrap items-center gap-2">
        {colours.map((hex) => (
          <span key={hex} className="flex items-center gap-2 text-body-sm text-muted">
            <span
              aria-hidden="true"
              className="h-7 w-7 rounded-md border border-white/15"
              style={{ background: hex }}
            />
            {hex}
          </span>
        ))}
      </div>
    </Card>
  );
}

/** The pieces of a measured teardown that can go on the format shelf. */
const BORROW = [
  { section: 'structure', label: 'Add structure' },
  { section: 'hook', label: 'Add hook beats' },
  { section: 'metrics', label: 'Add pacing' },
  { section: 'palette', label: 'Add palette' },
] as const;

/** The full teardown beside the Summary: done or not, its eight parts, and the way in. */
function FullTeardown({ videoId, done }: { readonly videoId: string; readonly done: boolean }) {
  return (
    <Card
      title="Full teardown"
      aside={done ? <Badge tone="ok">Done</Badge> : <Badge>Not made yet</Badge>}
    >
      <ol className="flex min-w-0 flex-col">
        {TEARDOWN_PARTS.map((part, index) => (
          <li
            key={part}
            className="flex items-center gap-3 border-t border-line py-2.5 text-[15px] text-ink first:border-t-0"
          >
            <span
              className={`grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ${done ? 'bg-good/15 text-good' : 'bg-white/[0.08] text-dim'}`}
            >
              {index + 1}
            </span>
            {part}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-col gap-2.5">
        <Button wide href={videoHref(videoId, 'teardown')} iconAfter={ArrowRight}>
          {done ? 'Read the teardown' : 'Break this video down'}
        </Button>
        {done && <TeardownDownloads videoId={videoId} />}
      </div>
    </Card>
  );
}

interface Props {
  readonly videoId: string;
  /** What is stored about the video; null for one the store does not hold. */
  readonly video: BankVideo | null;
  /** The video taken apart; null when it has not been. */
  readonly breakdown: VideoBreakdownView | null;
}

/**
 * A video's Summary: the stored numbers and what its score rests on, then,
 * once it has been taken apart, what was measured in its file, how it is
 * built and what can be borrowed from it.
 */
export function VideoSummary({ videoId, video, breakdown }: Props) {
  const teardown = breakdown?.teardown ?? null;
  const timeline = teardown ? timelineOf(teardown) : null;
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
        {video && <Facts facts={storedFacts(video)} />}
        {video && (
          <Card title="Why this score">
            <p className="text-body-md text-muted">{scoreBasis(video)}</p>
            <p className="mt-2 text-body-sm text-dim">
              Counted in code from stored view numbers. It says what happened, not what will.
            </p>
          </Card>
        )}
        {teardown && <Facts facts={measuredFacts(teardown)} />}
        {timeline && <Built timeline={timeline} />}
        {teardown && <Palette colours={paletteOf(teardown)} />}
        {teardown && teardown.measured !== null && (
          <Card title="What to borrow">
            <p className="mb-3 text-body-md text-muted">
              Put a piece of this video on your shelf, to use in your own format.
            </p>
            <TeardownAdds videoId={videoId} measured sections={BORROW} />
          </Card>
        )}
      </div>
      <aside className="flex min-w-0 flex-col gap-4 sm:gap-6">
        <FullTeardown videoId={videoId} done={teardown !== null} />
        <Card title="Thumbnail check">
          <Row
            title="Against the closest winners"
            meta="What they share is counted, then the AI says how to improve it."
            right={
              <Button kind="text" small href={videoHref(videoId, 'thumbnail')}>
                Open
              </Button>
            }
          />
        </Card>
      </aside>
    </div>
  );
}
