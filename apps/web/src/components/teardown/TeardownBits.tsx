import type { ReactNode } from 'react';
import { imageUrl } from '../../lib/teardown';
import { Notice } from '../layout/Notice';

/** A plain table that scrolls inside itself on a narrow screen, never the page. */
export function DataTable({
  head,
  rows,
  label,
}: {
  readonly head: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
  readonly label: string;
}) {
  if (rows.length === 0)
    return <p className="text-body-sm text-on-surface-variant">Nothing to show.</p>;
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded border border-border-subtle">
      <table
        className="w-full min-w-[32rem] border-collapse text-left text-body-sm"
        aria-label={label}
      >
        <thead>
          <tr className="bg-surface-container-high text-on-surface">
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              className="border-t border-border-subtle align-top text-on-surface-variant"
            >
              {row.map((cell, column) => (
                <td key={column} className="px-3 py-2 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One teardown picture from the local store, with its caption. */
export function TeardownImage({
  videoId,
  name,
  caption,
}: {
  readonly videoId: string;
  readonly name: string;
  readonly caption: string;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <img
        src={imageUrl(videoId, name)}
        alt={caption}
        loading="lazy"
        className="w-full rounded border border-border-subtle bg-black"
      />
      <figcaption className="text-body-sm text-outline">{caption}</figcaption>
    </figure>
  );
}

/** A section of the teardown: numbered heading, who judged it, and why it is missing when it is. */
export function TeardownSection({
  id,
  title,
  note,
  problem,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly note?: string | null;
  readonly problem?: string | null;
  readonly children?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-space-sm">
      <h4 id={id} className="text-headline-md font-bold text-on-surface">
        {title}
      </h4>
      {note ? <p className="text-body-sm text-outline">{note}</p> : null}
      {problem ? <Notice tone="problem">{`Not made: ${problem}`}</Notice> : null}
      {children}
    </section>
  );
}

/** A small heading inside a section. */
export const SubHeading = ({ children }: { readonly children: ReactNode }) => (
  <h5 className="text-title-md font-semibold text-on-surface">{children}</h5>
);

/** A list of plain points. */
export function Points({ items }: { readonly items: readonly ReactNode[] }) {
  if (items.length === 0)
    return <p className="text-body-sm text-on-surface-variant">None named.</p>;
  return (
    <ul className="flex min-w-0 list-disc flex-col gap-1 pl-5 text-body-md text-on-surface-variant">
      {items.map((item, index) => (
        <li key={index} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}
