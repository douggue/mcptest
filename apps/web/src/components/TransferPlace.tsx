import { TriangleAlert } from 'lucide-react';
import {
  describeCountry,
  describeDisagreement,
  describePlaceInUse,
  placeChoices,
  type TransferReply,
} from '../lib/transferPlace';

interface Props {
  readonly list: TransferReply;
  /** What reading the countries just did, in a sentence; null when nothing to say. */
  readonly countryNote: string | null;
  /** Stores the owner's choice of place for the channel on screen; null removes it. */
  readonly onChoose: (placeKey: string | null) => void;
}

const LABEL = 'text-label text-outline';

/**
 * Which place the ideas are judged for and where that came from: the owner's
 * choice, the channel's titles or its country on YouTube. The country is
 * always said, known or not, and a disagreement between titles and country
 * is flagged. The owner can set the place from the list; it is kept for
 * this channel.
 */
export function TransferPlace({ list, countryNote, onChoose }: Props) {
  const { placeCheck: check, ownerPlace } = list;
  if (check.channelId === null) return null;
  const disagreement = describeDisagreement(check);
  return (
    <div
      role="group"
      aria-label="The place these ideas are judged for"
      className="flex min-w-0 flex-col gap-space-sm"
    >
      <span className={LABEL}>Your place</span>
      <p className="text-body-md text-on-surface">{describePlaceInUse(ownerPlace)}</p>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-body-sm text-on-surface-variant">Set it yourself</span>
        <select
          value={check.chosen?.key ?? ''}
          onChange={(event) => onChoose(event.target.value === '' ? null : event.target.value)}
          className="min-h-11 w-full rounded-full bg-space-deep px-4 text-body-sm text-on-surface shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
        >
          {placeChoices().map((place) => (
            <option key={place.key} value={place.key}>
              {place.name}
            </option>
          ))}
        </select>
      </label>
      <ul className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
        <li>
          {check.fromTitles
            ? `Most of the channel’s titles name ${check.fromTitles.name}.`
            : 'No one place is named in most of the channel’s titles.'}
        </li>
        <li>{describeCountry(check, list.canReadCountries)}</li>
        {countryNote && <li role="status">{countryNote}</li>}
      </ul>
      {disagreement && (
        <p role="alert" className="flex items-start gap-2 text-body-sm text-metric-amber">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none" />
          <span>{disagreement}</span>
        </p>
      )}
    </div>
  );
}
