import { Download, Film, FolderDown, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { sendingText } from '../lib/breakdown';
import { thumbnailUrl } from '../lib/format';
import { takeHandedVideo } from '../lib/videoHandoff';
import { createTeardownApi, markdownUrl, runsLine, zipUrl } from '../lib/teardown';
import {
  fileProblem,
  linkProblem,
  routeLine,
  seenLines,
  videoIdFrom,
  writtenText,
  type VideoBreakdownView,
} from '../lib/videoBreakdown';
import { Card } from './layout/Card';
import { Notice } from './layout/Notice';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { FIELD, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import {
  ComponentsSection,
  DesignSection,
  HookSection,
  MetricsSection,
} from './teardown/TeardownLook';
import { MotionSection, PlanSection, SoundSection, StorySection } from './teardown/TeardownMake';
import type { VideoBreakdown } from './useVideoBreakdown';
import type { ViewParts } from './viewParts';

/** What a teardown of the typed video (or of any file) would take, in one line; null while unknown. */
function useRunsLine(videoId: string | null): string | null {
  const api = useMemo(() => createTeardownApi(), []);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api
      .runs(videoId, false)
      .then((runs) => current && setLine(runsLine(runs)))
      .catch(() => current && setLine(null));
    return () => {
      current = false;
    };
  }, [api, videoId]);
  return line;
}

/** The link or the file to break down, and the one button. */
function VideoInput({
  video,
  parts,
}: {
  readonly video: VideoBreakdown;
  readonly parts: ViewParts;
}) {
  const [link, setLink] = useState(takeHandedVideo);
  const [problem, setProblem] = useState<string | null>(null);
  const runs = useRunsLine(videoIdFrom(link));
  const { asking, analysis } = parts.work;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const found = linkProblem(link);
    setProblem(found);
    if (found === null) video.fromLink(link, analysis.choice, false);
  };
  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const found = fileProblem(file);
    setProblem(found);
    if (found === null) video.fromFile(file, analysis.choice);
  };
  return (
    <Card>
      <form
        onSubmit={submit}
        className="flex min-w-0 flex-col gap-2"
        aria-label="A YouTube video link"
      >
        <label htmlFor="video-link" className="text-label text-on-surface-variant">
          A YouTube video link
        </label>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <input
            id="video-link"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="youtube.com/watch?v=… or youtu.be/…"
            className={FIELD}
          />
          <button
            type="submit"
            disabled={asking}
            className={`min-h-11 flex-none ${PRIMARY_BUTTON}`}
          >
            Break this video down
          </button>
        </div>
      </form>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
        <span>Or a video file (MP4, WebM or MOV, up to 2 GB):</span>
        <label
          className={`flex min-h-11 cursor-pointer items-center gap-1.5 ${QUIET_BUTTON} ${asking ? 'pointer-events-none opacity-60' : ''}`}
        >
          <Upload aria-hidden="true" className="h-4 w-4" />
          Choose a file
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
            disabled={asking}
            onChange={choose}
            aria-label="Choose a video file to break down"
            className="sr-only"
          />
        </label>
      </div>
      {runs && <p className="text-body-sm text-on-surface-variant">{runs}</p>}
      {problem && (
        <p role="alert" className="text-body-sm text-error">
          {problem}
        </p>
      )}
      {asking && video.run.status === 'idle' && (
        <p className="text-body-sm text-on-surface-variant">
          Another AI run is under way. Start this when it is done.
        </p>
      )}
    </Card>
  );
}

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

const DOWNLOAD_LINK = `flex min-h-11 items-center gap-1.5 ${QUIET_BUTTON}`;

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

/** One kept breakdown: what it is of, how it was seen, the teardown and its downloads. */
function Result({ view }: { readonly view: VideoBreakdownView }) {
  const thumb = view.source === 'youtube' ? thumbnailUrl(view.videoId) : null;
  return (
    <section aria-labelledby="video-result" className="flex min-w-0 flex-col gap-space-lg">
      <div className="flex min-w-0 flex-wrap items-center gap-space-md">
        {thumb && (
          <img src={thumb} alt="" referrerPolicy="no-referrer" className="w-40 flex-none rounded" />
        )}
        <div className="flex min-w-0 flex-1 basis-56 flex-col">
          <p className="text-body-sm text-outline">Production teardown and style bible</p>
          <h3 id="video-result" className="break-words text-headline-md font-bold text-on-surface">
            {view.title}
          </h3>
          <p className="text-body-sm text-outline">
            {view.source === 'file' ? 'A file you gave' : 'YouTube video'} · taken apart{' '}
            {writtenText(view.writtenAt)}
          </p>
        </div>
        {view.teardown && (
          <div className="flex flex-wrap gap-2">
            <a href={markdownUrl(view.videoId)} download className={DOWNLOAD_LINK}>
              <Download aria-hidden="true" className="h-4 w-4" />
              Download .md
            </a>
            <a href={zipUrl(view.videoId)} download className={DOWNLOAD_LINK}>
              <FolderDown aria-hidden="true" className="h-4 w-4" />
              Download folder (.zip)
            </a>
          </div>
        )}
      </div>
      <HowSeen view={view} />
      <Teardown view={view} />
    </section>
  );
}

/** The kept breakdowns of one video each. */
function Kept({ video }: { readonly video: VideoBreakdown }) {
  if (!video.kept || video.kept.length === 0) return null;
  return (
    <section aria-labelledby="video-kept" className="flex min-w-0 flex-col gap-space-sm">
      <h3 id="video-kept" className="text-headline-md font-bold text-on-surface">
        Your video breakdowns
      </h3>
      <ul className="flex min-w-0 flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-card px-space-md">
        {video.kept.map((item) => (
          <li key={item.videoId} className="flex min-w-0 items-center gap-space-sm py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-md text-on-surface">{item.title}</span>
              <span className="text-body-sm text-outline">
                {item.source === 'file' ? 'File' : 'YouTube'} · {writtenText(item.writtenAt)}
                {item.written ? '' : ' · could not be written'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => video.openVideo(item.videoId)}
              className="min-h-11 flex-none rounded-full px-3 text-body-sm font-semibold text-primary hover:bg-surface-container-high"
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Breakdown's One video tab: a link or a file in, a deep breakdown out, kept per video. */
export function VideoBreakdownTab({ parts }: { readonly parts: ViewParts }) {
  const video = parts.work.videoBreakdown;
  const { run } = video;
  return (
    <ViewPage id="video-breakdown" labelledBy="video-breakdown-title">
      <ViewHeader
        titleId="video-breakdown-title"
        icon={Film}
        title="Break down one video"
        lead="How it is made, and how to make one like it with AI."
      />
      <VideoInput video={video} parts={parts} />
      {run.status === 'sending' && (
        <Notice tone="working">{`${run.name}: ${sendingText(run.fraction)}`}</Notice>
      )}
      {run.status === 'running' && (
        <Notice tone="working">{`${run.label}. ${run.step ?? 'Starting'}. This takes several minutes; you can leave this page.`}</Notice>
      )}
      {run.status === 'failed' && (
        <Notice tone="problem">{`It did not finish: ${run.message}`}</Notice>
      )}
      {video.open && (
        <Result key={`${video.open.videoId}${video.open.writtenAt}`} view={video.open} />
      )}
      <Kept video={video} />
    </ViewPage>
  );
}
