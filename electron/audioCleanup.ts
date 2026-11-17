import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { audioCleanupPlan, type AudioCleanupRequest } from "../src/core/audioCleanup";
import type { DerivativeProgress, MediaAsset, Project } from "../src/core/types";
import { importAssets, probeFile, runMediaTool } from "./media";

const jobs = new Map<string, { controller: AbortController; done: Promise<MediaAsset> }>();
export function cancelAudioCleanup(id: string) { jobs.get(id)?.controller.abort(); }
export async function cancelAudioCleanups() {
  for (const job of jobs.values()) job.controller.abort();
  await Promise.allSettled([...jobs.values()].map((job) => job.done));
}

/** A rumble filter and a spectral noise reducer set to this recording's own noise floor; then
 * single-pass loudness normalisation to the level streaming platforms commonly use. */
export function audioCleanupFilters(request: AudioCleanupRequest, noiseFloor = -45): string {
  const floor = Math.max(-80, Math.min(-20, Math.round(noiseFloor)));
  return [
    ...(request.denoise ? ["highpass=f=70", `afftdn=nr=18:nf=${floor}`] : []),
    ...(request.normalize ? ["loudnorm=I=-16:TP=-1.5:LRA=11"] : []),
  ].join(",");
}

/** The level, in dB, of the quietest tenth of the recording's 50 ms stretches: what is left when
 * nobody is speaking. The reducer removes little unless it is told this level. */
export async function estimateNoiseFloor(file: string, signal?: AbortSignal): Promise<number> {
  // Full bandwidth, because hiss lives in the high frequencies; the first minute is enough for steady noise.
  const rate = 48000, window = rate / 20;
  const pcm = await runMediaTool("ffmpeg", ["-v", "error", "-nostdin", "-t", "60", "-i", file, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(rate), "-f", "f32le", "pipe:1"], 10 * 60_000, 32 * 1024 * 1024, { signal });
  const levels: number[] = [];
  for (let at = 0; at + window * 4 <= pcm.length; at += window * 4) {
    let power = 0;
    for (let i = 0; i < window; i++) power += pcm.readFloatLE(at + i * 4) ** 2;
    levels.push(Math.sqrt(power / window));
  }
  if (!levels.length) return -45;
  levels.sort((a, b) => a - b);
  const quiet = levels[Math.floor(levels.length / 10)];
  return quiet > 0 ? 20 * Math.log10(quiet) : -80;
}

/** Write a cleaned copy of the clip's whole source file and import it. Audio sources become WAV;
 * video sources keep their picture untouched and get the cleaned sound. The original is not changed. */
export function cleanAudio(jobId: string, p: Project, clipId: string, request: AudioCleanupRequest, directory: string,
  progress: (event: DerivativeProgress) => void): Promise<MediaAsset> {
  if (typeof jobId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(jobId)) throw new Error("无效任务编号");
  if (jobs.size) throw new Error("已有媒体处理任务，请等待或取消");
  const { asset } = audioCleanupPlan(p, clipId, request), controller = new AbortController();
  const done = Promise.resolve().then(generate).finally(() => jobs.delete(jobId));
  jobs.set(jobId, { controller, done });
  return done;
  async function generate(): Promise<MediaAsset> {
    const { signal } = controller;
    const report = (value: number, message: string) => { signal.throwIfAborted(); progress({ jobId, progress: value, message }); };
    let temporary: string | undefined;
    try {
      report(0, "检查源素材");
      const info = await stat(asset.path), probe = await probeFile(asset.path, signal);
      if (!probe.streams.some((stream) => stream.codec_type === "audio")) throw new Error("请选择带声音的片段");
      const video = asset.kind === "video" ? probe.streams.find((stream) => stream.codec_type === "video") : undefined;
      // Stream copy needs a container that can hold the picture as it is.
      const extension = !video ? "wav" : ["h264", "hevc", "av1", "vp9", "mpeg4"].includes(video.codec_name ?? "") ? "mp4" : "mov";
      const key = createHash("sha256").update(JSON.stringify(["audio-cleanup-v1", asset.path, info.size, info.mtimeMs, request.denoise, request.normalize, asset.kind])).digest("hex");
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, `${key}.${extension}`);
      let cached = false;
      try { await access(destination); cached = true; } catch { /* Create below. */ }
      if (!cached) {
        temporary = await mkdtemp(path.join(directory, ".processing-"));
        const result = path.join(temporary, `result.${extension}`);
        const seconds = Math.max(0.1, Number(probe.format.duration) || asset.duration);
        const noiseFloor = request.denoise ? await estimateNoiseFloor(asset.path, signal) : undefined;
        report(0.05, "正在处理声音");
        let buffer = "";
        await runMediaTool("ffmpeg", [
          "-v", "error", "-nostdin", "-y", "-progress", "pipe:1", "-i", asset.path,
          ...(video ? ["-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"] : ["-map", "0:a:0", "-vn"]),
          "-af", audioCleanupFilters(request, noiseFloor), "-ar", "48000",
          ...(video ? ["-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart"] : ["-c:a", "pcm_s16le"]),
          result,
        ], 60 * 60_000, 16 * 1024 * 1024, {
          signal, onOutput: (text) => {
            buffer += text;
            const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
            for (const line of lines) if (line.startsWith("out_time_us=")) {
              const value = Number(line.split("=")[1]);
              if (Number.isFinite(value) && !signal.aborted) progress({ jobId, progress: 0.05 + 0.85 * Math.min(1, Math.max(0, value / 1e6 / seconds)), message: "正在处理声音" });
            }
          },
        });
        signal.throwIfAborted();
        const after = await stat(asset.path);
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("源素材在处理期间发生变化，请重试");
        await rename(result, destination);
      }
      report(0.95, "导入处理后的素材");
      const [cleaned] = await importAssets([destination], path.join(directory, "thumbnails"), signal);
      signal.throwIfAborted();
      if (asset.kind === "audio") { cleaned.kind = "audio"; cleaned.width = 0; cleaned.height = 0; cleaned.thumbnail = undefined; }
      cleaned.id = randomUUID();
      cleaned.name = `${asset.name} · Cleaned`;
      report(1, "完成");
      return cleaned;
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
}
