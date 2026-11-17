import { clone, validateProject } from "./model";
import type { ChromaKey, MediaAsset, Project } from "./types";

/** What the processing job hands back: a still with real transparency, or a video whose
 * background has been painted one flat colour for the clip's chroma key to remove. */
export interface BackgroundRemovalResult {
  asset: MediaAsset;
  chromaKey?: ChromaKey;
}

/** Shared preflight on both sides of IPC. */
export function backgroundRemovalPlan(p: Project, clipId: string) {
  const clip = p.clips.find((c) => c.id === clipId), asset = p.assets.find((a) => a.id === clip?.assetId);
  if (!clip || !asset || asset.missing || (asset.kind !== "video" && asset.kind !== "image"))
    throw new Error("请选择视频或图片片段");
  if (p.tracks.find((t) => t.id === clip.trackId)?.locked) throw new Error("请先解锁关联轨道");
  if (asset.kind === "video" && clip.duration * clip.speed > 600) throw new Error("单次去除背景最多处理 10 分钟的源素材，请先分割片段");
  return { clip, asset };
}

/** Keying settings for a backdrop of `color` when the subject's nearest colours sit `nearest`
 * away from it (0–1, the same distance the chroma key uses). The band stays clear of the subject. */
export function backdropKey(color: string, nearest: number): ChromaKey {
  const room = Math.max(0.06, Math.min(1, nearest));
  return { enabled: true, color, similarity: Number(Math.min(0.22, room * 0.45).toFixed(3)), blend: Number(Math.min(0.18, room * 0.4).toFixed(3)) };
}

export function applyBackgroundRemoval(p: Project, clipId: string, result: BackgroundRemovalResult): { project: Project; clipId: string } {
  const plan = backgroundRemovalPlan(p, clipId);
  if (result.asset.kind !== plan.asset.kind) throw new Error("衍生素材类型不匹配");
  if (plan.asset.kind === "video" && (!result.chromaKey || result.asset.duration + 0.1 < plan.clip.duration * plan.clip.speed))
    throw new Error("片段超出实际源素材时长");
  const next = clone(p);
  next.assets.push(result.asset);
  next.clips = next.clips.map((c) => c.id !== clipId ? c : plan.asset.kind === "image"
    ? { ...c, assetId: result.asset.id }
    // The processed video holds only the clip's own source range, starting at zero.
    : { ...c, assetId: result.asset.id, sourceIn: 0, chromaKey: clone(result.chromaKey!) });
  return { project: validateProject(next), clipId };
}
