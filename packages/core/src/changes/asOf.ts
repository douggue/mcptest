import type { StoredVideo, VideoReading } from '../repos/types';

/**
 * A channel's videos as the store knew them at an earlier moment.
 *
 * Every read of a channel stores each video's view count (`video_snapshots`),
 * so the store can say what it held at any time after its first read: each
 * video with the views of its latest reading at or before that moment. A
 * video with no reading by then was not stored then. Titles and lengths are
 * kept in place, so they are the latest ones.
 */
export function videosAsOf(
  videos: readonly StoredVideo[],
  readings: readonly VideoReading[],
  at: Date,
): readonly StoredVideo[] {
  const limit = at.getTime();
  const latest = new Map<string, VideoReading>();
  for (const reading of readings) {
    const taken = reading.capturedAt.getTime();
    if (taken > limit) continue;
    const known = latest.get(reading.videoId);
    if (!known || known.capturedAt.getTime() <= taken) latest.set(reading.videoId, reading);
  }
  return videos.flatMap((video) => {
    const reading = latest.get(video.id);
    return reading ? [{ ...video, views: reading.views }] : [];
  });
}

/** Whether any of a channel's videos had been read at or before the moment. */
export function hadReadingBy(readings: readonly VideoReading[], at: Date): boolean {
  const limit = at.getTime();
  return readings.some((reading) => reading.capturedAt.getTime() <= limit);
}
