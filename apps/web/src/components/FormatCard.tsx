import type { TransferFormat } from '@jgtube/core';
import { formatCount, watchUrl } from '../lib/format';
import { describeFormat } from '../lib/transfers';
import { Card } from './layout/Card';
import { Outbound, Stat } from './NicheCard';
import { Template } from './TransferCard';

/** Places named on a card; a format made for many places lists the leading ones. */
const PLACES_ON_CARD = 6;

function Numbers({ format }: { readonly format: TransferFormat }) {
  return (
    <dl className="grid grid-cols-2 gap-2 rounded-lg bg-space-deep p-space-sm sm:grid-cols-4">
      <Stat label="Subjects">{format.subjectCount}</Stat>
      <Stat label="Channels">{format.channelCount}</Stat>
      <Stat label="Best video">
        <span className="text-primary">{formatCount(format.bestViews)}</span>
      </Stat>
      <Stat label="Typical video">
        <span className="text-secondary">{formatCount(Math.round(format.medianViews))}</span>
      </Stat>
    </dl>
  );
}

/** The places a format was made for, the leading ones by name. */
function madeFor(format: TransferFormat): string | null {
  if (format.places.length === 0) return null;
  const named = format.places
    .slice(0, PLACES_ON_CARD)
    .map((place) => `${place.name} (${place.versions})`);
  const more = format.places.length - named.length;
  return `Made for ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** One title format used for several subjects: how widely, how well, and for what. */
export function FormatCard({ format }: { readonly format: TransferFormat }) {
  const places = madeFor(format);
  return (
    <Card as="article">
      <div className="flex flex-col gap-space-sm">
        <h3 className="min-w-0 text-title-md text-on-surface">
          <Template template={format.template} />
        </h3>
        <span className="text-label text-outline">{describeFormat(format)}</span>
      </div>
      <Numbers format={format} />
      <div className="flex flex-col gap-space-sm">
        <span className="text-label text-outline">Subjects it was used for</span>
        <ul className="flex flex-col gap-space-sm">
          {format.subjects.map((subject) => (
            <li key={subject.subject} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-body-sm text-on-surface" title={subject.title}>
                <Outbound href={watchUrl(subject.videoId)}>
                  <span className="capitalize">{subject.subject}</span>
                </Outbound>
                <span className="text-outline"> · {subject.channelTitle}</span>
              </span>
              <span className="flex-none text-label text-outline">
                {formatCount(subject.bestViews)} views
              </span>
            </li>
          ))}
        </ul>
      </div>
      {places && <p className="text-label text-outline">{places}</p>}
    </Card>
  );
}
