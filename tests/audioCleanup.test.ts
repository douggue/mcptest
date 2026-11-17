import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyAudioCleanup, audioCleanupPlan } from "../src/core/audioCleanup";
import { createClip, createProject } from "../src/core/model";
import type { MediaAsset, Project } from "../src/core/types";
import { audioCleanupFilters, cleanAudio, estimateNoiseFloor } from "../electron/audioCleanup";
import { importAssets, probeFile, runMediaTool } from "../electron/media";

let directory: string, noisy: MediaAsset, movie: MediaAsset;
const projectWith = (asset: MediaAsset): { project: Project; clipId: string } => {
  const project = createProject("Clean-up");
  const track = project.tracks.find((item) => item.kind === (asset.kind === "audio" ? "audio" : "video"))!;
  const clip = createClip(asset, track.id, 0, project.fps);
  project.assets.push(asset); project.clips.push(clip);
  return { project, clipId: clip.id };
};
/** Root-mean-square level of a span, from decoded mono samples. */
async function level(file: string, start: number, duration: number): Promise<number> {
  const pcm = await runMediaTool("ffmpeg", ["-v", "error", "-ss", String(start), "-t", String(duration), "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"]);
  let power = 0; const samples = Math.floor(pcm.length / 4);
  for (let i = 0; i < samples; i++) power += pcm.readFloatLE(i * 4) ** 2;
  return Math.sqrt(power / Math.max(1, samples));
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "reacut-cleanup-"));
  const wav = path.join(directory, "noisy.wav"), mp4 = path.join(directory, "noisy.mp4");
  // Four seconds of faint hiss with a quiet tone, standing in for a voice, over the first two.
  const sound = "anoisesrc=color=white:amplitude=0.004:sample_rate=48000:duration=4[n];sine=frequency=440:sample_rate=48000:duration=2,volume=0.5[t];[n][t]amix=inputs=2:duration=first:normalize=0";
  await runMediaTool("ffmpeg", ["-v", "error", "-y", "-filter_complex", sound, "-c:a", "pcm_s16le", wav]);
  await runMediaTool("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10:duration=4", "-i", wav, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);
  [noisy, movie] = await importAssets([wav, mp4], path.join(directory, "cache"));
}, 60_000);
afterAll(() => rm(directory, { recursive: true, force: true }));

describe("audio clean-up", () => {
  it("validates the request, the clip and the track before any media work", () => {
    const { project, clipId } = projectWith(noisy);
    expect(() => audioCleanupPlan(project, clipId, { denoise: false, normalize: false })).toThrow("至少选择一项");
    expect(() => audioCleanupPlan(project, "missing", { denoise: true, normalize: true })).toThrow("带声音的片段");
    project.tracks.forEach((track) => { track.locked = true; });
    expect(() => audioCleanupPlan(project, clipId, { denoise: true, normalize: true })).toThrow("解锁");
    expect(audioCleanupFilters({ denoise: true, normalize: false }, -52.6)).toBe("highpass=f=70,afftdn=nr=18:nf=-53");
    expect(audioCleanupFilters({ denoise: true, normalize: false }, -200)).toBe("highpass=f=70,afftdn=nr=18:nf=-80");
    expect(audioCleanupFilters({ denoise: false, normalize: true })).toBe("loudnorm=I=-16:TP=-1.5:LRA=11");
  });
  it("lowers the noise floor, raises a quiet recording, reuses its result and swaps only the source", async () => {
    const { project, clipId } = projectWith(noisy);
    const store = path.join(directory, "derived");
    const denoised = await cleanAudio(randomUUID(), project, clipId, { denoise: true, normalize: false }, store, () => {});
    expect(denoised).toMatchObject({ kind: "audio", name: "noisy.wav · Cleaned" });
    // The hiss-only stretch drops to under half its level while the "voice" keeps its own.
    const floor = await estimateNoiseFloor(noisy.path);
    expect(floor).toBeGreaterThan(-58);
    expect(floor).toBeLessThan(-48);
    expect(await level(denoised.path, 2.5, 1.2)).toBeLessThan((await level(noisy.path, 2.5, 1.2)) * 0.5);
    expect(await level(denoised.path, 0.5, 1.2)).toBeGreaterThan((await level(noisy.path, 0.5, 1.2)) * 0.9);
    const progress: number[] = [];
    const levelled = await cleanAudio(randomUUID(), project, clipId, { denoise: false, normalize: true }, store, (event) => progress.push(event.progress));
    expect(await level(levelled.path, 0.5, 1.2)).toBeGreaterThan((await level(noisy.path, 0.5, 1.2)) * 1.5);
    expect(progress.at(-1)).toBe(1);
    const again = await cleanAudio(randomUUID(), project, clipId, { denoise: false, normalize: true }, store, () => {});
    expect(again.path).toBe(levelled.path);
    expect((await readdir(store)).filter((name) => name.startsWith(".processing-"))).toEqual([]);
    const edited = applyAudioCleanup(project, clipId, { denoise: false, normalize: true }, levelled);
    const clip = edited.project.clips.find((item) => item.id === clipId)!, before = project.clips[0];
    expect(clip).toMatchObject({ assetId: levelled.id, start: before.start, duration: before.duration, sourceIn: before.sourceIn, speed: before.speed });
    expect(project.clips[0].assetId).toBe(noisy.id);
    expect(() => applyAudioCleanup(project, clipId, { denoise: true, normalize: true }, { ...levelled, kind: "video" })).toThrow("类型不匹配");
  }, 120_000);
  it("keeps a video clip's picture untouched and replaces only its sound", async () => {
    const { project, clipId } = projectWith(movie);
    const cleaned = await cleanAudio(randomUUID(), project, clipId, { denoise: true, normalize: true }, path.join(directory, "derived"), () => {});
    expect(cleaned.kind).toBe("video");
    const [before, after] = await Promise.all([probeFile(movie.path), probeFile(cleaned.path)]);
    const picture = (probe: typeof before) => probe.streams.find((stream) => stream.codec_type === "video");
    expect(picture(after)).toMatchObject({ codec_name: "h264", width: picture(before)!.width, height: picture(before)!.height });
    expect(after.streams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe("aac");
    expect(Number(after.format.duration)).toBeCloseTo(Number(before.format.duration), 0);
    expect(applyAudioCleanup(project, clipId, { denoise: true, normalize: true }, cleaned).project.clips[0].assetId).toBe(cleaned.id);
  }, 120_000);
});
