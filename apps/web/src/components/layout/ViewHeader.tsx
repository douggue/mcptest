import { ArrowLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  readonly title: ReactNode;
  /** One short line under the title; never a paragraph. */
  readonly lead?: ReactNode;
  readonly icon?: LucideIcon;
  /** A few words beside the title, such as a count. */
  readonly count?: ReactNode;
  /** The view's one primary action, at the right; quiet ones may sit beside it. */
  readonly actions?: ReactNode;
  /** A way back, shown as an arrow before the title. */
  readonly back?: { readonly href: string; readonly label: string };
  /** A picture before the title, such as a channel's logo. */
  readonly media?: ReactNode;
  readonly titleId?: string;
}

/**
 * The top of a view: an optional way back, the title with one short line
 * under it, and the primary action at the right. Wraps under the title on a
 * phone.
 */
export function ViewHeader(props: Props) {
  const { title, lead, icon: Icon, count, actions, back, media, titleId } = props;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-space-md gap-y-space-sm">
      {back && (
        <a
          href={back.href}
          aria-label={back.label}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-card hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container"
        >
          <ArrowLeft aria-hidden="true" className="h-5 w-5" />
        </a>
      )}
      {media}
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <h2
          id={titleId}
          className="flex min-w-0 flex-wrap items-center gap-2 text-headline-lg font-bold tracking-tight text-on-surface"
        >
          {Icon && (
            <Icon aria-hidden="true" className="h-[22px] w-[22px] flex-none text-metric-amber" />
          )}
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
