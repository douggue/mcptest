import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyBackgroundRemoval, backdropKey, backgroundRemovalPlan } from "../src/core/backgroundRemoval";
import { createClip, createProject } from "../src/core/model";
import type { ExportProgress, MediaAsset, Project } from "../src/core/types";
import { backgroundModelInfo, chooseBackdrop, removeBackground } from "../electron/backgroundRemoval";
import { importAssets, probeFile, runMediaTool } from "../electron/media";
import { startExport } from "../electron/export";

const asset = (kind: MediaAsset["kind"], duration = 4): MediaAsset => ({ id: `${kind}-1`, name: `${kind}.src`, kind, path: `/media/${kind}.src`, url: `file:///media/${kind}.src`, duration, width: 640, height: 360, fps: kind === "video" ? 30 : 0, hasAudio: kind !== "image" });
const projectWith = (source: MediaAsset, patch: Partial<ReturnType<typeof createClip>> = {}): { project: Project; clipId: string } => {
  const project = createProject("Cut-out");
  const clip = { ...createClip(source, project.tracks.find((track) => track.kind === (source.kind === "audio" ? "audio" : "video"))!.id, 0, project.fps), ...patch };
  project.assets.push(source); project.clips.push(clip);
  return { project, clipId: clip.id };
};

describe("background removal edits", () => {
  it("accepts video and image clips on unlocked tracks only", () => {
    expect(() => backgroundRemovalPlan(projectWith(asset("audio")).project, "x")).toThrow("视频或图片");
    const audio = projectWith(asset("audio"));
    expect(() => backgroundRemovalPlan(audio.project, audio.clipId)).toThrow("视频或图片");
    const video = projectWith(asset("video"));
    expect(backgroundRemovalPlan(video.project, video.clipId).asset.kind).toBe("video");
    video.project.tracks.forEach((track) => { track.locked = true; });
    expect(() => backgroundRemovalPlan(video.project, video.clipId)).toThrow("解锁");
    const long = projectWith(asset("video", 900), { duration: 700 });
    expect(() => backgroundRemovalPlan(long.project, long.clipId)).toThrow("10 分钟");
  });
  it("keeps the keying band clear of the subject's colours", () => {
    expect(backdropKey("#00ff00", 0.46)).toEqual({ enabled: true, color: "#00ff00", similarity: 0.207, blend: 0.18 });
    expect(backdropKey("#00ff00", 0.9)).toMatchObject({ similarity: 0.22, blend: 0.18 });
    const tight = backdropKey("#0000ff", 0.2);
    expect(tight.similarity + tight.blend).toBeLessThan(0.2);
    expect(backdropKey("#0000ff", 0).similarity).toBeGreaterThanOrEqual(0.01);
  });
  it("picks the backdrop colour farthest from the subject", () => {
    const pixels = 100, matte = new Uint8Array(pixels).fill(255), paint = (rgb: number[]) => Uint8Array.from({ length: pixels * 3 }, (_, i) => rgb[i % 3]);
    expect(chooseBackdrop(paint([20, 230, 30]), matte).color).not.toBe("#00ff00");
    expect(chooseBackdrop(paint([30, 20, 240]), matte).color).not.toBe("#0000ff");
    expect(chooseBackdrop(paint([240, 20, 230]), matte).color).not.toBe("#ff00ff");
    // Pixels outside the matte are background and do not count.
    expect(chooseBackdrop(paint([20, 230, 30]), new Uint8Array(pixels)).nearest).toBe(1);
  });
  it("swaps a still for its transparent copy, and a video for its keyed copy starting at zero", () => {
    const still = projectWith(asset("image"));
    const cutStill = { ...asset("image"), id: "cut-image" };
    expect(applyBackgroundRemoval(still.project, still.clipId, { asset: cutStill }).project.clips[0]).toMatchObject({ assetId: "cut-image" });
    const video = projectWith(asset("video", 10), { sourceIn: 3, duration: 2 });
    const key = backdropKey("#00ff00", 0.5), cutVideo = { ...asset("video", 2), id: "cut-video" };
    const edited = applyBackgroundRemoval(video.project, video.clipId, { asset: cutVideo, chromaKey: key }).project.clips[0];
    expect(edited).toMatchObject({ assetId: "cut-video", sourceIn: 0, duration: 2, chromaKey: key });
    expect(video.project.clips[0]).toMatchObject({ assetId: "video-1", sourceIn: 3 });
    expect(() => applyBackgroundRemoval(video.project, video.clipId, { asset: cutVideo })).toThrow();
    expect(() => applyBackgroundRemoval(video.project, video.clipId, { asset: { ...cutVideo, duration: 1 }, chromaKey: key })).toThrow("源素材时长");
    expect(() => applyBackgroundRemoval(video.project, video.clipId, { asset: cutStill, chromaKey: key })).toThrow("类型不匹配");
  });
});

