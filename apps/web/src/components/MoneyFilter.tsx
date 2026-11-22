import {
  MAX_CHECK_IDS,
  MONEY_FILTERS,
  uncheckedNote,
  type MoneyFilter as Filter,
} from '../lib/money';
import { Field } from './layout/Card';
import { Segmented } from './layout/Segmented';
import { MoneyCheck } from './MoneyCheck';
import { useMoney, useMoneyFilter, type MoneyListView } from './useMoney';

/** What a list says when the monetization filter left none of its channels. */
export const MONEY_EMPTY =
  'No channel on this list matches that monetization filter. Channels not checked yet are left out.';

interface Props {
  readonly view: MoneyListView;
  /** Every channel of the list, so its verdicts are read and the unchecked ones counted. */
  readonly channelIds: readonly string[];
}

/** A list's monetization filter, with what it leaves out and a way to check those. */
export function MoneyFilter({ view, channelIds }: Props) {
  const [value, setValue] = useMoneyFilter(view);
  const { byId } = useMoney(channelIds);
  if (channelIds.length === 0) return null;
  const note = uncheckedNote(channelIds, byId, value);
  const next = channelIds
    .filter((id) => (byId.get(id)?.status ?? 'not-checked') === 'not-checked')
    .slice(0, MAX_CHECK_IDS);
  return (
    <Field label="Monetization">
      <Segmented<Filter>
        label="Which channels to show by monetization"
        options={MONEY_FILTERS.map((option) => ({ value: option.id, label: option.label }))}
        value={value}
        onChange={setValue}
      />
      {note && <p className="mt-2 text-body-sm text-outline">{note}</p>}
      {value !== 'any' && next.length > 0 && (
        <div className="mt-2">
          <MoneyCheck channelIds={next} label={`Check ${next.length} of them`} />
        </div>
      )}
    </Field>
  );
}
