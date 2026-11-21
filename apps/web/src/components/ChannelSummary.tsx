import type { ChannelProfile } from '@jgtube/core';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { profileTiles, readLine } from '../lib/channelView';
import { channelUrl } from '../lib/format';
import { ChannelLogo } from './ChannelLogo';

interface Props {
  readonly profile: ChannelProfile;
  /** Shown beside the name, such as a link to the channel's own view. */
  readonly action?: ReactNode;
}

/** A channel's logo, name and stored numbers, each labelled with what it rests on. */
export function ChannelSummary({ profile, action }: Props) {
  const link = channelUrl(profile.id);
  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      <div className="flex min-w-0 flex-wrap items-center gap-space-md">
        <span className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full bg-surface-container-high text-headline-md font-bold text-secondary shadow-md">
          <ChannelLogo title={profile.title} logoUrl={profile.logoUrl} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="break-words text-headline-lg font-bold tracking-tight text-on-surface">
            {profile.title}
          </h2>
          <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-outline">
            {profile.handle && <span>@{profile.handle}</span>}
            <span>{readLine(profile, new Date())}</span>
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
        </div>
        {action}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {profileTiles(profile).map((tile) => (
          <div key={tile.label} className="flex min-w-0 flex-col rounded bg-surface-card p-3">
            <dt className="text-label-caps uppercase text-outline">{tile.label}</dt>
            <dd className="text-headline-md font-bold text-on-surface">{tile.value}</dd>
            <dd className="text-label-caps normal-case text-on-surface-variant">{tile.note}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