// The real model (168 MiB) and a photo of a person are supplied by the environment: REACUT_MATTE_MODEL
// is the ONNX file and REACUT_MATTE_SAMPLE a portrait with the person in the middle of the frame.
const model = process.env.REACUT_MATTE_MODEL, sample = process.env.REACUT_MATTE_SAMPLE;
describe.runIf(model && sample)("background removal with the real model", () => {
  let directory: string, photo: MediaAsset, movie: MediaAsset;
  /** RGBA of one pixel of a frame, at fractional coordinates. */
  async function pixel(file: string, x: number, y: number, second = 0): Promise<number[]> {
    const probe = await probeFile(file), stream = probe.streams.find((item) => item.codec_type === "video")!;
    const data = await runMediaTool("ffmpeg", ["-v", "error", "-ss", String(second), "-i", file, "-frames:v", "1",
      "-vf", `format=rgba,crop=1:1:${Math.floor(stream.width! * x)}:${Math.floor(stream.height! * y)}`, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
    return [...data.subarray(0, 4)];
  }
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "reacut-cutout-"));
    const clip = path.join(directory, "person.mp4");
    await runMediaTool("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", sample!, "-f", "lavfi", "-i", "sine=frequency=330:duration=2",
      "-vf", "scale=640:-2,format=yuv420p", "-r", "12", "-t", "2", "-c:v", "libx264", "-c:a", "aac", "-shortest", clip], 120_000);
    [photo, movie] = await importAssets([sample!, clip], path.join(directory, "cache"));
  }, 180_000);
  afterAll(() => rm(directory, { recursive: true, force: true }));
  it("reports the model as present", async () => {
    expect(await backgroundModelInfo(directory)).toEqual({ ready: true, megabytes: 168 });
  });
  it("gives a still a transparent background and leaves the person opaque", async () => {
    const { project, clipId } = projectWith(photo);
    const result = await removeBackground(randomUUID(), project, clipId, path.join(directory, "derived"), directory, () => {});
    expect(result.chromaKey).toBeUndefined();
    expect(result.asset).toMatchObject({ kind: "image", name: `${photo.name} · Cut out` });
    expect((await pixel(result.asset.path, 0.02, 0.02))[3]).toBeLessThan(40);
    expect((await pixel(result.asset.path, 0.98, 0.05))[3]).toBeLessThan(40);
    expect((await pixel(result.asset.path, 0.5, 0.6))[3]).toBeGreaterThan(215);
  }, 180_000);
  it("paints a video's background one colour, keeps its sound, and the keyed clip exports over a new backdrop", async () => {
    const { project, clipId } = projectWith(movie, { sourceIn: 0.5, duration: 1 });
    const progress: number[] = [], store = path.join(directory, "derived");
    const result = await removeBackground(randomUUID(), project, clipId, store, directory, (event) => progress.push(event.progress));
    expect(progress.at(-1)).toBe(1);
    expect(result.asset.kind).toBe("video");
    expect(result.asset.duration).toBeGreaterThan(0.9);
    expect(result.asset.duration).toBeLessThan(1.2);
    expect(result.asset.hasAudio).toBe(true);
    expect(result.chromaKey).toMatchObject({ enabled: true });
    const key = [1, 3, 5].map((at) => parseInt(result.chromaKey!.color.slice(at, at + 2), 16));
    const distance = (rgba: number[]) => Math.hypot(rgba[0] - key[0], rgba[1] - key[1], rgba[2] - key[2]) / (255 * Math.sqrt(3));
    expect(distance(await pixel(result.asset.path, 0.02, 0.02, 0.5))).toBeLessThan(0.06);
    expect(distance(await pixel(result.asset.path, 0.5, 0.6, 0.5))).toBeGreaterThan(result.chromaKey!.similarity + result.chromaKey!.blend);
    // A second request reuses the finished file.
    const again = await removeBackground(randomUUID(), project, clipId, store, directory, () => {});
    expect(again.asset.path).toBe(result.asset.path);
    expect(again.chromaKey).toEqual(result.chromaKey);
    expect((await readdir(store)).filter((name) => name.startsWith(".processing-"))).toEqual([]);
    // Through the real exporter: the corner shows the project's own backdrop, the middle shows the person.
    const edited = applyBackgroundRemoval(project, clipId, result).project;
    edited.width = 640; edited.height = 360; edited.background = "#3040c0";
    const output = path.join(directory, "over-backdrop.mp4");
    await new Promise<void>((resolve, reject) => {
      void startExport(edited, { path: output, width: 640, height: 360, fps: 12, quality: "standard", format: "mp4" }, (event: ExportProgress) => {
        if (event.status === "complete") resolve();
        if (event.status === "error" || event.status === "cancelled") reject(new Error(event.message ?? event.status));
      }).catch(reject);
    });
    const corner = await pixel(output, 0.02, 0.03, 0.5), middle = await pixel(output, 0.5, 0.6, 0.5);
    expect(Math.abs(corner[0] - 0x30) + Math.abs(corner[1] - 0x40) + Math.abs(corner[2] - 0xc0)).toBeLessThan(40);
    expect(Math.abs(middle[0] - 0x30) + Math.abs(middle[1] - 0x40) + Math.abs(middle[2] - 0xc0)).toBeGreaterThan(60);
  }, 300_000);
});
