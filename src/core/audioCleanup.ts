import { clone, validateProject } from "./model";
import type { MediaAsset, Project } from "./types";

export interface AudioCleanupRequest {
  /** Reduce steady background noise such as hiss, hum and fan noise. */
  denoise: boolean;
  /** Bring the overall loudness to a consistent level. */
  normalize: boolean;
}

/** Shared preflight on both sides of IPC. The clip keeps its timing; only its source file changes. */
export function audioCleanupPlan(p: Project, clipId: string, r: AudioCleanupRequest) {
  if (!r || typeof r.denoise !== "boolean" || typeof r.normalize !== "boolean" || (!r.denoise && !r.normalize))
    throw new Error("请至少选择一项音频处理");
  const clip = p.clips.find((c) => c.id === clipId), asset = p.assets.find((a) => a.id === clip?.assetId);
  if (!clip || !asset || asset.missing || !(asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio)))
    throw new Error("请选择带声音的片段");
  if (p.tracks.find((t) => t.id === clip.trackId)?.locked) throw new Error("请先解锁关联轨道");
  return { clip, asset };
}

export function applyAudioCleanup(p: Project, clipId: string, r: AudioCleanupRequest, cleaned: MediaAsset): { project: Project; clipId: string } {
  const plan = audioCleanupPlan(p, clipId, r);
  if (cleaned.kind !== plan.asset.kind) throw new Error("衍生素材类型不匹配");
  if (plan.clip.sourceIn + plan.clip.duration * plan.clip.speed > cleaned.duration + 0.1) throw new Error("片段超出实际源素材时长");
  const next = clone(p);
  next.assets.push(cleaned);
  next.clips = next.clips.map((c) => (c.id === clipId ? { ...c, assetId: cleaned.id } : c));
  return { project: validateProject(next), clipId };
}
