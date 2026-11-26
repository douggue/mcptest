import type { ReactNode } from 'react';

export function Stat({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-label text-outline">{label}</dt>
      <dd className="text-title-md text-on-surface">{children}</dd>
    </div>
  );
}

/** A video or a channel named in a line of text: it opens that video's or channel's page in the app. */
export function Inside({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="rounded transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
    >
      {children}
    </a>
  );
}
