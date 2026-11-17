import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addRecording } from "../src/core/recording";
import { createProject } from "../src/core/model";
import type { MediaAsset } from "../src/core/types";
import { saveRecording } from "../electron/recording";
import { runMediaTool } from "../electron/media";

const take = (id: string, duration = 2): MediaAsset => ({ id, name: `Voice-over ${id}`, kind: "audio", path: `/takes/${id}.wav`, url: "", duration, width: 0, height: 0, fps: 0, hasAudio: true });

describe("placing a voice-over take", () => {
  it("creates a voice-over track, reuses it while the span is free, and never overlaps a take", () => {
    const start = createProject("Narration");
    const first = addRecording(start, take("a"), 1, "Voice-over");
    const track = first.project.tracks.find((item) => item.name === "Voice-over")!;
    expect(track.kind).toBe("audio");
    expect(first.project.clips.find((clip) => clip.id === first.clipId)).toMatchObject({ trackId: track.id, start: 1, duration: 2, assetId: "a" });
    expect(start.tracks).toHaveLength(first.project.tracks.length - 1);
    const later = addRecording(first.project, take("b"), 4, "Voice-over");
    expect(later.project.tracks).toHaveLength(first.project.tracks.length);
    expect(later.project.clips.find((clip) => clip.id === later.clipId)!.trackId).toBe(track.id);
    const retake = addRecording(later.project, take("c"), 2, "Voice-over");
    expect(retake.project.tracks).toHaveLength(later.project.tracks.length + 1);
    expect(retake.project.clips.find((clip) => clip.id === retake.clipId)!.trackId).not.toBe(track.id);
  });
  it("rejects a take that is not audio or a position that is not on the timeline", () => {
    const project = createProject("Narration");
    expect(() => addRecording(project, { ...take("a"), kind: "video" }, 0, "Voice-over")).toThrow();
    expect(() => addRecording(project, take("a", 0), 0, "Voice-over")).toThrow();
    expect(() => addRecording(project, take("a"), -1, "Voice-over")).toThrow();
  });
});

describe("saving the recorder's stream", () => {
  let directory: string;
  beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "reacut-recording-")); });
  afterAll(() => rm(directory, { recursive: true, force: true }));
  it("converts a WebM/Opus take into an imported WAV asset and leaves no temporary files", async () => {
    const source = path.join(directory, "take.webm");
    await runMediaTool("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.5", "-ac", "2", "-c:a", "opus", "-strict", "-2", source]);
    const store = path.join(directory, "recordings");
    const asset = await saveRecording(new Uint8Array(await readFile(source)), store, path.join(directory, "cache"), "Voice-over 10:30");
    expect(asset).toMatchObject({ kind: "audio", name: "Voice-over 10:30", hasAudio: true });
    expect(asset.duration).toBeGreaterThan(1.3);
    expect(asset.duration).toBeLessThan(1.7);
    expect(path.dirname(asset.path)).toBe(store);
    expect(await readdir(store)).toEqual([path.basename(asset.path)]);
  }, 60_000);
  it("refuses an empty take and bytes that are not audio", async () => {
    const store = path.join(directory, "rejected");
    await expect(saveRecording(new Uint8Array(), store, path.join(directory, "cache"), "x")).rejects.toThrow("录音无效");
    await expect(saveRecording(new Uint8Array([1, 2, 3, 4]), store, path.join(directory, "cache"), "x")).rejects.toThrow();
    expect(await readdir(store)).toEqual([]);
  }, 60_000);
});
