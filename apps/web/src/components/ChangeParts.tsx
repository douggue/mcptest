import { channelHref, videoHref } from '../lib/routes';
import type { BreakoutFormat, GroupChange, LookalikeRef, NewBreakout } from '@jgtube/core';
import { TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  breakoutBefore,
  describeLookalikes,
  groupLine,
  hasNothingNew,
  moreBreakouts,
  uncomparedNote,
  type ChangesReply,
} from '../lib/changes';
import { formatCount, formatScore, thumbnailUrl } from '../lib/format';

const LABEL = 'text-label text-outline';
export const LINK = 'text-primary underline-offset-2 hover:underline';

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <h3 className={LABEL}>{title}</h3>
      {children}
    </div>
  );
}

function BreakoutCard({ entry }: { readonly entry: NewBreakout }) {
  const href = videoHref(entry.videoId);
  const thumbnail = thumbnailUrl(entry.videoId);
  return (
    <article className="flex min-w-0 gap-space-md rounded-lg bg-space-deep p-space-sm">
      <div className="aspect-video w-28 flex-none overflow-hidden rounded bg-surface-container-high">
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-metric-amber-bg px-2 py-0.5 text-metric-badge text-metric-amber">
            <TrendingUp aria-hidden="true" className="h-3.5 w-3.5" />
            {formatScore(entry.score)}
          </span>
          <span className="text-label text-outline">
            {formatCount(entry.views)} views · {entry.publishedRaw}
          </span>
        </div>
        <p className="line-clamp-2 text-body-md font-semibold text-on-surface">
          {href ? (
            <a href={href} className="hover:text-primary">
              {entry.title}
            </a>
          ) : (
            entry.title
          )}
        </p>
        <p className="truncate text-body-sm text-on-surface-variant">{entry.channelTitle}</p>
        <p className="text-body-sm text-outline">{breakoutBefore(entry)}</p>
      </div>
    </article>
  );
}

function ChannelNames({ channels }: { readonly channels: readonly LookalikeRef[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {channels.map((channel) => {
        const href = channelHref(channel.channelId);
        return (
          <li
            key={channel.channelId}
            className="rounded-full bg-surface-container px-3 py-1 text-body-sm text-on-surface"
          >
            {href ? (
              <a href={href} className="hover:text-primary">
                {channel.title}
              </a>
            ) : (
              channel.title
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GroupLines({ changes }: { readonly changes: readonly GroupChange[] }) {
  return (
    <ul className="flex flex-col gap-1 text-body-md text-on-surface">
      {changes.map((change) => (
        <li key={change.channelId}>{groupLine(change)}</li>
      ))}
    </ul>
  );
}

function FormatLines({ formats }: { readonly formats: readonly BreakoutFormat[] }) {
  return (
    <ul className="flex flex-col gap-space-sm">
      {formats.map((format) => (
        <li key={format.template} className="rounded-lg bg-space-deep p-space-sm">
          <p className="text-body-md font-semibold text-on-surface">{format.template}</p>
          <p className="text-body-sm text-outline">In {format.videos.length} breakouts:</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-body-sm text-on-surface-variant">
            {format.videos.map((video) => {
              const href = videoHref(video.videoId);
              return (
                <li key={video.videoId} className="truncate">
                  {href ? (
                    <a href={href} className={LINK}>
                      {video.title}
                    </a>
                  ) : (
                    video.title
                  )}{' '}
                  · {video.channelTitle}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Everything that changed, or one plain line when nothing did. */
export function Findings({ reply }: { readonly reply: ChangesReply }) {
  const { changes, lookalikes } = reply;
  const { takenOff, rising, droppedOut } = changes.groups;
  const uncompared = uncomparedNote(changes);
  const lookalikeNote = describeLookalikes(lookalikes);
  const more = moreBreakouts(changes);
  const moved =
    takenOff.length + rising.length + droppedOut.length > 0 ||
    (lookalikes.comparable && lookalikes.added.length + lookalikes.gone.length > 0);
  if (hasNothingNew(reply)) {
    return (
      <p className="text-body-md text-on-surface-variant">
        {uncompared ?? `Nothing new among the look-alikes on this map. ${lookalikeNote ?? ''}`}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-space-lg">
      {changes.newBreakoutCount > 0 && (
        <Group title={`New breakouts (${changes.newBreakoutCount})`}>
          <div className="flex flex-col gap-space-sm">
            {changes.newBreakouts.map((entry) => (
              <BreakoutCard key={entry.videoId} entry={entry} />
            ))}
          </div>
          {more && <p className="text-body-sm text-outline">{more}</p>}
        </Group>
      )}
      {moved && (
        <div className="grid grid-cols-1 gap-space-lg md:grid-cols-2">
          {takenOff.length > 0 && (
            <Group title="Newly taken off">
              <GroupLines changes={takenOff} />
            </Group>
          )}
          {rising.length > 0 && (
            <Group title="Newly rising">
              <GroupLines changes={rising} />
            </Group>
          )}
          {droppedOut.length > 0 && (
            <Group title="Dropped out">
              <GroupLines changes={droppedOut} />
            </Group>
          )}
          {lookalikes.comparable && lookalikes.added.length > 0 && (
            <Group title="New look-alikes on the map">
              <ChannelNames channels={lookalikes.added} />
            </Group>
          )}
          {lookalikes.comparable && lookalikes.gone.length > 0 && (
            <Group title="Look-alikes no longer on the map">
              <ChannelNames channels={lookalikes.gone} />
            </Group>
          )}
        </div>
      )}
      {changes.formats.length > 0 && (
        <Group title="Title formats newly seen in several breakouts">
          <FormatLines formats={changes.formats} />
        </Group>
      )}
      {uncompared && <p className="text-body-sm text-outline">{uncompared}</p>}
      {lookalikeNote && <p className="text-body-sm text-outline">{lookalikeNote}</p>}
    </div>
  );
}
