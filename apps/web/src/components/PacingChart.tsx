import type { Spread } from '@jgtube/core';
import { chartRows, restsOn, spreadText, type Measure } from '../lib/pacing';

const ROW_HEIGHT = 28;
const BAR_Y = 12;
const BAR_HEIGHT = 12;

interface Props {
  readonly title: string;
  readonly measure: Measure;
  readonly rows: readonly { readonly label: string; readonly spread: Spread }[];
}

/**
 * Each row's middle half as a bar and its median as a mark, on one scale
 * from zero, with the numbers written beside each row.
 */
export function PacingChart({ title, measure, rows }: Props) {
  const placed = chartRows(rows);
  return (
    <figure className="flex min-w-0 flex-col gap-space-md rounded-lg border border-border-subtle bg-surface-card p-space-md sm:p-space-lg">
      <figcaption className="text-label-caps uppercase text-outline">{title}</figcaption>
      {placed.map((row, index) => {
        const spread = rows[index]?.spread;
        return (
          <div key={row.label} className="flex min-w-0 flex-col gap-0.5">
            <p className="text-body-sm text-on-surface">
              <span className="font-semibold">{row.label}:</span>{' '}
              {spread ? spreadText(spread, measure) : ''}{' '}
              <span className="text-outline">({spread ? restsOn(spread, measure) : ''})</span>
            </p>
            <svg
              width="100%"
              height={ROW_HEIGHT}
              role="img"
              aria-label={`${row.label}: ${spread ? spreadText(spread, measure) : ''}`}
            >
              <rect
                x="0"
                y={BAR_Y + BAR_HEIGHT / 2 - 0.5}
                width="100%"
                height="1"
                className="fill-surface-container-high"
              />
              {row.from !== null && row.to !== null && (
                <rect
                  x={`${row.from}%`}
                  y={BAR_Y}
                  width={`${Math.max(0.5, row.to - row.from)}%`}
                  height={BAR_HEIGHT}
                  rx="3"
                  className="fill-primary-container opacity-60"
                />
              )}
              {row.at !== null && (
                <rect
                  x={`${row.at}%`}
                  y={BAR_Y - 4}
                  width="3"
                  height={BAR_HEIGHT + 8}
                  rx="1"
                  className="fill-metric-amber"
                />
              )}
            </svg>
          </div>
        );
      })}
      <p className="text-body-sm text-outline">
        Bar: the middle half of the videos. Mark: the median. One scale from zero for both rows.
      </p>
    </figure>
  );
}
