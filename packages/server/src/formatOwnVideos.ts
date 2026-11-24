/**
 * The owner's own videos as "Your videos against the plan" reads them: the
 * channel's stored videos, newest first, each with its outlier score and,
 * when a teardown measured it, its cuts and words a minute and its palette.
 * Everything here is read from the store; nothing is fetched or judged.
 */
import {
  buildVideoReport,
  type OwnVideoInput,
  type StoredVideo,
  type TeardownReport,
} from '@jgtube/core';

/** The most of the newest videos counted against the plan. */
export const MAX_OWN_VIDEOS = 50;

export interface OwnVideoDeps {
  readonly now: () => Date;
  listByChannel(channelId: string): readonly StoredVideo[];
  teardownReport(videoId: string): TeardownReport | null;
}

function measuredOf(report: TeardownReport | null): OwnVideoInput['measured'] {
  const measured = report?.measured;
  if (!report || !measured) return null;
  return {
    cutsPerMinute: measured.shots.cutsPerMinute,
    wordsPerMinute: report.transcript.words?.wordsPerMinute ?? null,
    palette: [...measured.palette.items].sort((a, b) => b.share - a.share).map((item) => item.hex),
  };
}

export function ownVideosOf(deps: OwnVideoDeps): (channel: string) => readonly OwnVideoInput[] {
  return (channel) => {
    const videos = deps.listByChannel(channel);
    const scores = new Map(buildVideoReport(videos, deps.now()).map((row) => [row.id, row.score]));
    return [...videos]
      .sort((a, b) => b.published.date.getTime() - a.published.date.getTime())
      .slice(0, MAX_OWN_VIDEOS)
      .map((video) => ({
        videoId: video.id,
        title: video.title,
        score: scores.get(video.id) ?? null,
        measured: measuredOf(deps.teardownReport(video.id)),
      }));
  };
}
