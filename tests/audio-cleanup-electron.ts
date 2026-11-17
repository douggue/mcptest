/** Clean up a noisy clip's audio through the compiled desktop app's own controls.
 * Run after npm run build: npx tsx tests/audio-cleanup-electron.ts */
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { runMediaTool } from "../electron/media";

const root = process.cwd(), output = path.join(root, ".test-output", "audio-cleanup-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const source = path.join(output, "noisy voice.wav");
await runMediaTool("ffmpeg", ["-v", "error", "-y", "-filter_complex",
  "anoisesrc=color=white:amplitude=0.004:sample_rate=48000:duration=4[n];sine=frequency=440:sample_rate=48000:duration=2,volume=0.5[t];[n][t]amix=inputs=2:duration=first:normalize=0",
  "-c:a", "pcm_s16le", source]);
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: [path.join(root, "dist-electron", "main.cjs")], env, timeout: 30_000 });
const page = await app.firstWindow(), errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.waitForSelector(".app-shell");
  await app.evaluate(({ dialog }, file) => {
    (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    // The edit leaves the project unsaved; answer the close prompt with "Don't save".
    (dialog as any).showMessageBox = async () => ({ response: 2 });
  }, source);
  await page.locator(".media-import").click();
  await expect(page.locator(".media-item")).toHaveCount(1, { timeout: 30_000 });
  await page.locator(".media-item").first().dblclick();
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  await page.locator(".tl-clip").first().click();
  await page.getByRole("button", { name: "Clean up audio", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Clean up audio", exact: true });
  await expect(dialog.locator("#cleanup-denoise")).toBeChecked();
  await expect(dialog.locator("#cleanup-normalize")).toBeChecked();
  await dialog.getByRole("button", { name: "Clean up", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
  // The clip now plays the cleaned copy, which is listed beside the original.
  await expect(page.locator(".media-item")).toHaveCount(2);
  await expect(page.locator(".media-item").filter({ hasText: "Cleaned" })).toHaveCount(1);
  await expect(page.locator(".tl-clip")).toHaveCount(1);
  // One undo restores the original source.
  await page.keyboard.press("Control+z");
  await expect(page.locator(".media-item")).toHaveCount(1);
  assert.deepEqual(errors, []);
  const evidence = { passedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, errors };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Audio clean-up checks passed:", evidence);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
