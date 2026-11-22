import type { MapSnapshot } from '@jgtube/core';
import { useState } from 'react';
import { formatCount } from '../lib/format';
import { channelHref } from '../lib/routes';
import { Card, Label } from './layout/Card';
import { ChannelRow } from './layout/ChannelRow';
import { QUIET_BUTTON } from './LabStatus';
import { TIER_LABEL } from './tiers';
import { messageOf, type MapPage } from './useMapPage';
import { MoneyBadge } from './MoneyBadge';

/** How many rows show before "Show all". */
const FIRST_ROWS = 10;

interface Props {
  readonly snapshot: MapSnapshot;
  readonly page: MapPage;
}

/**
 * The channels the map counts as competitors of its centre, as clean rows:
 * logo, name, how close it sits and its subscribers. A row opens the
 * channel's own view; the cross takes it off the competitors.
 */
export function ChannelCompetitors({ snapshot, page }: Props) {
  const [all, setAll] = useState(false);
  const competitors = snapshot.channels.filter((channel) => channel.peer && !channel.removed);
  const shown = all ? competitors : competitors.slice(0, FIRST_ROWS);
  const remove = (channelId: string): void => {
    page
      .setStatus(channelId, 'removed')
      .catch((error: unknown) => page.setMessage(messageOf(error)));
  };
  return (
    <Card as="section" label="Its competitors">
      <Label>Its competitors ({competitors.length})</Label>
      {competitors.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          The map counts no channel as like this one yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {shown.map((channel) => (
            <ChannelRow
              key={channel.id}
              title={channel.title}
              logoUrl={channel.logoUrl}
              href={channelHref(channel.id)}
              level={{ text: TIER_LABEL[channel.tier], tone: channel.tier }}
              count={`${formatCount(channel.subscribers)} subscribers`}
              onRemove={() => remove(channel.id)}
              removeLabel={`Remove ${channel.title} from the competitors`}
              badge={<MoneyBadge channelId={channel.id} hideUnchecked />}
            />
          ))}
        </ul>
      )}
      {competitors.length > FIRST_ROWS && (
        <button type="button" onClick={() => setAll(!all)} className={`w-fit ${QUIET_BUTTON}`}>
          {all ? 'Show fewer' : `Show all ${competitors.length}`}
        </button>
      )}
    </Card>
  );
}
