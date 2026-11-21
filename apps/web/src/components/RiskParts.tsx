import type { RiskClaim } from '@jgtube/core';
import { ShieldAlert } from 'lucide-react';
import { overlapLine, PLACE_LABELS, uncheckedLine, type RiskCheckView } from '../lib/risk';
import { watchUrl } from '../lib/format';
import { NOTE, QUIET_BUTTON } from './LabStatus';

const LABEL = 'text-label-caps uppercase text-outline';
const CARD = 'flex min-w-0 flex-col gap-1 rounded bg-surface-card p-space-md';
const LINK = 'text-primary underline-offset-2 hover:underline';

/** The script writer's way to the check of the script it has open. */
export function RiskCheckLink() {
  return (
    <a
      href="#risk-check-title"
      className={`inline-flex items-center gap-1.5 self-start ${QUIET_BUTTON}`}
    >
      <ShieldAlert aria-hidden="true" className="h-4 w-4" />
      Check before publishing
    </a>
  );
}

function ClaimCard({ claim }: { readonly claim: RiskClaim }) {
  return (
    <li className={CARD}>
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

/** The three lists: claims to look at, shared runs of words, facts still marked. */
export function RiskLists({ check }: { readonly check: RiskCheckView }) {
  const notes = new Map((check.ai?.notes ?? []).map((note) => [note.id, note.note]));
  return (
    <div className="flex flex-col gap-space-lg">
      <div className="flex flex-col gap-space-sm">
        <h3 className={LABEL}>Title and thumbnail claims the script does not support</h3>
        {check.ai === null ? (
          <p className={NOTE}>Not checked yet: press Check the claims.</p>
        ) : check.ai.claims.length === 0 ? (
          <p className={NOTE}>None found.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-space-sm lg:grid-cols-2">
            {check.ai.claims.map((claim) => (
              <ClaimCard key={`${claim.where}:${claim.says}`} claim={claim} />
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-space-sm">
        <h3 className={LABEL}>
          Sentences sharing long runs of words with a competitor (found in code)
        </h3>
        {check.overlaps.length === 0 ? (
          <p className={NOTE}>
            No sentence shares six or more words in a row with a stored transcript.
          </p>
        ) : (
          <ul className="flex flex-col gap-space-sm">
            {check.overlaps.map((overlap) => (
              <li key={overlap.id} className={CARD}>
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
        )}
      </div>
      <div className="flex flex-col gap-space-sm">
        <h3 className={LABEL}>Facts still marked to check</h3>
        <p className="text-body-md text-on-surface">{uncheckedLine(check.unchecked.length)}</p>
        {check.unchecked.length > 0 && (
          <ul className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
            {check.unchecked.map((marker, index) => (
              <li key={`${index}:${marker.what}`} className="break-words">
                <span className="font-semibold text-on-surface">{marker.what}</span> · {marker.near}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
