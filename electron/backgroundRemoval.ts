import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { backdropKey, backgroundRemovalPlan, type BackgroundRemovalResult } from "../src/core/backgroundRemoval";
import type { DerivativeProgress, Project } from "../src/core/types";
import { downloadVerified, type PinnedFile } from "./downloads";
import { findMediaTool, importAssets, probeFile } from "./media";

/** U²-Net trained for people (Apache-2.0), in ONNX form as published with the rembg project. */
export const MATTE_MODEL: PinnedFile = { file: "u2net_human_seg.onnx", megabytes: 168, algorithm: "sha256", digest: "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c" };
const MATTE_MODEL_SOURCE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx";
const SIZE = 320, MEAN = [0.485, 0.456, 0.406], DEVIATION = [0.229, 0.224, 0.225];
const BACKDROPS: [string, [number, number, number]][] = [["#00ff00", [0, 255, 0]], ["#0000ff", [0, 0, 255]], ["#ff00ff", [255, 0, 255]]];

const jobs = new Map<string, { controller: AbortController; done: Promise<BackgroundRemovalResult> }>();
let modelDownload: AbortController | undefined;
export function cancelBackgroundRemoval(id: string) { if (id === "background-model") modelDownload?.abort(); jobs.get(id)?.controller.abort(); }
export async function cancelBackgroundRemovals() {
  modelDownload?.abort();
  for (const job of jobs.values()) job.controller.abort();
  await Promise.allSettled([...jobs.values()].map((job) => job.done));
}

/** The model file to use: an explicit override for tests, otherwise the downloaded copy. */
export const matteModelPath = (directory: string) => process.env.REACUT_MATTE_MODEL || path.join(directory, MATTE_MODEL.file);
export async function backgroundModelInfo(directory: string): Promise<{ ready: boolean; megabytes: number }> {
  try { return { ready: (await stat(matteModelPath(directory))).size > 1024 * 1024, megabytes: MATTE_MODEL.megabytes }; }
  catch { return { ready: false, megabytes: MATTE_MODEL.megabytes }; }
}
/** Download the person model, only ever because the user pressed the button. */
export async function downloadBackgroundModel(directory: string, progress: (fraction: number) => void, fetcher: typeof globalThis.fetch = globalThis.fetch) {
  if (modelDownload) throw new Error("A model download is already running.");
  const controller = new AbortController(); modelDownload = controller;
  try { await downloadVerified(MATTE_MODEL_SOURCE, directory, MATTE_MODEL, progress, controller.signal, fetcher); }
  finally { modelDownload = undefined; }
  return backgroundModelInfo(directory);
}

/** The backdrop colour that sits farthest from the subject's own colours, and how far that is. */
export function chooseBackdrop(frame: Uint8Array, matte: Uint8Array): { color: string; rgb: [number, number, number]; nearest: number } {
  let best = { color: BACKDROPS[0][0], rgb: BACKDROPS[0][1], nearest: -1 };
  for (const [color, rgb] of BACKDROPS) {
    const distances: number[] = [];
    for (let i = 0; i < matte.length; i++) if (matte[i] > 128)
      distances.push(Math.hypot(frame[i * 3] - rgb[0], frame[i * 3 + 1] - rgb[1], frame[i * 3 + 2] - rgb[2]) / (255 * Math.sqrt(3)));
    distances.sort((a, b) => a - b);
    // The second percentile ignores a few stray pixels without letting a patch of clothing through.
    const nearest = distances.length ? distances[Math.floor(distances.length * 0.02)] : 1;
    if (nearest > best.nearest) best = { color, rgb, nearest };
  }
  return best;
}

type Session = { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>> };
/** Load the model, preferring the graphics card on Windows and falling back to the processor. */
async function openSession(model: string): Promise<{ session: Session; runtime: typeof import("onnxruntime-node"); accelerated: boolean }> {
  const runtime = await import("onnxruntime-node");
  if (process.platform === "win32" && !process.env.REACUT_MATTE_CPU) {
    try { return { session: await runtime.InferenceSession.create(model, { executionProviders: ["dml", "cpu"] }) as unknown as Session, runtime, accelerated: true }; }
    catch { /* No usable graphics device; use the processor. */ }
  }
  return { session: await runtime.InferenceSession.create(model, { executionProviders: ["cpu"] }) as unknown as Session, runtime, accelerated: false };
}

