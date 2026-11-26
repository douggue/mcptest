import { BANK_SORTS, NO_BANK_FILTERS, type BankSort } from '@jgtube/core/src/bank/query';
import { videoHref } from '../../lib/routes';
import { gridBankVideo } from '../../lib/videoViews';
import { Notice, ShowMore } from '../layout/Notice';
import { Segmented } from '../layout/Segmented';
import { EmptyState, Skeleton } from '../ui/States';
import { VideoCard } from '../ui/VideoCard';
import { useBank } from '../useBank';

/** A channel's videos open newest first: the order its own page on YouTube has. */
const FIRST_SORT: BankSort = 'newest';

/**
 * Every stored video of one channel, a page at a time, in the order chosen:
 * newest, highest score, most views or most views a day. Each opens the
 * video's own page.
 */
export function ChannelVideos({ channelId }: { readonly channelId: string }) {
  const model = useBank({ initial: { ...NO_BANK_FILTERS, sort: FIRST_SORT }, channelId });
  const { page, videos } = model;
  const left = page ? page.matched - videos.length : 0;
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Segmented<BankSort>
          label="Order the videos"
          options={BANK_SORTS.map((sort) => ({ value: sort.id, label: sort.label }))}
          value={model.state.sort}
          onChange={(sort) => model.update((state) => ({ ...state, sort }))}
        />
        <p aria-live="polite" className="text-body-sm text-dim">
          {page
            ? `Showing ${videos.length.toLocaleString('en')} of ${page.total.toLocaleString('en')} stored videos`
            : 'Reading its stored videos…'}
        </p>
      </div>
      {model.problem && <Notice tone="problem">{model.problem}</Notice>}
      {page === null && !model.problem && (
        <div role="status" aria-label="Reading its stored videos" className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full max-w-md" />
          <Skeleton className="h-5 w-64" />
        </div>
      )}
      {page && page.total === 0 && <EmptyState title="No videos of this channel are stored" />}
      <ol className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((video) => {
          const card = gridBankVideo(video);
          return (
            <li key={video.videoId} className="min-w-0">
              <VideoCard
                videoId={card.videoId}
                href={videoHref(card.videoId)}
                title={card.title}
                score={card.score}
                durationSeconds={card.durationSeconds}
                meta={card.meta}
              />
            </li>
          );
        })}
      </ol>
      {left > 0 && <ShowMore left={left} noun="videos" onClick={model.more} />}
    </div>
  );
}
