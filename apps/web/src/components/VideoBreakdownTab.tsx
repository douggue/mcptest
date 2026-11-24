import { Film, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { sendingText } from '../lib/breakdown';
import { thumbnailUrl } from '../lib/format';
import { videoHref } from '../lib/routes';
import { fileProblem, writtenText, type VideoBreakdownSummary } from '../lib/videoBreakdown';
import { Notice } from './layout/Notice';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { buttonClass } from './ui/Button';
import { Card } from './ui/Card';
import { Row } from './ui/Row';
import { EmptyState } from './ui/States';
import { useRunsLine } from './useRunsLine';
import type { VideoBreakdown } from './useVideoBreakdown';
import type { ViewParts } from './viewParts';

/** A video file of the owner's own, taken apart like any other video. */
function AddFile({ video, parts }: { readonly video: VideoBreakdown; readonly parts: ViewParts }) {
  const [problem, setProblem] = useState<string | null>(null);
  const runs = useRunsLine(null);
  const { asking, analysis } = parts.work;
  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const found = fileProblem(file);
    setProblem(found);
    if (found === null) video.fromFile(file, analysis.choice);
  };
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <label
        className={`cursor-pointer ${buttonClass('second')} ${asking ? 'pointer-events-none opacity-50' : ''}`}
      >
        <Upload aria-hidden="true" className="h-[18px] w-[18px]" />
        Add a video file
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
          disabled={asking}
          onChange={choose}
          aria-label="Choose a video file to break down"
          className="sr-only"
        />
      </label>
      {asking && video.run.status === 'idle' && (
        <p className="text-body-sm text-muted">Waits for the AI run under way to finish.</p>
      )}
      {runs && <p className="text-body-sm text-muted">{runs}</p>}
      {problem && (
        <p role="alert" className="text-body-sm text-bad">
          {problem}
        </p>
      )}
    </div>
  );
}

function Thumb({ item }: { readonly item: VideoBreakdownSummary }) {
  const picture = item.source === 'youtube' ? thumbnailUrl(item.videoId) : null;
  return (
    <span className="grid h-10 w-[71px] flex-none place-items-center overflow-hidden rounded-md border border-white/10 bg-card-2 text-dim">
      {picture ? (
        <img
          src={picture}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <Film aria-hidden="true" className="h-5 w-5" />
      )}
    </span>
  );
}

/** The videos taken apart so far, newest first; each opens its own page. */
function Studied({ items }: { readonly items: readonly VideoBreakdownSummary[] }) {
  return (
    <Card>
      <ul className="flex min-w-0 flex-col">
        {items.map((item) => (
          <Row
            key={item.videoId}
            as="li"
            href={videoHref(item.videoId, 'teardown')}
            media={<Thumb item={item} />}
            title={item.title}
            meta={`${item.source === 'file' ? 'A file you gave' : 'YouTube'} · taken apart ${writtenText(item.writtenAt)}${item.written ? '' : ' · could not be written'}`}
          />
        ))}
      </ul>
    </Card>
  );
}

/**
 * Studied videos: every video taken apart so far, each a link to its own
 * page, and the way to add a video file of your own. A YouTube video is
 * opened from Search or from any card, and taken apart on its page.
 */
export function VideoBreakdownTab({ parts }: { readonly parts: ViewParts }) {
  const video = parts.work.videoBreakdown;
  const { run, kept } = video;
  return (
    <ViewPage id="video-breakdown" labelledBy="video-breakdown-title">
      <ViewHeader
        titleId="video-breakdown-title"
        title="Studied videos"
        count={kept && kept.length > 0 ? kept.length : undefined}
        lead="Videos you have taken apart. Paste a YouTube link in Search to study another."
        actions={<AddFile video={video} parts={parts} />}
      />
      {run.status === 'sending' && (
        <Notice tone="working">{`${run.name}: ${sendingText(run.fraction)}`}</Notice>
      )}
      {run.status === 'running' && (
        <Notice tone="working">{`${run.label}. ${run.step ?? 'Starting'}. This takes several minutes; you can leave this page.`}</Notice>
      )}
      {run.status === 'failed' && (
        <Notice tone="problem">{`It did not finish: ${run.message}`}</Notice>
      )}
      {kept === null && <Notice tone="working">Reading the videos you have studied.</Notice>}
      {kept !== null && kept.length === 0 && (
        <EmptyState
          icon={Film}
          title="No video studied yet"
          line="Open any video and press Break this video down, or paste a YouTube link in Search."
        />
      )}
      {kept !== null && kept.length > 0 && <Studied items={kept} />}
    </ViewPage>
  );
}