/** Separate the person in a clip from the background. A still becomes a PNG with transparency;
 * a video becomes a copy of the clip's source range with the background painted one flat colour,
 * plus the chroma key settings that remove it. The original file is never changed. */
export function removeBackground(jobId: string, p: Project, clipId: string, directory: string, modelDirectory: string,
  progress: (event: DerivativeProgress) => void): Promise<BackgroundRemovalResult> {
  if (typeof jobId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(jobId)) throw new Error("无效任务编号");
  if (jobs.size) throw new Error("已有媒体处理任务，请等待或取消");
  const { clip, asset } = backgroundRemovalPlan(p, clipId), controller = new AbortController();
  const done = Promise.resolve().then(generate).finally(() => jobs.delete(jobId));
  jobs.set(jobId, { controller, done });
  return done;
  async function generate(): Promise<BackgroundRemovalResult> {
    const { signal } = controller;
    const report = (value: number, message: string) => { signal.throwIfAborted(); progress({ jobId, progress: value, message }); };
    const children: ChildProcess[] = [];
    const stop = () => children.forEach((child) => { if (child.exitCode === null) child.kill("SIGKILL"); });
    signal.addEventListener("abort", stop, { once: true });
    let temporary: string | undefined;
    try {
      report(0, "检查源素材");
      const model = matteModelPath(modelDirectory);
      try { await access(model); } catch { throw new Error("请先下载人像模型"); }
      const info = await stat(asset.path), probe = await probeFile(asset.path, signal);
      if (!probe.streams.some((stream) => stream.codec_type === "video")) throw new Error("请选择视频或图片片段");
      const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
      const video = asset.kind === "video";
      const width = video ? even(asset.width) : asset.width, height = video ? even(asset.height) : asset.height;
      if (!width || !height || width * height > 4096 * 2160) throw new Error("当前衍生媒体支持最高 4096×2160 像素量，请先缩小素材");
      const start = video ? clip.sourceIn : 0, length = video ? clip.duration * clip.speed : 0;
      const rate = video ? Math.min(60, Math.max(1, Math.round((asset.fps || p.fps) * 1000) / 1000)) : 1;
      const key = createHash("sha256").update(JSON.stringify(["background-v1", asset.path, info.size, info.mtimeMs, MATTE_MODEL.digest, start, length, rate])).digest("hex");
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, `${key}.${video ? "mp4" : "png"}`), settings = path.join(directory, `${key}.json`);
      let chromaKey: BackgroundRemovalResult["chromaKey"];
      let cached = false;
      try {
        await access(destination);
        if (video) chromaKey = JSON.parse(await readFile(settings, "utf8"));
        cached = true;
      } catch { /* Create below. */ }
      if (!cached) {
        report(0.02, "正在载入人像模型");
        const { session, runtime } = await openSession(model);
        signal.throwIfAborted();
        temporary = await mkdtemp(path.join(directory, ".processing-"));
        const result = path.join(temporary, `result.${video ? "mp4" : "png"}`);
        const ffmpeg = await findMediaTool("ffmpeg");
        const range = video ? ["-ss", String(start), "-t", String(length)] : [];
        const picture = `${video ? `fps=${rate},` : ""}scale=${width}:${height},setsar=1`;
        // One decoder feeds small frames to the model; a second process pairs each matte with the full-size picture.
        const reader = spawn(ffmpeg, ["-v", "error", "-nostdin", ...range, "-protocol_whitelist", "file,pipe", "-i", asset.path, "-map", "0:v:0",
          ...(video ? [] : ["-frames:v", "1"]), "-vf", `${video ? `fps=${rate},` : ""}scale=${SIZE}:${SIZE}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
          { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        children.push(reader);
        let readerError = "", writerError = "", writer: ChildProcess | undefined, writerClosed: Promise<number | null> | undefined;
        reader.stderr!.on("data", (data) => { readerError = (readerError + String(data)).slice(-4000); });
        const total = video ? Math.max(1, Math.round(length * rate)) : 1;
        const input = new Float32Array(3 * SIZE * SIZE);
        let previous: Uint8Array | undefined, frames = 0, pending: Buffer = Buffer.alloc(0);
        const startWriter = (frame: Uint8Array, matte: Uint8Array) => {
          // Firm up the soft matte, then either keep it as transparency (still) or paint the backdrop (video).
          const edge = `[1:v]scale=${width}:${height}:flags=bicubic,lutyuv=y='clip((val-90)*255/76,0,255)',format=gray[matte];[0:v]${picture},format=rgba[picture];[picture][matte]alphamerge`;
          let graph = `${edge}[v]`;
          if (video) {
            const backdrop = chooseBackdrop(frame, matte);
            chromaKey = backdropKey(backdrop.color, backdrop.nearest);
            graph = `${edge}[subject];color=c=0x${backdrop.color.slice(1)}:s=${width}x${height}:r=${rate}[backdrop];[backdrop][subject]overlay=shortest=1,format=yuv420p[v]`;
          }
          writer = spawn(ffmpeg, ["-v", "error", "-y", ...range, "-protocol_whitelist", "file,pipe", "-i", asset.path,
            "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${SIZE}x${SIZE}`, "-r", String(rate), "-i", "pipe:0", "-filter_complex", graph, "-map", "[v]",
            ...(video ? ["-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"] : ["-frames:v", "1"]),
            result], { shell: false, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
          children.push(writer);
          writer.stderr!.on("data", (data) => { writerError = (writerError + String(data)).slice(-4000); });
          writer.stdin!.on("error", () => { /* Reported through the exit code. */ });
          writerClosed = once(writer, "close").then(([code]) => code as number | null);
        };
        for await (const chunk of reader.stdout! as AsyncIterable<Buffer>) {
          pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
          while (pending.length >= SIZE * SIZE * 3) {
            signal.throwIfAborted();
            const frame = pending.subarray(0, SIZE * SIZE * 3); pending = pending.subarray(SIZE * SIZE * 3);
            for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = (frame[i * 3 + c] / 255 - MEAN[c]) / DEVIATION[c];
            const output = await session.run({ [session.inputNames[0]]: new runtime.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
            const values = output[session.outputNames[0]].data;
            let low = Infinity, high = -Infinity;
            for (let i = 0; i < SIZE * SIZE; i++) { if (values[i] < low) low = values[i]; if (values[i] > high) high = values[i]; }
            const matte = new Uint8Array(SIZE * SIZE), span = high - low || 1;
            for (let i = 0; i < SIZE * SIZE; i++) {
              // Carry a little of the previous frame so the outline does not shimmer.
              const value = (values[i] - low) / span;
              matte[i] = Math.round(255 * (previous ? 0.7 * value + 0.3 * previous[i] / 255 : value));
            }
            previous = matte;
            if (!writer) startWriter(frame, matte);
            if (!writer!.stdin!.write(matte)) await once(writer!.stdin!, "drain");
            frames++;
            progress({ jobId, progress: 0.05 + 0.9 * Math.min(1, frames / total), message: "正在分离人物与背景" });
          }
        }
        signal.throwIfAborted();
        if (!writer || !frames) throw new Error(`无法读取画面：${readerError.trim() || "no frames"}`);
        writer.stdin!.end();
        const code = await writerClosed!;
        signal.throwIfAborted();
        if (code !== 0) throw new Error(`FFmpeg 导出失败：${writerError.trim() || code}`);
        const after = await stat(asset.path);
        if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error("源素材在处理期间发生变化，请重试");
        if (video) await writeFile(settings, JSON.stringify(chromaKey));
        await rename(result, destination);
      }
      report(0.97, "导入处理后的素材");
      const [cut] = await importAssets([destination], path.join(directory, "thumbnails"), signal);
      signal.throwIfAborted();
      cut.id = randomUUID();
      cut.name = `${asset.name} · Cut out`;
      report(1, "完成");
      return { asset: cut, chromaKey };
    } finally {
      signal.removeEventListener("abort", stop);
      stop();
      if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  }
}
