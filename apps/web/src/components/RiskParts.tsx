import { viewHref } from '../lib/routes';
import type { RiskClaim } from '@jgtube/core';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { overlapLine, PLACE_LABELS, uncheckedLine, type RiskCheckView } from '../lib/risk';
import { watchUrl } from '../lib/format';
import { Card, Label } from './layout/Card';
import { Details } from './layout/Details';
import { StatRow } from './layout/StatRow';
import { StatTile } from './layout/StatTile';
import { QUIET_BUTTON } from './LabStatus';

const ROW =
  'flex min-w-0 flex-col gap-1 border-t border-border-subtle pt-space-sm first:border-t-0 first:pt-0';
const EMPTY = 'text-body-md text-on-surface-variant';
const LINK = 'text-primary underline-offset-2 hover:underline';
/** Facts listed before the rest go behind a disclosure. */
const FACTS_SHOWN = 5;

/** The script writer's way to the check of the script it has open. */
export function RiskCheckLink() {
  return (
    <a
      href={viewHref('risk')}
      className={`inline-flex items-center gap-1.5 self-start ${QUIET_BUTTON}`}
    >
      <ShieldAlert aria-hidden="true" className="h-4 w-4" />
      Check before publishing
    </a>
  );
}

/** One part of the check: a heading and what it found. */
function Part({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card as="section" label={title}>
      <Label>{title}</Label>
      {children}
    </Card>
  );
}

function ClaimRow({ claim }: { readonly claim: RiskClaim }) {
  return (
    <li className={ROW}>
      <p className="text-body-sm text-outline">{PLACE_LABELS[claim.where]} says</p>
      <p className="break-words text-body-md font-semibold text-on-surface">“{claim.says}”</p>
      <p className="break-words text-body-sm text-on-surface-variant">
        {claim.script === null ? (
          'The script says nothing on it.'
        ) : (
          <>The script says: “{claim.script}”</>
        )}
      </p>
      <p className="text-body-sm text-on-surface">{claim.why}</p>
    </li>
  );
}

function Claims({ check }: { readonly check: RiskCheckView }) {
  if (check.ai === null) return <p className={EMPTY}>Not checked yet: press Check the claims.</p>;
  if (check.ai.claims.length === 0) return <p className={EMPTY}>None found.</p>;
  return (
    <ul className="flex flex-col gap-space-sm">
      {check.ai.claims.map((claim) => (
        <ClaimRow key={`${claim.where}:${claim.says}`} claim={claim} />
      ))}
    </ul>
  );
}

function Overlaps({ check }: { readonly check: RiskCheckView }) {
  const notes = new Map((check.ai?.notes ?? []).map((note) => [note.id, note.note]));
  if (check.overlaps.length === 0) {
    return (
      <p className={EMPTY}>
        No sentence shares six or more words in a row with a stored transcript.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-space-sm">
      {check.overlaps.map((overlap) => (
        <li key={overlap.id} className={ROW}>
          <p className="break-words text-body-md text-on-surface">{overlap.sentence}</p>
          <p className="break-words text-body-sm text-on-surface-variant">
            {overlapLine(overlap)}{' '}
            <a
              href={watchUrl(overlap.videoId) ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              their video
            </a>
          </p>
          {notes.get(overlap.id) && (
            <p className="text-body-sm text-outline">{notes.get(overlap.id)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

type Marker = RiskCheckView['unchecked'][number];

function MarkerList({ markers }: { readonly markers: readonly Marker[] }) {
  return (
    <ul className="flex flex-col gap-space-sm text-body-sm text-on-surface-variant">
      {markers.map((marker, index) => (
        <li key={`${index}:${marker.what}`} className={ROW}>
          <span className="font-semibold text-on-surface">{marker.what}</span>
          <span className="break-words">{marker.near}</span>
        </li>
      ))}
    </ul>
  );
}

function Facts({ check }: { readonly check: RiskCheckView }) {
  const rest = check.unchecked.slice(FACTS_SHOWN);
  return (
    <>
      <p className="text-body-md text-on-surface">{uncheckedLine(check.unchecked.length)}</p>
      {check.unchecked.length > 0 && <MarkerList markers={check.unchecked.slice(0, FACTS_SHOWN)} />}
      {rest.length > 0 && (
        <Details summary={`The other ${rest.length}`}>
          <MarkerList markers={rest} />
        </Details>
      )}
    </>
  );
}

/** The three counts of the check, each with what it rests on. */
export function RiskNumbers({ check }: { readonly check: RiskCheckView }) {
  return (
    <StatRow>
      <StatTile
        label="Claims to look at"
        value={check.ai === null ? '–' : check.ai.claims.length}
        note={check.ai === null ? 'not checked yet' : `title and thumbnail, by ${check.ai.engine}`}
      />
      <StatTile
        label="Shared word runs"
        value={check.overlaps.length}
        note={`against ${check.transcriptsCompared} stored transcripts`}
      />
      <StatTile
        label="Facts to check"
        value={check.unchecked.length}
        note="still marked in the script"
      />
    </StatRow>
  );
}

/** The three lists: claims to look at, shared runs of words, facts still marked. */
export function RiskLists({ check }: { readonly check: RiskCheckView }) {
  return (
    <div className="flex flex-col gap-space-lg">
      <Part title="Title and thumbnail claims the script does not support">
        <Claims check={check} />
      </Part>
      <Part title="Sentences that copy a competitor word for word">
        <Overlaps check={check} />
      </Part>
      <Part title="Facts still marked to check">
        <Facts check={check} />
      </Part>
    </div>
  );
}
