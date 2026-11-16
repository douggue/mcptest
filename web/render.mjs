// Renders one short (or a still frame) from a spec file. Called by the Python server:
//   node render.mjs --spec spec.json --out out.mp4 [--still 45] [--scale 1] [--crf 18]
// Prints one JSON object per line on stdout: {"stage": "...", "progress": 0..1}
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function sourceHash() {
  const dir = path.join(here, 'src', 'remotion');
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(dir).sort()) {
    const st = fs.statSync(path.join(dir, f));
    h.update(`${f}:${st.size}:${st.mtimeMs}`);
  }
  return h.digest('hex').slice(0, 12);
}

async function getBundle() {
  const root = path.join(here, '.bundle');
  const dir = path.join(root, sourceHash());
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  fs.rmSync(root, { recursive: true, force: true }); // drop stale bundles
  say({ stage: 'Preparing renderer', progress: 0 });
  await bundle({
    entryPoint: path.join(here, 'src', 'remotion', 'index.ts'),
    outDir: dir,
    onProgress: (p) => say({ stage: 'Preparing renderer', progress: (p / 100) * 0.1 }),
  });
  return dir;
}

const spec = JSON.parse(fs.readFileSync(args.spec, 'utf8'));
const serveUrl = await getBundle();
const inputProps = { spec };
const browserExecutable = process.env.CUTROOM_CHROME || undefined;
const chromiumOptions = { gl: process.env.CUTROOM_GL || undefined };
const composition = await selectComposition({ serveUrl, id: 'Short', inputProps, browserExecutable, chromiumOptions });

if (args.still !== undefined) {
  await renderStill({
    composition, serveUrl, inputProps, output: args.out, browserExecutable, chromiumOptions,
    frame: Math.min(composition.durationInFrames - 1, Math.max(0, Number(args.still) || 0)),
    imageFormat: 'jpeg', jpegQuality: 90, scale: Number(args.scale || 1),
  });
} else {
  await renderMedia({
    composition, serveUrl, inputProps, outputLocation: args.out, browserExecutable, chromiumOptions,
    codec: 'h264', crf: Number(args.crf || 18), pixelFormat: 'yuv420p', scale: Number(args.scale || 1),
    concurrency: Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2))),
    onProgress: ({ progress, stitchStage }) =>
      say({ stage: stitchStage === 'muxing' ? 'Encoding' : 'Rendering frames', progress: 0.1 + progress * 0.9 }),
  });
}
say({ stage: 'Done', progress: 1 });
