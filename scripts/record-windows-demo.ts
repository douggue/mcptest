/** Opt-in CI helper: drive the installed Windows application through a short tour and record it.
 * REACUT_TEST_APP is the install folder; REACUT_DEMO_RECORDER is a full FFmpeg with gdigrab.
 * Only the save-location dialog is answered by the script; everything else is the real application.
 */
import { _electron as electron, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeFile } from "../electron/media";

if (process.platform !== "win32") throw new Error("This recording runs on Windows.");
const root = process.cwd();
const bundle = path.resolve(process.env.REACUT_TEST_APP ?? "");
const recorder = process.env.REACUT_DEMO_RECORDER ?? "";
const output = path.join(root, "docs", "windows");
const work = path.join(root, ".test-output", "windows-demo");
const demo = path.join(root, ".demo", "demo.reacut");
const exported = path.join(work, "exported-demo.mp4");
const desktopVideo = path.join(output, "desktop.mp4");
await stat(path.join(bundle, "JGcut.exe"));
await stat(demo);
await rm(work, { recursive: true, force: true });
await rm(output, { recursive: true, force: true });
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });

function run(args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(recorder, args, { stdio: "ignore", windowsHide: true });
    child.once("error", () => resolve(null));
    child.once("close", resolve);
  });
}
// The whole desktop, so the native window frame and taskbar are part of the picture.
let capture: ChildProcess | undefined;
let captureLog = "";
if (recorder) {
  capture = spawn(recorder, [
    "-y", "-f", "gdigrab", "-framerate", "15", "-draw_mouse", "0", "-i", "desktop",
    "-vf", "scale=1280:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", desktopVideo,
  ], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  capture.stderr!.on("data", (data) => { captureLog = (captureLog + String(data)).slice(-4000); });
  capture.once("error", (error) => { captureLog += String(error); });
}
const captureDone = new Promise<void>((resolve) => {
  if (!capture) resolve();
  else capture.once("close", () => resolve());
});
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
await pause(1500);

const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
env.REACUT_USER_DATA = path.join(work, "user-data");
for (const name of ["ELECTRON_RUN_AS_NODE", "VITE_DEV_SERVER_URL", "REACUT_FFMPEG", "REACUT_FFPROBE"]) delete env[name];
const app = await electron.launch({
  executablePath: path.join(bundle, "JGcut.exe"),
  args: [demo],
  cwd: work,
  env,
  timeout: 45000,
});
const page = await app.firstWindow();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const steps: string[] = [];
// A second recording of the editor alone, assembled from page captures, in case the desktop cannot be grabbed.
const frames = path.join(work, "frames");
await mkdir(frames, { recursive: true });
let filming = true;
let frameCount = 0;
const film = (async () => {
  await page.waitForSelector(".app-shell").catch(() => {});
  while (filming) {
    const file = path.join(frames, `frame-${String(frameCount).padStart(5, "0")}.jpg`);
    if (await page.screenshot({ path: file, type: "jpeg", quality: 75 }).then(() => true, () => false)) frameCount++;
    await pause(200);
  }
})();
const started = Date.now();
try {
  await page.waitForSelector(".app-shell");
  if ((await page.evaluate(() => document.documentElement.lang)) !== "en") {
    await page.locator(".titlebar-actions button:has(svg.lucide-settings2)").click();
    const settings = page.getByRole("dialog");
    await settings.locator("select").selectOption("en");
    await settings.getByRole("button", { name: "Done", exact: true }).click();
  }
  await app.evaluate(({ BrowserWindow, dialog }, file) => {
    BrowserWindow.getAllWindows()[0].maximize();
    (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: file });
    (dialog as any).showMessageBox = async () => ({ response: 2 });
  }, exported);
  await expect(page.locator(".tl-clip")).toHaveCount(13, { timeout: 30000 });
  steps.push("opened the demo project passed on the command line");
  await pause(2500);

  const ruler = (await page.locator(".tl-ruler-body").boundingBox())!;
  await page.mouse.click(ruler.x + 60, ruler.y + 15);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await pause(5000);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  steps.push("played the preview");
  await pause(1000);

  await page.locator(".tl-clip").nth(2).click();
  steps.push("selected a clip to show its inspector");
  await pause(2000);
  await page.screenshot({ path: path.join(output, "editor.png") });

  const fileMenu = page.locator(".file-menu-container > button");
  await fileMenu.click();
  await expect(page.locator(".file-menu")).toBeVisible();
  steps.push("opened the File menu with Ctrl shortcuts");
  await pause(2500);
  await page.screenshot({ path: path.join(output, "file-menu.png") });
  await fileMenu.click();
  await expect(page.locator(".file-menu")).toHaveCount(0);
  await page.mouse.click(ruler.x + 200, ruler.y + 15);
  await pause(800);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("menu-action", "about"));
  await expect(page.getByRole("dialog")).toBeVisible();
  steps.push("opened About");
  await pause(2500);
  await page.screenshot({ path: path.join(output, "about.png") });
  await page.keyboard.press("Escape");
  if (await page.getByRole("dialog").count()) await page.getByRole("dialog").locator("button").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await pause(600);

  await page.locator(".export-button").click();
  await pause(2000);
  await page.getByRole("button", { name: "Start export", exact: true }).click();
  await expect(page.getByText("Export complete", { exact: true })).toBeVisible({ timeout: 120000 });
  steps.push("exported the project with the bundled FFmpeg");
  await pause(2500);
  await page.screenshot({ path: path.join(output, "export-complete.png") });
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  steps.push(`FAILED: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  process.exitCode = 1;
} finally {
  filming = false;
  await film;
  const seconds = Math.max(1, (Date.now() - started) / 1000);
  await app.close().catch(() => {});
  // "q" lets FFmpeg finish the file instead of leaving a truncated recording.
  if (capture && capture.exitCode === null) {
    capture.stdin!.write("q");
    await Promise.race([captureDone, pause(15000)]);
    if (capture.exitCode === null) capture.kill();
  }
  if (recorder && frameCount > 1) {
    // Play the captures back at the pace they were taken.
    await run(["-y", "-framerate", (frameCount / seconds).toFixed(3), "-i", path.join(frames, "frame-%05d.jpg"),
      "-vf", "scale=1280:-2,fps=15", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(output, "window.mp4")]);
    await run(["-y", "-ss", "9", "-i", desktopVideo, "-frames:v", "1", path.join(output, "desktop.png")]);
  }
}
process.env.REACUT_FFPROBE = path.join(bundle, "resources", "media-tools", "ffprobe.exe");
const rendered = await probeFile(exported).catch(() => undefined);
const size = async (name: string) => (await stat(path.join(output, name)).catch(() => undefined))?.size ?? 0;
const summary = {
  recordedAt: new Date().toISOString(),
  application: bundle,
  steps,
  errors,
  exportedVideo: rendered && {
    duration: rendered.format.duration,
    streams: rendered.streams.map((stream) => `${stream.codec_type}:${stream.codec_name} ${stream.width ?? ""}x${stream.height ?? ""}`),
  },
  files: Object.fromEntries(await Promise.all(
    ["desktop.mp4", "desktop.png", "window.mp4", "editor.png", "file-menu.png", "about.png", "export-complete.png"]
      .map(async (name) => [name, await size(name)] as const),
  )),
  desktopCapture: captureLog.split(/\r?\n/).filter(Boolean).slice(-3),
};
await writeFile(path.join(output, "recording.json"), JSON.stringify(summary, null, 2) + "\n");
console.log("Windows demo recording:", JSON.stringify(summary, null, 2));
