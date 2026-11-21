import type { OwnerPlace, TransferIdea, TransferVersion } from '@jgtube/core';
import { Bookmark, BookmarkCheck, Lightbulb } from 'lucide-react';
import { scoreTone } from '../lib/board';
import { formatAge, formatCount, formatScore, watchUrl } from '../lib/format';
import {
  describeIdeaReach,
  describeVerdict,
  statusLabel,
  templateParts,
  tileOf,
} from '../lib/transfers';
import { versionCountry } from '../lib/transferPlace';
import { Outbound } from './NicheCard';
import { ThumbnailTile } from './ThumbnailTile';

/** The multiple from which a score is drawn in amber, as on the thumbnail board. */
const AMBER = { winnerMinScore: 2 };
/** Versions listed on a card; the rest are counted. */
const VERSIONS_ON_CARD = 6;
const PILL = 'rounded-full bg-surface-container-high px-2 py-0.5 text-label-caps';

/** A title template with each slot drawn as a chip, so what changes between versions stands out. */
export function Template({ template }: { readonly template: string }) {
  return (
    <>
      {templateParts(template).map((part, index) =>
        'slot' in part ? (
          <span
            key={index}
            className={`${PILL} mx-0.5 inline-block align-middle uppercase text-primary-fixed-dim`}
          >
            {part.slot}
          </span>
        ) : (
          <span key={index} className="capitalize">
            {part.text}
          </span>
        ),
      )}
    </>
  );
}

interface SaveProps {
  readonly idea: TransferIdea;
  readonly onSetSaved: (saved: boolean) => void;
}

function SaveToggle({ idea, onSetSaved }: SaveProps) {
  const Icon = idea.saved ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      aria-pressed={idea.saved}
      aria-label={
        idea.saved ? `Stop saving the idea ${idea.template}` : `Save the idea ${idea.template}`
      }
      onClick={() => onSetSaved(!idea.saved)}
      className={`ml-auto flex flex-none items-center gap-1.5 rounded-full px-4 py-2 text-body-sm font-semibold transition-colors ${
        idea.saved
          ? 'bg-primary-container text-on-primary hover:opacity-90'
          : 'bg-surface-container-high text-primary ring-1 ring-primary-container hover:bg-primary-container hover:text-on-primary'
      }`}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {idea.saved ? 'Saved' : 'Save idea'}
    </button>
  );
}

/** One version: where it was made for, who made it, and how it did. */
function VersionRow({ version }: { readonly version: TransferVersion }) {
  const country = versionCountry(version);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="flex min-w-0 flex-1 basis-40 items-baseline gap-2">
        <span className={`${PILL} flex-none text-on-surface-variant`}>
          {version.place?.name ?? 'Country unknown'}
        </span>
        <span className="truncate text-body-sm text-on-surface" title={version.title}>
          <Outbound href={watchUrl(version.videoId)}>{version.channelTitle}</Outbound>
        </span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-label-caps text-outline">
        <span
          className={country.elsewhere ? 'text-metric-amber' : undefined}
          title={
            country.elsewhere
              ? 'This channel is in another country than the place its title names.'
              : undefined
          }
        >
          {country.elsewhere ? `${country.text} · made from elsewhere` : country.text}
        </span>
        <span>{formatCount(version.subscribers)} subs</span>
        <span className="text-primary">{formatCount(version.views)} views</span>
        <span className={version.strong ? 'text-metric-amber' : undefined}>
          {version.score === null ? '—' : formatScore(version.score)}
        </span>
        <span>{formatAge(version.ageDays)}</span>
      </span>
    </li>
  );
}

/** The versions side by side, most viewed first, beside the thumbnail of the strongest. */
function Versions({ idea }: { readonly idea: TransferIdea }) {
  const strongest = idea.verdict.winner ?? idea.best;
  const hidden = idea.versionCount - Math.min(idea.versions.length, VERSIONS_ON_CARD);
  if (!strongest) return null;
  return (
    <div className="grid grid-cols-1 gap-space-md sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <ThumbnailTile video={tileOf(strongest)} tone={scoreTone(strongest.score, AMBER)} />
      <div className="flex min-w-0 flex-col gap-space-sm">
        <span className="text-label-caps uppercase text-outline">
          Versions · place in the title, channel and its country, subscribers, views, score, age
        </span>
        <ul className="flex flex-col gap-space-sm">
          {idea.versions.slice(0, VERSIONS_ON_CARD).map((version) => (
            <VersionRow key={version.videoId} version={version} />
          ))}
        </ul>
        {hidden > 0 && <span className="text-label-caps text-outline">and {hidden} more</span>}
      </div>
    </div>
  );
}

/** Titles made for the owner's place that are one word away: the owner judges whether it is the same idea. */
function Variants({ idea, place }: { readonly idea: TransferIdea; readonly place: string }) {
  if (idea.variants.length === 0) return null;
  return (
    <div className="flex flex-col gap-space-sm">
      <span className="text-label-caps uppercase text-outline">
        One word different, made for {place}
      </span>
      <ul className="flex flex-col gap-space-sm">
        {idea.variants.map((variant) => (
          <li key={variant.videoId} className="flex items-baseline justify-between gap-3">
            <span className="line-clamp-2 min-w-0 text-body-sm text-on-surface">
              <Outbound href={watchUrl(variant.videoId)}>{variant.title}</Outbound>
            </span>
            <span className="flex-none text-label-caps text-outline">
              {formatCount(variant.views)} views
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props extends SaveProps {
  readonly ownerPlace: OwnerPlace | null;
  /** Takes the idea into the idea lab; absent where there is no idea lab. */
  readonly onMakeConcepts?: (() => void) | undefined;
}

/** One idea several channels made: the verdict for the owner's place, then its versions. */
export function TransferCard({ idea, ownerPlace, onSetSaved, onMakeConcepts }: Props) {
  return (
    <article
      className={`flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md ${
        idea.saved ? 'ring-1 ring-border-highlight' : ''
      }`}
    >
      <div className="flex min-w-0 items-start gap-space-sm">
        <h3 className="min-w-0 text-title-md text-on-surface">
          <Template template={idea.template} />
        </h3>
        <SaveToggle idea={idea} onSetSaved={onSetSaved} />
      </div>
      <div className="flex flex-col gap-space-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`${PILL} ${idea.opportunity ? 'text-primary-fixed-dim' : 'text-on-surface-variant'}`}
          >
            {statusLabel(idea.verdict.status)}
          </span>
          {idea.versionCount > 0 && (
            <span className="text-label-caps text-outline">{describeIdeaReach(idea)}</span>
          )}
        </div>
        <p className="text-body-md text-on-surface">{describeVerdict(idea, ownerPlace)}</p>
      </div>
      <Versions idea={idea} />
      {ownerPlace && <Variants idea={idea} place={ownerPlace.name} />}
      {onMakeConcepts && (
        <button
          type="button"
          onClick={onMakeConcepts}
          className="flex items-center gap-1.5 self-start rounded-full bg-surface-container-high px-3 py-1.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-highest focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
        >
          <Lightbulb aria-hidden="true" className="h-4 w-4" />
          Make concepts from this idea
        </button>
      )}
    </article>
  );
}
