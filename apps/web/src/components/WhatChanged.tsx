import type { BreakoutFormat, GroupChange, LookalikeRef, NewBreakout } from '@jgtube/core';
import { Check, Eye, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  SINCE_OPTIONS,
  breakoutBefore,
  describeFreshness,
  describeLookalikes,
  describeSince,
  groupLine,
  hasNothingNew,
  moreBreakouts,
  uncomparedNote,
  type ChangesReply,
} from '../lib/changes';
import { channelUrl, formatCount, formatScore, thumbnailUrl, watchUrl } from '../lib/format';
import type { Changes } from './useChanges';

const NOTE = 'rounded bg-surface-card p-space-md text-body-md text-on-surface-variant';
const LABEL = 'text-label-caps uppercase text-outline';
const LINK = 'text-primary underline-offset-2 hover:underline';
/** The strip at the foot of the page that holds the "Refresh now" button. */
const REFRESH_ID = 'refresh-title';

function Group({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <h3 className={LABEL}>{title}</h3>
      {children}
    </div>
  );
}

function BreakoutCard({ entry }: { readonly entry: NewBreakout }) {
  const href = watchUrl(entry.videoId);
  const thumbnail = thumbnailUrl(entry.videoId);
  return (
    <article className="flex min-w-0 gap-space-sm rounded bg-surface-card p-space-sm">
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
          <span className="text-label-caps text-outline">
            {formatCount(entry.views)} views · {entry.publishedRaw}
          </span>
        </div>
        <p className="line-clamp-2 text-body-md font-semibold text-on-surface">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
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
        const href = channelUrl(channel.channelId);
        return (
          <li
            key={channel.channelId}
            className="rounded-full bg-surface-container px-3 py-1 text-body-sm text-on-surface"
          >
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary"
              >
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
        <li key={format.template} className="rounded bg-surface-card p-space-sm">
          <p className="text-body-md font-semibold text-on-surface">{format.template}</p>
          <p className="text-body-sm text-outline">In {format.videos.length} breakouts:</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-body-sm text-on-surface-variant">
            {format.videos.map((video) => {
              const href = watchUrl(video.videoId);
              return (
                <li key={video.videoId} className="truncate">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
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
function Findings({ reply }: { readonly reply: ChangesReply }) {
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
      <p className={NOTE}>
        {uncompared ?? `Nothing new among the look-alikes on this map. ${lookalikeNote ?? ''}`}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-space-lg">
      {changes.newBreakoutCount > 0 && (
        <Group title={`New breakouts (${changes.newBreakoutCount})`}>
          <div className="grid grid-cols-1 gap-space-sm lg:grid-cols-2 2xl:grid-cols-3">
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

interface Props {
  readonly changes: Changes;
  readonly centerTitle: string;
  /** More to show under the findings, such as alerts. */
  readonly children?: ReactNode;
}

/**
 * What changed among the look-alikes of the channel on screen since the owner
 * last looked: worked out from stored readings, with when those were taken.
 */
export function WhatChanged({ changes, centerTitle, children }: Props) {
  const { state, since, setSince, markSeen } = changes;
  if (state.status === 'idle') return null;
  const reply = state.status === 'ready' ? state.reply : null;
  const now = new Date();
  const freshness = reply ? describeFreshness(reply.freshness, now) : null;

  return (
    <section
      aria-labelledby="what-changed-title"
      className="w-full bg-space-canvas px-gutter-desktop pb-space-lg"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-md">
        <div className="flex flex-col justify-between gap-space-md sm:flex-row sm:items-end">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Eye aria-hidden="true" className="h-[22px] w-[22px] flex-none text-primary" />
              <h2 id="what-changed-title" className="text-headline-md font-bold text-on-surface">
                What changed around {centerTitle}
              </h2>
            </div>
            <p className="mt-1 text-body-md text-on-surface-variant">
              {reply
                ? describeSince(reply, now)
                : 'New breakouts and channel moves among the look-alikes on this map.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="group" aria-label="Compare from" className="flex flex-wrap gap-1.5">
              {SINCE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={since === option.id}
                  onClick={() => setSince(option.id)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-label-caps transition-colors ${
                    since === option.id
                      ? 'bg-surface-card font-semibold text-primary shadow-sm'
                      : 'bg-surface-container text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={markSeen}
              disabled={reply === null}
              className="flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check aria-hidden="true" className="h-4 w-4" />
              Mark as seen
            </button>
          </div>
        </div>

        {state.status === 'loading' && (
          <p role="status" className={NOTE}>
            Comparing the stored readings
          </p>
        )}
        {state.status === 'failed' && (
          <p role="alert" className="rounded bg-surface-card p-space-md text-body-md text-error">
            What changed could not be loaded: {state.message}
          </p>
        )}
        {state.status === 'ready' && state.problem && (
          <p role="alert" className="rounded bg-surface-card p-space-md text-body-md text-error">
            {state.problem}
          </p>
        )}
        {reply && <Findings reply={reply} />}
        {children}
        {freshness && (
          <p className={`text-body-sm ${freshness.stale ? 'text-metric-amber' : 'text-outline'}`}>
            {freshness.text}{' '}
            {freshness.stale ? 'Some are more than a day old, so this may be out of date. ' : ''}
            This can only be as fresh as the last refresh:{' '}
            <a href={`#${REFRESH_ID}`} className={LINK}>
              Refresh now
            </a>
            .
          </p>
        )}
      </div>
    </section>
  );
}
