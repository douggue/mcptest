import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export interface PinnedFile { file: string; megabytes: number; algorithm: "sha1" | "sha256"; digest: string }

export async function fileDigest(file: string, algorithm: PinnedFile["algorithm"]): Promise<string> {
  const hash = createHash(algorithm), handle = await open(file, "r");
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk); } finally { await handle.close(); }
  return hash.digest("hex");
}

/** Fetch one file the user asked for. It is kept only if it matches its pinned checksum; an
 * interrupted, oversized or altered download leaves nothing behind. A verified copy is reused. */
export async function downloadVerified(url: string, directory: string, pinned: PinnedFile, progress: (fraction: number) => void,
  signal: AbortSignal, fetcher: typeof globalThis.fetch = globalThis.fetch): Promise<string> {
  const destination = path.join(directory, pinned.file), partial = destination + ".partial";
  try {
    await mkdir(directory, { recursive: true });
    try { if (await fileDigest(destination, pinned.algorithm) === pinned.digest) { progress(1); return destination; } } catch { /* Not downloaded yet. */ }
    signal.throwIfAborted();
    const response = await fetcher(url, { signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`The download failed (HTTP ${response.status}).`);
    const total = Number(response.headers.get("content-length")) || pinned.megabytes * 1024 * 1024;
    const hash = createHash(pinned.algorithm), file = createWriteStream(partial);
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.length;
        if (received > 2 * pinned.megabytes * 1024 * 1024) throw new Error("The download is larger than expected.");
        hash.update(chunk);
        if (!file.write(chunk)) await once(file, "drain");
        progress(Math.min(0.99, received / total));
      }
    } finally { await new Promise<void>((resolve) => file.end(() => resolve())); }
    if (hash.digest("hex") !== pinned.digest) throw new Error("The download failed its integrity check. Try again.");
    await rename(partial, destination);
    progress(1);
    return destination;
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    throw signal.aborted ? new Error("The download was cancelled.") : error;
  }
}
