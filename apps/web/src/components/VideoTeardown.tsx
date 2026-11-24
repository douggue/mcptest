import { Download, FolderDown } from 'lucide-react';
import { markdownUrl, zipUrl } from '../lib/teardown';
import { routeLine, seenLines, type VideoBreakdownView } from '../lib/videoBreakdown';
import { Card } from './layout/Card';
import { Notice } from './layout/Notice';
import {
  ComponentsSection,
  DesignSection,
  HookSection,
  MetricsSection,
} from './teardown/TeardownLook';
import { MotionSection, PlanSection, SoundSection, StorySection } from './teardown/TeardownMake';
import { buttonClass } from './ui/Button';

/** How the video was seen: the route, and what could and could not be seen. */
function HowSeen({ view }: { readonly view: VideoBreakdownView }) {
  const { could, couldNot } = seenLines(view.seen);
  return (
    <Card label="How it was seen">
      <p className="text-body-md text-on-surface">{routeLine(view.seen)}</p>
      <div className="grid min-w-0 gap-space-md sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label text-primary">It could see</span>
          {could.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Nothing but its captions.</p>
          ) : null}
          {could.map((line) => (
            <p key={line} className="text-body-sm text-on-surface-variant">
              {line}
            </p>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-label text-outline">It could not</span>
          {couldNot.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Nothing missing.</p>
          ) : null}
          {couldNot.map((line) => (
            <p key={line} className="break-words text-body-sm text-on-surface-variant">
              {line}
            </p>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** The production teardown, section by section, like a style bible. */
function Teardown({ view }: { readonly view: VideoBreakdownView }) {
  const teardown = view.teardown;
  if (teardown === null) {
    return (
      <Notice tone="note">
        {view.problem
          ? `It could not be made: ${view.problem}`
          : 'This breakdown was made before teardowns. Break the video down again for the full teardown.'}
      </Notice>
    );
  }
  const parts = { view: teardown, videoId: view.videoId, title: view.title };
  return (
    <div className="flex min-w-0 flex-col gap-space-xl">
      <MetricsSection view={teardown} />
      <DesignSection view={teardown} />
      <ComponentsSection {...parts} />
      <HookSection {...parts} />
      <StorySection view={teardown} />
      <MotionSection {...parts} />
      <SoundSection view={teardown} />
      <PlanSection {...parts} />
    </div>
  );
}

/** The teardown's two downloads: the write-up alone, or the folder with its pictures. */
export function TeardownDownloads({ videoId }: { readonly videoId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={markdownUrl(videoId)} download className={buttonClass('second', true)}>
        <Download aria-hidden="true" className="h-4 w-4" />
        Download .md
      </a>
      <a href={zipUrl(videoId)} download className={buttonClass('second', true)}>
        <FolderDown aria-hidden="true" className="h-4 w-4" />
        Download folder (.zip)
      </a>
    </div>
  );
}

/** One video taken apart: how it was seen, then the teardown, section by section. */
export function TeardownResult({ view }: { readonly view: VideoBreakdownView }) {
  return (
    <div className="flex min-w-0 flex-col gap-space-lg">
      <HowSeen view={view} />
      <Teardown view={view} />
    </div>
  );
}
