import { createCanvas, Path2D } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve("build");
await mkdir(path.join(root, "icon.iconset"), { recursive: true });
await mkdir(path.resolve("public/icons"), { recursive: true });
// JG monogram drawn as two round-capped strokes: a J with a top bar and an open G with its crossbar.
const letters = "M 272 334 L 372 334 L 372 605 A 85 85 0 0 1 202 605 M 784 402 A 178 178 0 1 0 822 512 L 668 512";
const strokeWidth = 84;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="202" y1="292" x2="822" y2="732">
    <stop stop-color="#98f9e5"/><stop offset="1" stop-color="#45d6c0"/>
  </linearGradient></defs>
  <rect x="45" y="45" width="934" height="934" rx="205" fill="#14191d"/>
  <path d="${letters}" fill="none" stroke="url(#ink)" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
await writeFile(path.resolve("public/icons/jgcut.svg"), svg);
function icon(size: number): Buffer {
  const canvas = createCanvas(size, size), ctx = canvas.getContext("2d");
  ctx.scale(size / 1024, size / 1024);
  ctx.fillStyle = "#14191d";
  ctx.beginPath(); ctx.roundRect(45, 45, 934, 934, 205); ctx.fill();
  const color = ctx.createLinearGradient(202, 292, 822, 732);
  color.addColorStop(0, "#98f9e5"); color.addColorStop(1, "#45d6c0");
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(letters));
  return canvas.toBuffer("image/png");
}
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  const bytes = icon(size);
  if (size === 512) {
    await writeFile(path.join(root, "icon.png"), bytes);
    await writeFile(path.resolve("public/icons/jgcut.png"), bytes);
  }
  if (size <= 512) {
    await writeFile(
      path.join(root, "icon.iconset", `icon_${size}x${size}.png`),
      bytes,
    );
    await writeFile(
      path.join(root, "icon.iconset", `icon_${size}x${size}@2x.png`),
      icon(size * 2),
    );
  }
}
const images = [16, 32, 48, 64, 128, 256].map((size) => ({
    size,
    bytes: icon(size),
  })),
  header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, bytes }, i) => {
  const at = 6 + i * 16;
  header[at] = size === 256 ? 0 : size;
  header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(bytes.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += bytes.length;
});
await writeFile(
  path.join(root, "icon.ico"),
  Buffer.concat([header, ...images.map((image) => image.bytes)]),
);
if (process.platform === "darwin") {
  const result = spawnSync(
    "iconutil",
    [
      "-c",
      "icns",
      path.join(root, "icon.iconset"),
      "-o",
      path.join(root, "icon.icns"),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("iconutil failed");
} else {
  // Without iconutil, write the same PNG-based ICNS container directly.
  const entries = ([["icp4", 16], ["icp5", 32], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024],
    ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512]] as const).map(([type, size]) => {
    const bytes = icon(size), head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(bytes.length + 8, 4);
    return Buffer.concat([head, bytes]);
  });
  const file = Buffer.alloc(8);
  file.write("icns", 0, "ascii");
  file.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  await writeFile(path.join(root, "icon.icns"), Buffer.concat([file, ...entries]));
}
console.log("Generated JGcut icons in build/ and public/icons/");
