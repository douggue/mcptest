import type { ChannelProfile } from '@jgtube/core';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { profileTiles, readLine } from '../lib/channelView';
import { channelUrl } from '../lib/format';
import { viewHref } from '../lib/routes';
import { ChannelLogo } from './ChannelLogo';
import { StatGrid, StatTile } from './layout/StatTile';
import { ViewHeader } from './layout/ViewHeader';

interface Props {
  readonly profile: ChannelProfile;
  /** The primary action at the right, such as a link to the channel's own view. */
  readonly action?: ReactNode;
  /** Shows a back arrow, as on the channel's own view. */
  readonly withBack?: boolean;
}

/** A channel's header (logo, name, handle, when it was read) and its stored numbers, each labelled. */
export function ChannelSummary({ profile, action, withBack }: Props) {
  const link = channelUrl(profile.id);
  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <ViewHeader
        back={withBack ? { href: viewHref('home'), label: 'Back', history: true } : undefined}
        media={
          <span className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-headline-md font-bold text-secondary ring-2 ring-border-subtle">
            <ChannelLogo title={profile.title} logoUrl={profile.logoUrl} />
          </span>
        }
        title={profile.title}
        lead={
          <span className="flex flex-wrap items-center gap-x-3 text-body-sm">
            {profile.handle && (
              <span className="text-body-md text-on-surface-variant">@{profile.handle}</span>
            )}
            <span className="text-outline">{readLine(profile, new Date())}</span>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                YouTube
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            )}
          </span>
        }
        actions={action}
      />
      <StatGrid>
        {profileTiles(profile).map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={tile.value} note={tile.note} />
        ))}
      </StatGrid>
    </div>
  );
}
