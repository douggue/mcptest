import { FORMULA_WINDOWS, formulaParts } from '@jgtube/core/src/formulas/formulas';
import { Shapes } from 'lucide-react';
import { formatAge, formatCount, formatScore, thumbnailUrl, watchUrl } from '../lib/format';
import type { FormulaView } from '../lib/labApi';
import { FIELD, LabStatus, NOTE, PILL, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import { SectionFrame } from './SectionFrame';
import { Outbound } from './NicheCard';
import type { Lab } from './useLab';

const LABEL = 'text-label-caps uppercase text-outline';
/** Videos listed on a card before "and N more". */
const VIDEOS_ON_CARD = 5;

/** A formula with each named slot drawn as a chip, so what changes from title to title stands out. */
function Wording({ formula }: { readonly formula: string }) {
  return (
    <>
      {formulaParts(formula).map((part, index) =>
        'slot' in part ? (
          <span
            key={index}
            className={`${PILL} mx-0.5 inline-block align-middle uppercase text-primary-fixed-dim`}
          >
            {part.slot}
          </span>
        ) : (
          <span key={index}>{part.text} </span>
        ),
      )}
    </>
  );
}

/** One video behind a formula: its real thumbnail, title, channel, views and score. */
function VideoRow({ video }: { readonly video: FormulaView['videos'][number] }) {
  const picture = thumbnailUrl(video.videoId);
  return (
    <li className="flex min-w-0 items-center gap-space-sm">
      <span className="aspect-video w-24 flex-none overflow-hidden rounded bg-surface-container-high">
        {picture && (
          <img
            src={picture}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-body-sm text-on-surface">
          <Outbound href={watchUrl(video.videoId)}>{video.title}</Outbound>
        </span>
        <span className="truncate text-label-caps text-outline">
          {video.channelTitle} ·{' '}
          <span className="text-primary">{formatCount(video.views)} views</span> ·{' '}
          <span className={video.score === null ? undefined : 'text-metric-amber'}>
            {video.score === null ? 'no score' : formatScore(video.score)}
          </span>{' '}
          · {formatAge(video.ageDays)}
        </span>
      </span>
    </li>
  );
}

interface CardProps {
  readonly formula: FormulaView;
  readonly onRemix: () => void;
}

function FormulaCard({ formula, onRemix }: CardProps) {
  const hidden = formula.videos.length - VIDEOS_ON_CARD;
  return (
    <article className="flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md">
      <div className="flex min-w-0 items-start gap-space-sm">
        <h3 className="min-w-0 flex-1 break-words text-title-md text-on-surface">
          <Wording formula={formula.formula} />
        </h3>
        <button type="button" onClick={onRemix} className={`flex-none ${QUIET_BUTTON}`}>
          Remix in idea lab
        </button>
      </div>
      <p className="text-body-md text-on-surface">{formula.why}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${PILL} text-metric-amber`}>
          {formula.averageScore === null
            ? 'no score to average'
            : `average ${formatScore(formula.averageScore)}`}
        </span>
        <span className={`${PILL} text-on-surface-variant`}>
          {formula.videoCount} videos · {formula.channelCount}{' '}
          {formula.channelCount === 1 ? 'channel' : 'channels'}
        </span>
        {formula.scoredCount < formula.videoCount && (
          <span className="text-label-caps text-outline">
            averaged over the {formula.scoredCount} that have a score
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-space-sm">
        {formula.videos.slice(0, VIDEOS_ON_CARD).map((video) => (
          <VideoRow key={video.videoId} video={video} />
        ))}
      </ul>
      {hidden > 0 && <span className="text-label-caps text-outline">and {hidden} more</span>}
    </article>
  );
}

/** What the last run left out, so nothing disappears without a word. */
function Notes({ lab }: { readonly lab: Lab }) {
  const notes = lab.formulaNotes;
  if (notes === null || (notes.dropped.length === 0 && notes.unread === 0)) return null;
  return (
    <div className={`flex flex-col gap-1 ${NOTE}`}>
      <p>
        The AI proposed {notes.proposed + notes.unread} formulas. Jgtube left out{' '}
        {notes.dropped.length + notes.unread} of them:
      </p>
      {notes.unread > 0 && <p>– {notes.unread} could not be read: a part was missing.</p>}
      {notes.dropped.map((one) => (
        <p key={one.formula} className="break-words">
          – {one.formula}: {one.reason}
        </p>
      ))}
    </div>
  );
}

interface Props {
  readonly lab: Lab;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  readonly centerTitle: string;
  /** Takes a formula into the idea lab as its title format. */
  readonly onRemix: (formulaId: number) => void;
}

/**
 * Title formulas: wordings that several videos doing unusually well on this
 * map share, with named slots for what changes. An AI proposes them; which
 * videos count and every number shown come from the store.
 */
export function Formulas({ lab, busy, centerTitle, onRemix }: Props) {
  const list = lab.formulas;
  return (
    <SectionFrame
      id="formulas"
      titleId="formulas-title"
      title="Trending formats"
      icon={Shapes}
      summary={list && list.formulas.length > 0 ? `${list.formulas.length} found` : undefined}
      lead={
        <>Title wordings that several videos doing unusually well around {centerTitle} share.</>
      }
      howItWorks={
        <p>
          An AI groups the titles, with a named slot for what changes. Jgtube keeps a formula only
          when at least two stored videos of this map stand behind it, and works out the numbers
          itself. One video is an example, not a format. &ldquo;Remix in idea lab&rdquo; takes a
          format into the idea lab.
        </p>
      }
      actions={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={lab.findFormulas}
            className={PRIMARY_BUTTON}
          >
            Find formats
          </button>
          <label className="flex items-center gap-2">
            <span className={LABEL}>Videos from the last</span>
            <select
              value={lab.formulaWindow}
              onChange={(event) => lab.setFormulaWindow(Number(event.target.value))}
              disabled={busy}
              className={`${FIELD} w-auto`}
            >
              {FORMULA_WINDOWS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      <LabStatus
        state={lab.jobs.state}
        kinds={['formulas']}
        working="Asking the AI to group the titles"
        takes="An AI run of two to three minutes; it uses some of that AI’s plan allowance."
      />
      <Notes lab={lab} />
      {list && list.formulas.length === 0 && (
        <p className={NOTE}>
          No formats have been found for the last {list.windowDays} days yet. Press Find formats: it
          is an AI run of two to three minutes, using the AI chosen under Ask AI.
        </p>
      )}
      {list && list.formulas.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
            {list.formulas.map((formula) => (
              <FormulaCard key={formula.id} formula={formula} onRemix={() => onRemix(formula.id)} />
            ))}
          </div>
          {list.runAt && (
            <p className="text-body-sm text-outline">
              Found on {list.runAt.slice(0, 10)}, from videos of the {list.windowDays} days before.
              The next run for this window replaces them.
            </p>
          )}
        </>
      )}
    </SectionFrame>
  );
}
