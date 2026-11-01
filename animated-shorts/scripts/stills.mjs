// Look-check stills: node scripts/stills.mjs <outPrefix> <frame,frame,...> [scale]
// Bundles once, then renders each frame as a jpeg. Env: COMP (default ScorchShort), GL (default "angle": uses your GPU
// on Windows; use "swangle" on a machine without a GPU), CHROME (optional browser path), DPR (e.g. 0.5 for quick drafts).
import fs from "node:fs";
import path from "node:path";
// every Remotion bundle copies public/ into the temp folder: point REMOTION_TMP at a big drive if C: is small
if (process.env.REMOTION_TMP) { fs.mkdirSync(process.env.REMOTION_TMP, { recursive: true }); process.env.TEMP = process.env.TMP = process.env.REMOTION_TMP; }
const { bundle } = await import("@remotion/bundler");
const { renderStill, selectComposition } = await import("@remotion/renderer");
const [prefix = "out/stills/s_", frames = "60", scale = "0.5"] = process.argv.slice(2);
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const chromiumOptions = { gl: process.env.GL || "angle" };
const browserExecutable = process.env.CHROME || null;
const inputProps = process.env.DPR ? { post: { dpr: Number(process.env.DPR) } } : {};
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), publicDir: path.resolve("public") });
const composition = await selectComposition({ serveUrl, id: process.env.COMP || "ScorchShort", browserExecutable, chromiumOptions, inputProps });
for (const f of frames.split(",").map(Number)) {
  const t0 = Date.now();
  await renderStill({ composition, serveUrl, frame: f, output: `${prefix}${f}.jpg`, imageFormat: "jpeg", jpegQuality: 88, scale: Number(scale),
    inputProps, browserExecutable, chromiumOptions, timeoutInMilliseconds: 600000,
    onBrowserLog: (l) => { if (l.type === "error" && !l.text.includes("404")) console.log("[browser]", l.text.slice(0, 300)); } });
  console.log("still", f, ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
