import { afterEach, expect, it } from "vitest";
import { findHardwareEncoder, hardwareEncoderArguments } from "../electron/hardwareEncoders";

afterEach(() => { delete process.env.REACUT_HARDWARE_ENCODER; });
it("selects each graphics-card encoder with a quality setting per export preset", () => {
  for (const encoder of ["h264_nvenc", "h264_amf", "h264_mf"] as const) {
    const levels = (["draft", "standard", "high"] as const).map((quality) => hardwareEncoderArguments(encoder, quality));
    for (const args of levels) expect(args.slice(0, 2)).toEqual(["-c:v", encoder]);
    expect(new Set(levels.map((args) => args.join(" "))).size).toBe(3);
  }
  expect(hardwareEncoderArguments("h264_mf", "standard")).toContain("-hw_encoding");
});
it("honours an explicit encoder choice and ignores unknown names", async () => {
  process.env.REACUT_HARDWARE_ENCODER = "h264_amf";
  expect(await findHardwareEncoder()).toBe("h264_amf");
  process.env.REACUT_HARDWARE_ENCODER = "libx264";
  expect(await findHardwareEncoder()).toBeUndefined();
});
it.skipIf(process.platform === "win32")("offers no graphics-card encoder outside Windows", async () => {
  expect(await findHardwareEncoder()).toBeUndefined();
});
