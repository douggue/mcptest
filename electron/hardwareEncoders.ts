import { runMediaTool } from "./media";
import type { ExportOptions } from "../src/core/types";

/** H.264 encoders that run on the graphics card: NVIDIA, AMD, then whatever Windows itself offers
 * through Media Foundation (which is how Intel graphics are reached). */
export type HardwareEncoder = "h264_nvenc" | "h264_amf" | "h264_mf";
const candidates: HardwareEncoder[] = ["h264_nvenc", "h264_amf", "h264_mf"];

/** Encoder arguments at quality levels chosen to sit near the software draft / standard / high presets. */
export function hardwareEncoderArguments(encoder: HardwareEncoder, quality: ExportOptions["quality"]): string[] {
  const level = { draft: 0, standard: 1, high: 2 }[quality];
  if (encoder === "h264_nvenc")
    return ["-c:v", "h264_nvenc", "-preset", ["p3", "p5", "p7"][level], "-rc", "vbr", "-cq", ["30", "24", "19"][level], "-b:v", "0"];
  if (encoder === "h264_amf") {
    const quantizer = ["30", "24", "19"][level];
    return ["-c:v", "h264_amf", "-quality", ["speed", "balanced", "quality"][level], "-rc", "cqp", "-qp_i", quantizer, "-qp_p", quantizer, "-qp_b", quantizer];
  }
  return ["-c:v", "h264_mf", "-hw_encoding", "1", "-rate_control", "quality", "-quality", ["45", "65", "85"][level]];
}

let probe: Promise<HardwareEncoder | undefined> | undefined;
/** The first encoder that really encodes a few frames on this machine. Being compiled into FFmpeg
 * says nothing about the driver or card, so each candidate is tried once per session. */
export function findHardwareEncoder(): Promise<HardwareEncoder | undefined> {
  const forced = process.env.REACUT_HARDWARE_ENCODER;
  if (forced !== undefined)
    return Promise.resolve(candidates.find((candidate) => candidate === forced));
  if (process.platform !== "win32") return Promise.resolve(undefined);
  probe ??= (async () => {
    for (const encoder of candidates) {
      try {
        await runMediaTool("ffmpeg", [
          "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=640x360:r=30", "-frames:v", "8",
          ...hardwareEncoderArguments(encoder, "standard"), "-pix_fmt", "yuv420p", "-f", "null", "-",
        ], 20_000);
        return encoder;
      } catch { /* Not usable here; try the next one. */ }
    }
    return undefined;
  })();
  return probe;
}
