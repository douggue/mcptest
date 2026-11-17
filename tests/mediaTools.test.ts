import { afterAll, beforeAll, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveMediaTool } from "../electron/mediaTools";

// PATH syntax and executable names follow the host: a Windows PATH cannot be parsed as a POSIX one.
const platform = process.platform === "win32" ? "win32" : "darwin";
const file = (name: string) => (platform === "win32" ? `${name}.exe` : name);
let directory: string, bundledDirectory: string, system: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "reacut-tools-"));
  bundledDirectory = path.join(directory, "App with spaces.app", "media-tools");
  system = path.join(directory, "system");
  for (const folder of [bundledDirectory, system]) {
    await mkdir(folder, { recursive: true });
    for (const tool of ["ffmpeg", "ffprobe"]) {
      await writeFile(path.join(folder, file(tool)), "#!/bin/sh\nexit 0\n");
      await chmod(path.join(folder, file(tool)), 0o755);
    }
  }
});
afterAll(() => rm(directory, { recursive: true, force: true }));
it("uses both bundled tools even with a competing PATH", async () => {
  for (const name of ["ffmpeg", "ffprobe"] as const)
    expect(await resolveMediaTool(name, { platform, bundledDirectory, env: { PATH: system } }))
      .toBe(path.join(bundledDirectory, file(name)));
});
it("keeps an explicit user override ahead of the bundled tool", async () => {
  const override = path.join(system, file("ffmpeg"));
  expect(await resolveMediaTool("ffmpeg", { platform, bundledDirectory, env: { REACUT_FFMPEG: override } })).toBe(override);
});
it("reports a damaged bundle instead of silently using system tools", async () => {
  await expect(resolveMediaTool("ffprobe", { platform, bundledDirectory: path.join(directory, "missing"), env: { PATH: system } }))
    .rejects.toThrow("内置 ffprobe");
});
it("does not hide a stale explicit override with the bundled tool", async () => {
  await expect(resolveMediaTool("ffmpeg", { platform, bundledDirectory, env: { REACUT_FFMPEG: directory } }))
    .rejects.toThrow("所选 ffmpeg");
});
it("retains PATH discovery for source development", async () => {
  expect(await resolveMediaTool("ffmpeg", { platform, env: { PATH: system } })).toBe(path.join(system, file("ffmpeg")));
});
it("resolves the .exe tools shipped by the Windows installer ahead of PATH", async () => {
  const windows = path.join(directory, "JGcut", "resources", "media-tools");
  await mkdir(windows, { recursive: true });
  for (const tool of ["ffmpeg.exe", "ffprobe.exe"]) await writeFile(path.join(windows, tool), "");
  for (const name of ["ffmpeg", "ffprobe"] as const)
    expect(await resolveMediaTool(name, { platform: "win32", bundledDirectory: windows, env: { PATH: system } }))
      .toBe(path.join(windows, `${name}.exe`));
  await expect(resolveMediaTool("ffmpeg", { platform: "win32", bundledDirectory: path.join(directory, "missing"), env: { PATH: system } }))
    .rejects.toThrow("内置 ffmpeg");
});
