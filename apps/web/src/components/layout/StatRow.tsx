import type { ReactNode } from 'react';
import type { Tile } from '../../lib/tiles';
import { StatTile } from './StatTile';

const COLUMNS = {
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 xl:grid-cols-4',
} as const;

/** Without a column count, tiles share the width and wrap before they grow too narrow to read. */
const FLUID = 'grid-cols-[repeat(auto-fit,minmax(6.25rem,1fr))]';

/**
 * A few stat tiles that share the width of a card or main area evenly, for
 * three or four numbers (`StatGrid` is for six). Two to a row on a phone when
 * a column count is given.
 */
export function StatRow({
  children,
  columns,
}: {
  readonly children: ReactNode;
  readonly columns?: keyof typeof COLUMNS;
}) {
  const layout = columns === undefined ? FLUID : COLUMNS[columns];
  return <dl className={`grid min-w-0 gap-2 ${layout}`}>{children}</dl>;
}

/** A row of tiles worked out from stored data, three or four of them. */
export function TileRow({ tiles }: { readonly tiles: readonly Tile[] }) {
  return (
    <StatRow columns={tiles.length > 3 ? 4 : 3}>
      {tiles.map((tile) => (
        <StatTile key={tile.label} label={tile.label} value={tile.value} note={tile.note} />
      ))}
    </StatRow>
  );
}
