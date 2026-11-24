import type { ViewId } from '../lib/routes';
import { viewHref } from '../lib/routes';
import { BiblePanel } from './BiblePanel';
import { BreakdownChannelTab } from './BreakdownChannelTab';
import { ChannelCompetitors } from './ChannelCompetitors';
import { FormatPicker } from './FormatPicker';
import { Notice } from './layout/Notice';
import { ViewPage } from './layout/SplitView';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { EmptyState } from './ui/States';
import { useFormatBuilder } from './useFormatBuilder';
import { useShelf } from './useShelf';
import { aiOf, withMap, type ViewDraw, type ViewParts } from './viewParts';

/**
 * The Format Bible on its own: the format chosen, and its bible written
 * from the slots filled in My format.
 */
function Bible({ page, work }: ViewParts) {
  const channelId = page.snapshot?.center.id ?? null;
  const shelf = useShelf();
  const items = shelf.state.status === 'ready' ? shelf.state.items : [];
  const builder = useFormatBuilder(items.map((item) => item.id).join(','), channelId);
  const { chosen } = builder;
  return (
    <ViewPage id="format-bible">
      <div className="flex w-full max-w-3xl min-w-0 flex-col gap-space-lg">
        {builder.state.status === 'loading' && (
          <Notice tone="working">Reading your formats…</Notice>
        )}
        {builder.state.status === 'failed' && (
          <Notice tone="problem">{builder.state.message}</Notice>
        )}
        {builder.state.status === 'ready' && chosen === null && (
          <EmptyState
            title="No format to write a Bible from yet"
            line="Name a format and fill a few of its slots first."
            action={
              <Button kind="main" href={viewHref('format')}>
                Open My format
              </Button>
            }
          />
        )}
        {chosen !== null && (
          <Card>
            <div className="flex min-w-0 flex-col gap-space-md">
              <FormatPicker builder={builder} />
              <BiblePanel format={chosen} builder={builder} channelId={channelId} ai={aiOf(work)} />
            </div>
          </Card>
        )}
        {builder.problem && <Notice tone="problem">{builder.problem}</Notice>}
      </div>
    </ViewPage>
  );
}

/**
 * The screens the five places add around the older ones: the competitors
 * as a list of their own, the owner's own channel breakdown, and the Format
 * Bible as its own tab of Style.
 */
export const MY_CHANNEL_VIEWS: Partial<Record<ViewId, ViewDraw>> = {
  competitors: withMap('competitors', (snapshot, { page }) => (
    <ViewPage id="competitors">
      <div className="w-full max-w-3xl min-w-0">
        <ChannelCompetitors snapshot={snapshot} page={page} title="My competitors" />
      </div>
    </ViewPage>
  )),
  'own-breakdown': withMap('own-breakdown', (snapshot, parts) => (
    <ViewPage>
      <BreakdownChannelTab parts={parts} channelId={snapshot.center.id} embedded />
    </ViewPage>
  )),
  bible: (parts) => <Bible {...parts} />,
};
