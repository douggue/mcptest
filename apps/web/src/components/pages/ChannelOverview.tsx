import type { ChannelProfile } from '@jgtube/core';
import { ArrowRight } from 'lucide-react';
import { brokenDownText } from '../../lib/breakdownPicks';
import { pageVideos } from '../../lib/channelPage';
import { profileTiles } from '../../lib/channelView';
import { formatCount } from '../../lib/format';
import { channelHref, viewHref } from '../../lib/routes';
import { ChannelCompetitors } from '../ChannelCompetitors';
import { Inspector } from '../Inspector';
import { MoneyCheck } from '../MoneyCheck';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Row } from '../ui/Row';
import { Stat, Stats } from '../ui/Stat';
import { useBrokenDown } from '../useBrokenDown';
import { messageOf } from '../useMapPage';
import { useMoney } from '../useMoney';
import type { ViewParts } from '../viewParts';
import { VideoGrid } from './ChannelParts';

/** How many outliers the Overview shows before the Videos tab holds the rest. */
const OUTLIERS_SHOWN = 4;

/** The channel's stored numbers, each with what it rests on. */
function Numbers({ profile }: { readonly profile: ChannelProfile }) {
  return (
    <Stats columns={6}>
      {profileTiles(profile).map((tile) => (
        <Stat
          key={tile.label}
          label={tile.label}
          value={tile.value}
          note={tile.note}
          score={tile.label === 'Outliers'}
        />
      ))}
    </Stats>
  );
}

/** Whether the channel has been broken down, and the way to its Breakdown. */
function WhyItWorks({ profile, own }: { readonly profile: ChannelProfile; readonly own: boolean }) {
  const brokenDown = useBrokenDown([profile.id]).get(profile.id) ?? null;
  const href = own ? viewHref('own-breakdown') : channelHref(profile.id, 'breakdown');
  return (
    <Card
      title="Why it works"
      aside={brokenDown ? <Badge tone="proven">{brokenDownText(brokenDown)}</Badge> : undefined}
    >
      <Row
        wrap
        title={brokenDown ? 'Its breakdown is kept' : 'Not broken down yet'}
        meta={
          brokenDown
            ? 'Titles, thumbnails, scripts and a master prompt, read by the AI from its videos.'
            : 'A breakdown reads its titles, thumbnails and scripts. It takes several minutes.'
        }
        right={
          <Button small href={href} iconAfter={ArrowRight}>
            {brokenDown ? 'Read it' : 'Open Breakdown'}
          </Button>
        }
      />
    </Card>
  );
}

/** What the channel's public pages say about whether it earns, and the check that reads them. */
function EarningSigns({ channelId }: { readonly channelId: string }) {
  const verdict = useMoney([channelId]).byId.get(channelId);
  return (
    <Card title="Earning signs" aside={<MoneyCheck channelIds={[channelId]} label="Check" />}>
      {verdict ? (
        <>
          <Row
            wrap
            title={verdict.short}
            meta={
              verdict.sign ??
              'YouTube does not publish who is monetized. The check reads one public watch page for a Join button and ads.'
            }
          />
          <Row wrap title={verdict.bar.says} meta={verdict.bar.note} />
        </>
      ) : (
        <p role="status" className="text-body-md text-muted">
          Reading what is stored.
        </p>
      )}
    </Card>
  );
}

/** Beside the videos: the owner's competitors, or how the channel sits on the owner's map. */
function Beside({
  profile,
  parts,
}: {
  readonly profile: ChannelProfile;
  readonly parts: ViewParts;
}) {
  const { page, work } = parts;
  const { snapshot } = page;
  if (!snapshot) return null;
  if (snapshot.center.id === profile.id) {
    return <ChannelCompetitors snapshot={snapshot} page={page} title="My competitors" />;
  }
  const onMap = snapshot.channels.find((channel) => channel.id === profile.id);
  if (!onMap) return null;
  // The inspector is a panel of its own: it sits under a heading, not inside another card.
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-headline-md text-ink">On the map of {snapshot.center.title}</h2>
      <Inspector
        inline
        channel={onMap}
        busy={work.asking}
        onSetStatus={(status) => {
          page
            .setStatus(onMap.id, status)
            .catch((error: unknown) => page.setMessage(messageOf(error)));
        }}
      />
    </section>
  );
}

interface Props {
  readonly profile: ChannelProfile;
  readonly parts: ViewParts;
  /** The owner's own channel, shown under My channel. */
  readonly own: boolean;
}

/**
 * A channel's Overview: its numbers, its outliers, whether it has been
 * broken down, its earning signs and how it sits on the owner's map.
 */
export function ChannelOverview({ profile, parts, own }: Props) {
  const { outliers } = pageVideos(profile);
  const videosHref = own ? viewHref('own-videos') : channelHref(profile.id, 'videos');
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <Numbers profile={profile} />
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
          <Card
            title="Its outliers"
            aside={
              <a href={videosHref} className="inline-flex items-center gap-1.5 hover:underline">
                All {formatCount(profile.stored.videos)} stored videos
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
            }
          >
            <VideoGrid
              videos={outliers.slice(0, OUTLIERS_SHOWN)}
              first={OUTLIERS_SHOWN}
              columns={2}
              empty={`None of its stored videos is at ${profile.outliers.minScore}× or more of its usual views yet.`}
            />
          </Card>
          <WhyItWorks profile={profile} own={own} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4 sm:gap-6">
          <EarningSigns channelId={profile.id} />
          <Beside profile={profile} parts={parts} />
        </aside>
      </div>
    </div>
  );
}
