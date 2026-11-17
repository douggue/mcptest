import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { importAssets, mediaURL, runMediaTool } from "./media";
import type { MediaAsset } from "../src/core/types";

const MAX_BYTES = 512 * 1024 * 1024;

/** Turn the browser recorder's stream (WebM/Opus, with no duration in its header) into an
 * ordinary WAV file under `directory` and import it like any other audio. */
export async function saveRecording(bytes: Uint8Array, directory: string, cacheDir: string, name: string): Promise<MediaAsset> {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BYTES) throw new Error("录音无效");
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(path.join(directory, ".recording-"));
  try {
    const source = path.join(temporary, "recording.webm"), wav = path.join(temporary, "recording.wav");
    await writeFile(source, bytes);
    await runMediaTool("ffmpeg", ["-v", "error", "-nostdin", "-y", "-i", source, "-vn", "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav], 600_000, 1024 * 1024);
    const destination = path.join(directory, `${randomUUID()}.wav`);
    await rename(wav, destination);
    try {
      const [asset] = await importAssets([destination], cacheDir);
      if (asset.kind !== "audio") throw new Error("录音无效");
      asset.name = name.replace(/[\0-\x1f]/g, "").slice(0, 80) || "Voice-over";
      asset.url = mediaURL(destination);
      return asset;
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
