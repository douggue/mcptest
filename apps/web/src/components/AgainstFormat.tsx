import { useEffect, useMemo, useState } from 'react';
import { createFollowedApi, followedLine, rowLine, type FollowedView } from '../lib/formatFollowed';
import { viewHref } from '../lib/routes';
import { Card } from './layout/Card';
import { Details } from './layout/Details';

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly view: FollowedView | null }
  | { readonly status: 'failed'; readonly message: string };

const SHOWN_ROWS = 12;

function useFollowed(channelId: string, reloadKey: unknown): State {
  const api = useMemo(() => createFollowedApi(), []);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    api.followed(channelId).then(
      (view) => current && setState({ status: 'ready', view }),
      (error: unknown) =>
        current &&
        setState({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      current = false;
    };
  }, [api, channelId, reloadKey]);
  return state;
}

/**
 * Your videos against the channel's active format: per slot code can check,
 * how many of your videos followed it and how they did against the ones
 * that did not. Nothing shows until a format is made active.
 */
export function AgainstFormat({
  channelId,
  reloadKey,
}: {
  readonly channelId: string;
  readonly reloadKey: unknown;
}) {
  const state = useFollowed(channelId, reloadKey);
  if (state.status === 'loading') return null;
  if (state.status === 'failed') {
    return (
      <p className="text-body-sm text-error">Your format could not be read: {state.message}</p>
    );
  }
  const { view } = state;
  if (view === null) return null;
  const { report } = view;
  return (
    <Card>
      <section
        aria-labelledby="against-format-title"
        className="flex min-w-0 flex-col gap-space-sm"
      >
        <h2 id="against-format-title" className="text-title-md text-on-surface">
          Against your format: {view.format.name}
        </h2>
        <p className="text-body-sm text-outline">
          Your {report.videos} newest stored videos, checked in code against the slots of the{' '}
          <a href={viewHref('format')} className="text-primary underline">
            active format
          </a>
          . Scores are against your usual at the same age.
        </p>
        {report.slots.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            Nothing in this format can be checked in code yet: fill its title formula, pacing or a
            measured palette.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1">
            {report.slots.map((slot) => (
              <li key={slot.layer} className="break-words text-body-md text-on-surface">
                {followedLine(slot)}
                <span className="block text-body-sm text-outline">Checked: {slot.check}</span>
              </li>
            ))}
          </ul>
        )}
        {report.rows.length > 0 && (
          <Details summary={`Video by video (${Math.min(report.rows.length, SHOWN_ROWS)})`}>
            <ul className="flex min-w-0 flex-col gap-1 text-body-sm">
              {report.rows.slice(0, SHOWN_ROWS).map((row) => (
                <li key={row.videoId} className="min-w-0 break-words text-on-surface-variant">
                  <span className="text-on-surface">{row.title}</span>
                  {row.score === null ? '' : ` · ${Math.round(row.score * 10) / 10}×`} ·{' '}
                  {rowLine(row)}
                </li>
              ))}
            </ul>
          </Details>
        )}
      </section>
    </Card>
  );
}
