import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { downloadWhisperModel, generateSpeech, ggmlModelBytes, parseWhisperOutput, speechEngine, speechInfo, cancelSpeech } from "../electron/speech";
import { importAssets, runMediaTool } from "../electron/media";
import { createProject } from "../src/core/model";

let directory: string;
/** A file that passes for a whisper.cpp model: the format marker followed by filler. */
const fakeModel = (megabytes = 1) => { const bytes = Buffer.alloc(megabytes * 1024 * 1024 + 16); bytes.writeUInt32LE(0x67676d6c, 0); return bytes; };
beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "reacut-whisper-")); });
afterAll(() => rm(directory, { recursive: true, force: true }));

describe("whisper.cpp output and models", () => {
  it("turns caption-sized segments into cues and drops sound descriptions", () => {
    const output = JSON.stringify({ transcription: [
      { offsets: { from: 0, to: 1840 }, text: " Edit freely," },
      { offsets: { from: 1840, to: 3000 }, text: " express freely." },
      { offsets: { from: 3000, to: 5000 }, text: " [BLANK_AUDIO]" },
      { offsets: { from: 5000, to: 5000 }, text: " zero length" },
      { offsets: { from: 6000, to: 7000 }, text: "   " },
    ] });
    expect(parseWhisperOutput(output)).toEqual([
      { start: 0, end: 1.84, text: "Edit freely," },
      { start: 1.84, end: 3, text: "express freely." },
    ]);
    expect(() => parseWhisperOutput("{}")).toThrow("Invalid recognition result");
  });
  it("accepts only files that carry the model format marker", async () => {
    const model = path.join(directory, "ggml-test.bin"), other = path.join(directory, "notes.bin");
    await writeFile(model, fakeModel());
    await writeFile(other, Buffer.alloc(2 * 1024 * 1024));
    expect(await ggmlModelBytes(model)).toBe(1024 * 1024 + 16);
    await expect(ggmlModelBytes(other)).rejects.toThrow("not a Whisper speech model");
    await expect(ggmlModelBytes(path.join(directory, "absent.bin"))).rejects.toThrow("missing");
    await expect(ggmlModelBytes("relative.bin")).rejects.toThrow("Choose a speech model file");
  });
  it("keeps a download only when it matches the published checksum", async () => {
    const bytes = fakeModel(), store = path.join(directory, "models");
    const catalog = { base: { file: "ggml-base.bin", megabytes: 1, sha1: createHash("sha1").update(bytes).digest("hex") }, small: { file: "ggml-small.bin", megabytes: 1, sha1: "0".repeat(40) } };
    const requested: string[] = [];
    const fetcher = (async (url: string) => { requested.push(url); return new Response(bytes, { headers: { "content-length": String(bytes.length) } }); }) as unknown as typeof fetch;
    const progress: number[] = [];
    const file = await downloadWhisperModel("base", store, (value) => progress.push(value), fetcher, catalog);
    expect(requested).toEqual(["https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"]);
    expect(await readFile(file)).toEqual(bytes);
    expect(progress.at(-1)).toBe(1);
    // A second request finds the verified file and does not download again.
    await downloadWhisperModel("base", store, () => {}, fetcher, catalog);
    expect(requested).toHaveLength(1);
    await expect(downloadWhisperModel("small", store, () => {}, fetcher, catalog)).rejects.toThrow("integrity check");
    await expect(downloadWhisperModel("small", store, () => {}, (async () => new Response("no", { status: 404 })) as unknown as typeof fetch, catalog)).rejects.toThrow("HTTP 404");
    expect(await readdir(store)).toEqual(["ggml-base.bin"]);
  });
  it("can be cancelled and leaves no partial file", async () => {
    const store = path.join(directory, "cancelled");
    const fetcher = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;
    const pending = downloadWhisperModel("base", store, () => {}, fetcher);
    // Let the request start, then cancel it mid-flight.
    await new Promise((resolve) => setTimeout(resolve, 50));
    cancelSpeech("model-download");
    await expect(pending).rejects.toThrow("cancelled");
    expect(await readdir(store)).toEqual([]);
  });
});

// A stand-in engine: a script that behaves like the command-line tool. Windows cannot start "#!"
// scripts and Apple Silicon uses its own engine, so the real Windows engine is checked in CI instead.
describe.skipIf(process.platform === "win32" || speechEngine() !== "whisper-cpp")("recognition through the bundled engine", () => {
  it("runs the engine in the job folder, reports its progress and returns validated cues", async () => {
    const engine = path.join(directory, "whisper-cli"), model = path.join(directory, "模型", "ggml-test.bin"), wav = path.join(directory, "speech source.wav");
    await writeFile(engine, `#!${process.execPath}
const fs = require("node:fs"), args = process.argv.slice(2), value = (flag) => args[args.indexOf(flag) + 1];
fs.writeFileSync("invocation.json", JSON.stringify({ args, cwd: process.cwd(), model: fs.readFileSync(value("-m")).length, input: fs.statSync(value("-f")).size > 1000 }));
fs.copyFileSync("invocation.json", ${JSON.stringify(path.join(directory, "invocation.json"))});
process.stderr.write("whisper_print_progress_callback: progress =  50%\\n");
fs.writeFileSync(value("-of") + ".json", JSON.stringify({ transcription: [{ offsets: { from: 200, to: 1400 }, text: " Hello from JGcut." }, { offsets: { from: 1500, to: 1900 }, text: " (music)" }] }));
`);
    await chmod(engine, 0o755);
    await rm(path.dirname(model), { recursive: true, force: true });
    await (await import("node:fs/promises")).mkdir(path.dirname(model), { recursive: true });
    await writeFile(model, fakeModel());
    await runMediaTool("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=2", "-c:a", "pcm_s16le", wav]);
    const [asset] = await importAssets([wav], path.join(directory, "cache"));
    const project = createProject("Captions"); project.assets.push(asset);
    process.env.REACUT_WHISPER = engine;
    try {
      const info = await speechInfo({ model });
      expect(info).toMatchObject({ engine: "whisper-cpp", ready: true, modelBytes: 1024 * 1024 + 16 });
      expect((await speechInfo({})).error).toContain("Download or choose a speech model");
      const stages: [string, number | undefined][] = [];
      const result = await generateSpeech(randomUUID(), project, { mode: "asr", source: `asset:${asset.id}`, language: "en" }, { model }, path.join(directory, "speech-media"), (event) => stages.push([event.stage, event.progress]));
      expect(result).toEqual({ mode: "asr", cues: [{ start: 0.2, end: 1.4, text: "Hello from JGcut." }] });
      expect(stages).toContainEqual(["recognize", 0.5]);
      const invocation = JSON.parse(await readFile(path.join(directory, "invocation.json"), "utf8"));
      // The model lives under a non-ASCII folder, so it is linked into the job folder and named plainly.
      expect(invocation.args.slice(0, 6)).toEqual(["-m", "model.bin", "-f", "speech.wav", "-l", "en"]);
      expect(invocation).toMatchObject({ model: 1024 * 1024 + 16, input: true });
      expect(await readdir(path.join(directory, "speech-media"))).toEqual([]);
    } finally { delete process.env.REACUT_WHISPER; }
  }, 60_000);
});
