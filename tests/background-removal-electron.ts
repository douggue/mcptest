/** Remove a clip's background through the compiled desktop app's own controls, with the real model.
 * REACUT_MATTE_MODEL is the ONNX model file and REACUT_MATTE_SAMPLE a photo of a person.
 * Run after npm run build: npx tsx tests/background-removal-electron.ts */
import { _electron as electron, expect } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { runMediaTool } from "../electron/media";

const model = process.env.REACUT_MATTE_MODEL, sample = process.env.REACUT_MATTE_SAMPLE;
assert(model && sample, "Set REACUT_MATTE_MODEL and REACUT_MATTE_SAMPLE");
const root = process.cwd(), output = path.join(root, ".test-output", "background-removal-electron");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const source = path.join(output, "person on location.mp4");
await runMediaTool("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", sample, "-f", "lavfi", "-i", "sine=frequency=330:duration=2",
  "-vf", "scale=640:-2,format=yuv420p", "-r", "12", "-t", "2", "-c:v", "libx264", "-c:a", "aac", "-shortest", source], 120_000);
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
  await expect(page.locator(".tl-clip").first()).toBeVisible();
  await page.locator(".tl-clip").first().click();
  await page.getByRole("button", { name: "Remove background", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove background", exact: true });
  const start = dialog.getByRole("button", { name: "Remove background", exact: true });
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await expect(dialog.getByRole("button", { name: "Download the person model", exact: true })).toHaveCount(0);
  const started = Date.now();
  await start.click();
  await expect(dialog).toHaveCount(0, { timeout: 300_000 });
  await expect(page.locator(".media-item").filter({ hasText: "Cut out" })).toHaveCount(1);
  await page.screenshot({ path: path.join(output, "after.png") });
  assert.deepEqual(errors, []);
  const evidence = { passedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, seconds: (Date.now() - started) / 1000, errors };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("Background removal checks passed:", evidence);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await app.close();
}
