import { clone, createClip, createTrack } from "./model";
import type { MediaAsset, Project } from "./types";

/** Place a recorded narration at `time`. It goes on the existing voice-over track when the span
 * is free there, otherwise on a new one, so a retake never lands on top of an earlier take. */
export function addRecording(
  input: Project,
  asset: MediaAsset,
  time: number,
  trackName: string,
): { project: Project; clipId: string } {
  if (asset.kind !== "audio" || !(asset.duration > 0)) throw new Error("录音无效");
  if (!Number.isFinite(time) || time < 0) throw new Error("无效播放位置");
  const project = clone(input);
  const free = (trackId: string) =>
    !project.clips.some((clip) => clip.trackId === trackId && clip.start < time + asset.duration && clip.start + clip.duration > time);
  let track = project.tracks.find((item) => item.kind === "audio" && item.name === trackName && !item.locked && free(item.id));
  if (!track) {
    track = createTrack("audio", trackName);
    project.tracks.push(track);
  }
  const clip = createClip(asset, track.id, time, project.fps);
  clip.name = asset.name;
  if (!project.assets.some((item) => item.id === asset.id)) project.assets.push(asset);
  project.clips.push(clip);
  return { project, clipId: clip.id };
}
