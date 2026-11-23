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

/** A link to YouTube when the id is well formed, plain text otherwise. */
export function Outbound({
  href,
  children,
}: {
  readonly href: string | null;
  readonly children: ReactNode;
}) {
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="transition-colors hover:text-primary"
    >
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}
