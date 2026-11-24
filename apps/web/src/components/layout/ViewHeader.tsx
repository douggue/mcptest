import { ArrowLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  readonly title: ReactNode;
  /** One short line under the title; never a paragraph. */
  readonly lead?: ReactNode;
  /** Kept for callers; not drawn, as no title carries an icon. */
  readonly icon?: LucideIcon;
  /** A few words beside the title, such as a count. */
  readonly count?: ReactNode;
  /** The view's one primary action, at the right; quiet ones may sit beside it. */
  readonly actions?: ReactNode;
  /**
   * A way back, shown as an arrow before the title. With `history`, the
   * arrow goes back in the browser's history, and to `href` only when there
   * is none.
   */
  readonly back?: { readonly href: string; readonly label: string; readonly history?: boolean };
  /** A picture before the title, such as a channel's logo. */
  readonly media?: ReactNode;
  readonly titleId?: string;
}

/**
 * The top of a screen, under its place's name and tabs: an optional way
 * back, the screen's title (a card title, as the place carries the page
 * title) with one short line under it, and the primary action at the right. Wraps under the title on a
 * phone.
 */
export function ViewHeader(props: Props) {
  // `icon` is taken and not drawn: titles carry no icon, so they read the same on every view.
  const { title, lead, count, actions, back, media, titleId } = props;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-space-md gap-y-space-sm">
      {back && (
        <a
          href={back.href}
          aria-label={back.label}
          onClick={(event) => {
            // Back where the owner came from, when this view was opened from another one.
            if (!back.history || window.history.length < 2) return;
            event.preventDefault();
            window.history.back();
          }}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-card hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </a>
      )}
      {media}
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <h2
          id={titleId}
          className="flex min-w-0 flex-wrap items-center gap-2 text-headline-md text-on-surface"
        >
          <span className="min-w-0 break-words">{title}</span>
          {count !== undefined && (
            <span className="text-body-md font-normal text-outline">({count})</span>
          )}
        </h2>
        {lead && <div className="text-body-md text-on-surface-variant">{lead}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
