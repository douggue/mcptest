import type { ExportOptions, Project } from "./types";

export type ExportPresetId = "youtube" | "vertical" | "feed";
export interface ExportPreset {
  id: ExportPresetId;
  /** Canvas shapes the destination shows without bars, as width:height ratios. */
  shapes: [number, number][];
  fps: number | "project";
  quality: ExportOptions["quality"];
}
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "youtube", shapes: [[16, 9]], fps: "project", quality: "high" },
  { id: "vertical", shapes: [[9, 16]], fps: 30, quality: "standard" },
  { id: "feed", shapes: [[1, 1], [4, 5]], fps: 30, quality: "standard" },
];

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Export settings for a destination. The picture keeps the project's own shape: the short
 * side becomes 1080 pixels, and `fits` says whether that shape is one the destination expects. */
export function exportPresetOptions(
  project: Pick<Project, "width" | "height" | "fps">,
  id: ExportPresetId,
): Pick<ExportOptions, "width" | "height" | "fps" | "quality" | "format"> & { fits: boolean } {
  const preset = EXPORT_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error("Unknown export preset");
  const scale = 1080 / Math.min(project.width, project.height);
  const ratio = project.width / project.height;
  return {
    width: even(project.width * scale),
    height: even(project.height * scale),
    fps: preset.fps === "project" ? Math.min(60, project.fps) : preset.fps,
    quality: preset.quality,
    format: "mp4",
    fits: preset.shapes.some(([width, height]) => Math.abs(ratio - width / height) < 0.01),
  };
}
