// Ink drawings for "The Whale That Came Back Down" (text-free): the sperm whale (whole, leftover lump), dynamite
// boxes, the detonator plunger, the TV camera on its tripod, seagulls, blubber slabs, the blast column, stink lines,
// the ketchup packet (whole / squirting), a hard hat helper colour, the memorial whale statue.
import { Pen, INK, shade } from "../bridge/toon";

type P2 = [number, number];
const hh = (i: number) => { const v = Math.sin(i * 127.1) * 43758.5453; return v - Math.floor(v); };
const rr = (x0: number, y0: number, x1: number, y1: number, r: number): P2[] => {
  const pts: P2[] = [];
  for (const [cx, cy, a] of [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]] as const)
    for (let i = 0; i <= 6; i++) { const t = ((a + i * 15) * Math.PI) / 180; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return pts;
};

/** dead sperm whale lying on its side, side view, head (blocky) to the right, on a 2000 x 600 canvas (sand at y 590) */
export const whale = (p: Pen, col = "#6f7684", statue = false) => {
  const dark = shade(col, 0.72), belly = statue ? "#c9c2b0" : "#b9b7bd";
  const body: P2[] = [[60, 470], [140, 420], [420, 330], [900, 250], [1500, 180], [1880, 190], [1960, 260], [1970, 520], [1900, 590], [300, 590], [120, 560]];
  p.poly(body, col, 14);
  p.poly([[300, 585], [900, 520], [1500, 500], [1900, 560], [1900, 590], [300, 590]], belly, 0);
  for (let i = 0; i < 9; i++) { const x = 1000 + i * 90; p.stroke([[x, 520], [x + 50, 585]], 6, dark); } // throat grooves
  p.poly([[60, 470], [-10, 380], [40, 400], [90, 450]], col, 12);                                    // fluke
  p.poly([[60, 470], [10, 560], [60, 540], [110, 500]], dark, 12);
  p.ell(1210, 470, 110, 40, dark, 10, 0, 360, 20);                                                     // flipper
  if (!statue) { p.stroke([[1700, 320], [1740, 300]], 10, INK); p.stroke([[1700, 300], [1740, 320]], 10, INK); } // x eye
  else p.dot(1720, 310, 12, INK);
  for (let i = 0; i < 6; i++) p.ell(500 + i * 220 + 40 * hh(i), 330 - i * 20 + 20 * hh(i + 3), 22, 10, shade(col, 1.12), 0);
};
/** the leftover lump after the blast, 1200 x 500 */
export const lump = (p: Pen) => {
  p.poly([[60, 490], [120, 330], [300, 250], [520, 300], [700, 220], [960, 300], [1140, 420], [1160, 490]], "#7d6e72", 14);
  p.poly([[300, 420], [420, 350], [560, 400], [700, 330], [840, 400], [820, 470], [320, 470]], "#c98f8a", 9);
};
/** blubber slab / chunk, 400 x 300 (seed varies the outline) */
export const slab = (p: Pen, seed: number) => {
  const pts: P2[] = [];
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, r = 110 + 40 * hh(seed * 7 + i); pts.push([200 + r * 1.4 * Math.cos(a), 150 + r * 0.8 * Math.sin(a)]); }
  p.poly(pts, "#cfa39a", 10);
  p.poly(pts.map(([x, y]) => [200 + (x - 200) * 0.6, 150 + (y - 150) * 0.55 - 10] as P2), "#e8c2b8", 0);
  p.poly(pts.slice(0, 5), "#6f7684", 10);
};
/** wooden box of dynamite sticks (no labels), 500 x 360 */
export const dynamiteBox = (p: Pen) => {
  p.poly(rr(30, 140, 470, 340, 10), "#b58552", 10);
  p.stroke([[40, 200], [460, 200]], 6, "#8a6038");
  for (let i = 0; i < 6; i++) { const x = 80 + i * 66; p.poly(rr(x, 60, x + 50, 170, 18), "#d63a2e", 8); p.stroke([[x + 25, 60], [x + 35, 20]], 5, INK); }
};
/** T-handle detonator plunger box, 400 x 500; push 0..1 */
export const plunger = (p: Pen, push: number) => {
  const y = 80 + 140 * push;
  p.line([[200, y + 30], [200, 280]], "#8a8f98", 18);
  p.line([[110, y], [290, y]], "#3c3f44", 30);
  p.poly(rr(70, 260, 330, 480, 14), "#a8323a", 11);
  p.ell(140, 330, 18, 18, "#d9d9d9", 7); p.ell(260, 330, 18, 18, "#d9d9d9", 7);
  p.stroke([[330, 400], [400, 420]], 8, "#2a2c30");
};
/** 1970 TV news camera on a tripod, 500 x 900 (feet at the bottom) */
export const tvcam = (p: Pen) => {
  for (const [x1] of [[90], [250], [410]] as const) p.line([[250, 420], [x1, 890]], "#3c3f44", 14);
  p.poly(rr(110, 250, 390, 420, 18), "#2f3236", 11);
  p.poly(rr(390, 290, 470, 380, 10), "#55595f", 10);
  p.ell(470, 335, 22, 40, "#9fd0ea", 8);
  p.ell(170, 220, 60, 60, "#2f3236", 10); p.ell(310, 220, 60, 60, "#2f3236", 10);
  p.dot(170, 220, 14, "#8d93a0"); p.dot(310, 220, 14, "#8d93a0");
};
/** seagull flying, wings by phase, 400 x 220 */
export const gull = (p: Pen, phase: number) => {
  const w = Math.sin(phase * Math.PI * 2) * 70;
  p.line([[40, 110 - w], [140, 120 - w * 0.3], [200, 130]], "#f2f2f2", 26);
  p.line([[360, 110 - w], [260, 120 - w * 0.3], [200, 130]], "#e4e4e8", 26);
  p.ell(200, 140, 60, 26, "#ffffff", 8);
  p.ell(255, 128, 24, 20, "#ffffff", 8);
  p.poly([[275, 126], [305, 132], [275, 138]], "#f2b23a", 5);
  p.dot(262, 122, 5, INK);
  p.stroke([[40, 110 - w], [60, 112 - w]], 12, "#2a2a2a"); p.stroke([[360, 110 - w], [340, 112 - w]], 12, "#2a2a2a");
};
/** the blast: sand + smoke column with blubber bits, 800 x 1400 (base at the bottom), t 0..1 */
export const blast = (p: Pen, t: number) => {
  const h = 1350 * Math.min(1, t * 2.2), wTop = 220 + 300 * t, fade = 1 - Math.max(0, t - 0.6) / 0.4;
  if (fade <= 0) return;
  const g = p.g; g.globalAlpha = fade;
  for (let i = 0; i < 9; i++) {
    const y = 1390 - (h * i) / 8, w = 140 + (wTop - 140) * (i / 8), x = 400 + 40 * Math.sin(i * 1.7);
    p.ell(x, y, w * (0.8 + 0.2 * hh(i)), w * 0.55, i % 2 ? "#e7cf9c" : "#cdb07c", 0);
  }
  p.ell(400, 1390 - h, wTop, wTop * 0.6, "#8f8c96", 0);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, d = 0.4 * wTop + 0.6 * wTop * t; p.ell(400 + d * Math.cos(a), 1390 - h + d * 0.6 * Math.sin(a), 30, 20, "#cfa39a", 7); }
  g.globalAlpha = 1;
};
/** wavy stink lines, 300 x 400 */
export const stink = (p: Pen, t: number) => {
  for (let k = 0; k < 3; k++) {
    const x = 70 + k * 80, pts: P2[] = [];
    for (let i = 0; i <= 10; i++) pts.push([x + 18 * Math.sin(i * 0.9 + t * 6 + k), 380 - i * 34]);
    p.stroke(pts, 12, "#8fbf5a");
  }
};
/** ketchup packet lying flat (top-down), 800 x 500; squish 0..1 squirts out the right edge */
export const ketchup = (p: Pen, squish: number) => {
  const nip = 380 * squish;
  if (squish > 0) {
    p.poly([[600, 220], [600 + nip, 160], [640 + nip, 250], [600 + nip, 330], [600, 280]], "#d42f2f", 9);
    for (let i = 0; i < 4; i++) p.ell(640 + nip * (0.5 + 0.15 * i), 120 + 90 * i, 18, 14, "#d42f2f", 6);
  }
  p.poly(rr(120, 140 + 20 * squish, 620, 360 - 20 * squish, 18), "#ffffff", 10);
  p.poly(rr(150, 170 + 20 * squish, 590, 330 - 20 * squish, 12), "#e0352e", 0);
  p.ell(300, 250, 60, 40, "#ff8a7a", 0);
};
/** big shoe coming down (side view), 600 x 400 */
export const shoe = (p: Pen) => {
  p.poly([[60, 300], [80, 160], [260, 120], [330, 200], [540, 230], [570, 300]], "#5a3b2a", 12);
  p.poly(rr(50, 300, 580, 350, 16), "#2a2730", 10);
  p.line([[120, 60], [120, 150]], "#3b3f52", 120, false);
};
/** up arrow (for the explanation), 300 x 600 */
export const arrowUp = (p: Pen, col = "#ffd23a") => {
  p.poly([[150, 30], [280, 220], [195, 220], [195, 570], [105, 570], [105, 220], [20, 220]], col, 14);
};
/** short sand mound (the buried leftovers), 1200 x 300 */
export const mound = (p: Pen) => {
  p.poly([[20, 290], [200, 150], [600, 90], [1000, 150], [1180, 290]], "#e2c992", 12);
  for (let i = 0; i < 8; i++) p.stroke([[150 + i * 120, 230 - 40 * Math.sin(i)], [190 + i * 120, 220 - 40 * Math.sin(i)]], 6, "#c9ae76");
};
/** shovel, 200 x 700 */
export const shovel = (p: Pen) => {
  p.line([[100, 30], [100, 520]], "#a8724a", 18);
  p.poly([[50, 510], [150, 510], [140, 650], [100, 690], [60, 650]], "#9aa0aa", 10);
};
