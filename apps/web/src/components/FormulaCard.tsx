import { firstSentence, formulaLine } from '../lib/formatsView';
import { formulaParts } from '@jgtube/core/src/formulas/formulas';
import { Shuffle } from 'lucide-react';
import { formatAge, formatCount, formatScore, thumbnailUrl, watchUrl } from '../lib/format';
import type { FormulaView } from '../lib/labApi';
import { AddToFormat } from './AddToFormat';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { QUIET_BUTTON } from './LabStatus';
import { Outbound } from './NicheCard';

/** Videos shown on a card before the rest go behind a disclosure. */
const VIDEOS_ON_CARD = 3;

/** A formula with each named slot drawn as a tag, so what changes from title to title stands out. */
function Wording({ formula }: { readonly formula: string }) {
  return (
    <>
      {formulaParts(formula).map((part, index) =>
        'slot' in part ? (
          <span
            key={index}
            className="mx-0.5 inline-block rounded bg-metric-amber-bg px-1.5 py-0.5 align-middle text-label text-metric-amber"
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

type Video = FormulaView['videos'][number];

/** One video behind a formula: its real thumbnail, title, channel, views, score and age. */
function VideoRow({ video }: { readonly video: Video }) {
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
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-body-sm text-on-surface">
          <Outbound href={watchUrl(video.videoId)}>{video.title}</Outbound>
        </span>
        <span className="truncate text-body-sm text-outline">
          {video.channelTitle} · {formatCount(video.views)} views ·{' '}
          <span className={video.score === null ? undefined : 'text-metric-amber'}>
            {video.score === null ? 'no score' : formatScore(video.score)}
          </span>{' '}
          · {formatAge(video.ageDays)}
        </span>
      </span>
    </li>
  );
}

function VideoList({ videos }: { readonly videos: readonly Video[] }) {
  return (
    <ul className="flex flex-col gap-space-sm">
      {videos.map((video) => (
        <VideoRow key={video.videoId} video={video} />
      ))}
    </ul>
  );
}

/** What the format's numbers rest on: its average score, its videos and its channels. */
function Numbers({
  formula,
  windowDays,
}: {
  readonly formula: FormulaView;
  readonly windowDays: number;
}) {
  return <p className="text-body-sm text-on-surface-variant">{formulaLine(formula, windowDays)}</p>;
}

interface Props {
  readonly formula: FormulaView;
  readonly windowDays: number;
  readonly onRemix: () => void;
  /** The map's own channel the formula was found for. */
  readonly centerId: string;
}

/** Why the wording works: its first sentence, and the rest behind a disclosure. */
function Why({ text }: { readonly text: string }) {
  const { lead, rest } = firstSentence(text);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-body-md text-on-surface">{lead}</p>
      {rest !== '' && (
        <Details summary="More on why">
          <p className="text-body-sm text-on-surface-variant">{rest}</p>
        </Details>
      )}
    </div>
  );
}

/** One trending format: its wording, why it works, its numbers and the videos behind it. */
export function FormulaCard({ formula, windowDays, onRemix, centerId }: Props) {
  const shown = formula.videos.slice(0, VIDEOS_ON_CARD);
  const rest = formula.videos.slice(VIDEOS_ON_CARD);
  return (
    <Card as="article">
      <div className="flex min-w-0 flex-wrap items-start gap-space-sm">
        <h3 className="min-w-0 flex-1 basis-64 break-words text-title-md text-on-surface">
          <Wording formula={formula.formula} />
        </h3>
        <button
          type="button"
          onClick={onRemix}
          className={`flex flex-none items-center gap-1.5 ${QUIET_BUTTON}`}
        >
          <Shuffle aria-hidden="true" className="h-4 w-4" />
          Add to ideas
        </button>
        <AddToFormat source={{ kind: 'formula', center: centerId, id: formula.id, windowDays }} />
      </div>
      <Numbers formula={formula} windowDays={windowDays} />
      <Why text={formula.why} />
      <VideoList videos={shown} />
      {rest.length > 0 && (
        <Details summary={`${rest.length} more ${rest.length === 1 ? 'video' : 'videos'}`}>
          <VideoList videos={rest} />
        </Details>
      )}
    </Card>
  );
}
