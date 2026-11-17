import { expect, it } from "vitest";
import { exportPresetOptions } from "../src/core/exportPresets";

it("scales the short side to 1080 while keeping the canvas shape", () => {
  expect(exportPresetOptions({ width: 1280, height: 720, fps: 30 }, "youtube")).toEqual({ width: 1920, height: 1080, fps: 30, quality: "high", format: "mp4", fits: true });
  expect(exportPresetOptions({ width: 720, height: 1280, fps: 60 }, "vertical")).toEqual({ width: 1080, height: 1920, fps: 30, quality: "standard", format: "mp4", fits: true });
  expect(exportPresetOptions({ width: 1080, height: 1350, fps: 25 }, "feed")).toMatchObject({ width: 1080, height: 1350, fits: true });
  expect(exportPresetOptions({ width: 1000, height: 1000, fps: 24 }, "feed")).toMatchObject({ width: 1080, height: 1080, fits: true });
});
it("reports a canvas that is the wrong shape for the destination and caps the frame rate", () => {
  expect(exportPresetOptions({ width: 1920, height: 1080, fps: 30 }, "vertical")).toMatchObject({ width: 1920, height: 1080, fits: false });
  expect(exportPresetOptions({ width: 3840, height: 2160, fps: 120 }, "youtube")).toMatchObject({ width: 1920, height: 1080, fps: 60, fits: true });
  expect(exportPresetOptions({ width: 1281, height: 721, fps: 30 }, "youtube").width % 2).toBe(0);
});
