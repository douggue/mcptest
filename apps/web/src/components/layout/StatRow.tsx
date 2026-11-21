import type { ReactNode } from 'react';
import type { Tile } from '../../lib/tiles';
import { StatTile } from './StatTile';

const COLUMNS = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
} as const;

/**
 * A few stat tiles that share the width of the main area evenly, for a view
 * with three or four numbers (`StatGrid` is for six). Two to a row on a phone.
 */
export function StatRow({
  children,
  columns,
}: {
  readonly children: ReactNode;
  readonly columns: keyof typeof COLUMNS;
}) {
  return <dl className={`grid min-w-0 grid-cols-2 gap-2 ${COLUMNS[columns]}`}>{children}</dl>;
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
