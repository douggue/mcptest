import { DollarSign, Layers, Plus, Star, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Level, ScoreBadge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Card } from './ui/Card';
import { Avatar, Row } from './ui/Row';
import { Stat, Stats } from './ui/Stat';
import { EmptyState, ErrorState, LoadingState } from './ui/States';
import { VideoCard } from './ui/VideoCard';

const COLOURS: readonly (readonly [string, string, string])[] = [
  ['bg-ground', 'Ground', '#05070E · page'],
  ['bg-card', 'Card', '#0F1626 · panels'],
  ['bg-signal', 'Signal cyan', '#00D2FF · one main button, active'],
  ['bg-link', 'Sky', '#38BDF8 · links, AI label'],
  ['bg-score', 'Amber', '#FBBF24 · breakout × only'],
  ['bg-good', 'Green', '#34D399 · done, earning'],
  ['bg-bad', 'Red', '#F87171 · failed'],
  ['bg-muted', 'Muted', '#9EABBB · second line'],
];

const TYPE: readonly (readonly [string, string, string])[] = [
  ['Display 40 / 48', 'text-display', 'A channel’s name'],
  ['Page title 30 / 38', 'text-headline-lg', 'Discover'],
  ['Card title 22 / 30', 'text-headline-md', 'Since your last look'],
  ['Item title 18 / 26', 'text-title-md', 'A video or an idea title'],
  ['AI answer 18 / 29', 'text-answer', 'It wins on proof before story.'],
  ['Body 16 / 24', 'text-body-md', 'Views and age of a video'],
  ['Small 14 / 20', 'text-body-sm text-muted', 'of its last 30 videos'],
];

function Line({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

function Pieces() {
  return (
    <Card title="Buttons and badges">
      <div className="flex flex-col gap-[18px]">
        <Line>
          <Button kind="main">One main action</Button>
          <Button>Second action</Button>
          <Button kind="text">Text link</Button>
          <IconButton icon={Star} label="Save" bordered />
        </Line>
        <Line>
          <ScoreBadge>269×</ScoreBadge>
          <Level level="close" />
          <Level level="medium" />
          <Level level="far" />
          <Badge tone="ok" icon={DollarSign}>
            Monetized
          </Badge>
          <Badge>Not checked</Badge>
          <Badge tone="proven">Proven</Badge>
          <Badge tone="estimate">Estimate</Badge>
          <Badge tone="warn" icon={TriangleAlert}>
            2 facts to look up
          </Badge>
        </Line>
      </div>
    </Card>
  );
}

function RowsAndNumbers() {
  return (
    <Card title="Row and number">
      <Row
        media={<Avatar title="Sample Channel" logoUrl={null} />}
        title="Sample Channel"
        meta="88K subscribers · 4 breaking out"
        right={
          <>
            <Level level="close" />
            <IconButton icon={X} label="Remove (example)" />
          </>
        }
      />
      <Row
        media={<Avatar title="Another Channel" logoUrl={null} />}
        title="Another Channel"
        meta="1.1M subscribers"
        right={<Level level="medium" />}
      />
      <div className="mt-3.5">
        <Stats columns={3}>
          <Stat label="Outliers" value="9" note="of its last 30 videos" score />
          <Stat label="Words a minute" value="168" note="yours: 149" />
          <Stat label="Uploads a week" value="1.4" note="last 8 weeks" />
        </Stats>
      </div>
    </Card>
  );
}

/**
 * The design sheet: every shared piece of the interface on one screen, with
 * example words and numbers, so a change to one can be seen against the
 * others. Not in the menu; opened by its address.
 */
export function DesignSheet() {
  return (
    <section className="mx-auto w-full max-w-[1260px] px-4 pb-space-xl pt-5 sm:px-8 sm:pt-7">
      <h1 className="text-headline-lg text-ink">Design system</h1>
      <p className="mt-1 text-body-md text-muted">
        One set of pieces, used the same way on every screen. Everything here is an example.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <Card title="Colour">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {COLOURS.map(([swatch, name, use]) => (
              <div key={name} className="min-w-0">
                <span className={`mb-1.5 block h-14 rounded border border-line-2 ${swatch}`} />
                <b className="text-body-sm font-semibold text-ink">{name}</b>
                <small className="block text-[13px] leading-[17px] text-muted">{use}</small>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Type">
          {TYPE.map(([name, size, sample]) => (
            <div
              key={name}
              className="flex min-w-0 flex-col gap-x-4 border-t border-line py-2 first:border-t-0 sm:flex-row sm:items-baseline"
            >
              <small className="w-[150px] flex-none text-[13px] text-dim">{name}</small>
              <span className={`min-w-0 break-words ${size}`}>{sample}</span>
            </div>
          ))}
        </Card>
        <Pieces />
        <RowsAndNumbers />
        <EmptyState
          title="Nothing in your library yet"
          line="Press “Add to format” on any video, hook or title."
          action={<Button kind="main">Open Discover</Button>}
        />
        <LoadingState
          title="Writing 10 ideas"
          progress="0:48 · step 2 of 3"
          share={0.55}
          line="Reading 2 videos and your format. You can leave this page."
        />
        <ErrorState
          title="YouTube did not answer"
          line="Nothing was lost. Your last reading from 2 hours ago is still shown."
          action={<Button>Try again</Button>}
        />
        <Card title="Video card">
          <div className="max-w-[340px]">
            <VideoCard
              videoId=""
              score="269×"
              durationSeconds={2205}
              title="An example video title that runs onto a second line of the card"
              channel={{ title: 'Sample Channel' }}
              meta="941K views · 8 d ago"
              actions={
                <>
                  <Button small icon={Plus}>
                    Ideas
                  </Button>
                  <Button small icon={Layers}>
                    Format
                  </Button>
                  <IconButton icon={Star} label="Save (example)" className="!h-9 !w-9" />
                </>
              }
              why="Why this score"
            />
          </div>
        </Card>
      </div>
    </section>
  );
}
