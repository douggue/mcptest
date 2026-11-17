/** Record a voice-over in the compiled desktop app using Chromium's built-in fake microphone.
 * Run after npm run build: npx tsx tests/recording-electron.ts */
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { probeFile } from "../electron/media";

const root = process.cwd(), output = path.join(root, ".test-output", "recording-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.REACUT_USER_DATA = path.join(output, "user-data");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({
  args: [path.join(root, "dist-electron", "main.cjs"), "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  env,
  timeout: 30_000,
});
const page = await app.firstWindow(), errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.waitForSelector(".app-shell");
  // The take leaves the project unsaved; answer the close prompt with "Don't save".
  await app.evaluate(({ dialog }) => { (dialog as any).showMessageBox = async () => ({ response: 2 }); });
  await expect(page.locator(".tl-clip")).toHaveCount(0);
  await page.getByRole("button", { name: "Record voice-over", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop recording", exact: true });
  await expect(stop).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await expect(page.locator(".tl-recording-time")).toHaveText(/^0:0[2-4]$/);
  await stop.click();
  await expect(page.locator(".tl-clip")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Record voice-over", exact: true })).toBeVisible();
  const recordings = path.join(env.REACUT_USER_DATA, "recordings");
  const files = await readdir(recordings);
  assert.equal(files.length, 1, "Exactly one finished take and no temporary folder");
  const probe = await probeFile(path.join(recordings, files[0]));
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  assert.equal(audio?.codec_name, "pcm_s16le");
  const duration = Number(probe.format.duration);
  assert(duration > 1.5 && duration < 6, `Unexpected take length ${duration}`);
  const track = await page.evaluate(() => [...document.querySelectorAll(".tl-track-name, .tl-track-header input")].map((element) => (element as HTMLInputElement).value ?? element.textContent));
  assert.deepEqual(errors, []);
  const evidence = { passedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, take: files[0], duration, trackLabels: track, errors };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Voice-over recording checks passed:", evidence);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
