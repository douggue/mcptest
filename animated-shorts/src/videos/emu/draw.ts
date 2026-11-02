// Ink drawings for the Emu War (all text-free): the emu (walk / run / eat poses, expressions, lookout, helmet), the
// 1930s truck, the Lewis gun, ammo crates, gum trees, the tally board, a crosshair, feather puffs, speed lines.
// Emus use the character design space (600 x 1000, soles at y = 975) so they share the cast's scale and card geometry.
import { Pen, INK, mix, shade } from "../bridge/toon";

type P2 = [number, number];
const hh = (i: number) => { const v = Math.sin(i * 127.1) * 43758.5453; return v - Math.floor(v); };
const curve = (a: P2, k: P2, b: P2, n = 12): P2[] => {
  const c: P2 = [2 * k[0] - (a[0] + b[0]) / 2, 2 * k[1] - (a[1] + b[1]) / 2], out: P2[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n, s = 1 - t; out.push([s * s * a[0] + 2 * s * t * c[0] + t * t * b[0], s * s * a[1] + 2 * s * t * c[1] + t * t * b[1]]); }
  return out;
};
const rr = (x0: number, y0: number, x1: number, y1: number, r: number): P2[] => {
  const pts: P2[] = [];
  for (const [cx, cy, a] of [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]] as const)
    for (let i = 0; i <= 6; i++) { const t = ((a + i * 15) * Math.PI) / 180; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return pts;
};

export type EmuOpts = {
  phase?: number; mode?: "stand" | "walk" | "run" | "eat"; expr?: "normal" | "wide" | "dazed" | "smug" | "blink";
  col?: number; lookout?: boolean; hat?: null | "helmet" | "cap"; hit?: number;
};
/** emu side view facing screen-right in the 600 x 1000 design space */
export const emu = (p: Pen, o: EmuOpts) => {
  const { phase = 0, mode = "stand", expr = "normal", col = 0, lookout = false, hat = null, hit = 0 } = o;
  const body = lookout ? "#2a2326" : ["#6b5440", "#5d4a3a", "#7a6048"][col % 3], dark = shade(body, 0.7);
  const legC = "#8d8f9c", two = Math.PI * 2;
  const amp = mode === "run" ? 1 : mode === "walk" ? 0.45 : 0;
  const bob = mode === "run" ? 22 * Math.abs(Math.sin(two * phase)) : mode === "walk" ? 8 * Math.abs(Math.sin(two * phase)) : 0;
  const lean = mode === "run" ? 0.18 : mode === "eat" ? 0.12 : 0;
  const hip: P2 = [290, 600 - bob];
  // legs: two-bone, knee bends backward (bird), feet swing with the phase
  for (const k of [0, 1]) {
    const ph = two * (phase + k * 0.5), sw = Math.sin(ph) * 150 * amp, lift = Math.max(0, Math.cos(ph)) * 70 * amp;
    const foot: P2 = [hip[0] + sw, 975 - lift], knee: P2 = [(hip[0] + foot[0]) / 2 + 40, (hip[1] + foot[1]) / 2 - 10];
    const c = k ? shade(legC, 0.8) : legC;
    p.line([hip, knee, foot], c, 20);
    p.line([[foot[0] - 30, foot[1]], [foot[0] + 50, foot[1] + 2]], c, 14);
    p.line([[foot[0], foot[1]], [foot[0] + 40, foot[1] - 18]], c, 10);
  }
  p.rot = [lean, hip[0], hip[1]];
  // shaggy body
  const pts: P2[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * two, j = i % 2 ? 1 : 1.08 + 0.05 * hh(i + col);
    const ry = a > 0 && a < Math.PI ? 150 * j : 130;
    pts.push([hip[0] - 10 + 200 * Math.cos(a) * (Math.cos(a) < 0 ? j : 1), hip[1] - 70 + ry * Math.sin(a)]);
  }
  p.poly(pts, body, 12);
  for (let i = 0; i < 9; i++) { const x = hip[0] - 150 + i * 34, y = hip[1] - 40 + 60 * hh(i + 3); p.stroke([[x, y], [x - 22, y + 50]], 7, dark); }
  // neck + head
  const eat = mode === "eat";
  const nb: P2 = [hip[0] + 150, hip[1] - 150], hd: P2 = eat ? [hip[0] + 300, 900] : [hip[0] + 205 + 10 * amp, hip[1] - 420 + (lookout ? -60 : 0)];
  const nk: P2 = eat ? [hip[0] + 300, hip[1] - 120] : [hip[0] + 190, hip[1] - 300];
  p.line(curve(nb, nk, hd), "#7d8fae", 46);
  p.line(curve(nb, [nb[0] + (nk[0] - nb[0]) * 0.4, nb[1] + (nk[1] - nb[1]) * 0.4], [nb[0] + (nk[0] - nb[0]) * 0.7, nb[1] + (nk[1] - nb[1]) * 0.7]), body, 60, false);
  p.rot = [lean, hip[0], hip[1]];
  const [hx, hy] = hd;
  p.ell(hx, hy, 50, 42, "#7d8fae", 11);
  p.poly([[hx + 40, hy - 8], [hx + 108, hy + 6], [hx + 40, hy + 18]], "#5a5560", 9);
  // eye
  if (expr === "blink") p.stroke([[hx - 4, hy - 8], [hx + 26, hy - 8]], 9, INK);
  else if (expr === "dazed") { p.ell(hx + 12, hy - 8, 20, 20, "#ffffff", 7); p.arc(hx + 12, hy - 8, 10, 10, 0, 300, 5, INK); }
  else {
    const r = expr === "wide" ? 24 : 18;
    p.ell(hx + 12, hy - 8, r, r, "#f4e9c8", 7);
    p.dot(hx + 16, hy - 8, expr === "wide" ? 6 : 9, INK);
    if (expr === "smug") p.stroke([[hx - 10, hy - 22], [hx + 34, hy - 16]], 9, INK);
  }
  if (hat === "helmet") {
    p.ell(hx, hy - 34, 66, 16, "#7d7650", 9);
    p.ell(hx, hy - 44, 46, 34, "#8a8458", 9, 180, 360);
  } else if (hat === "cap") {
    p.poly([[hx - 46, hy - 32], [hx + 40, hy - 40], [hx + 30, hy - 78], [hx - 36, hy - 74]], "#8a7a4f", 9);
    p.poly([[hx + 36, hy - 42], [hx + 86, hy - 38], [hx + 40, hy - 30]], "#6f6343", 8);
  }
  if (hit > 0) { // a few loose feathers where the bullet hit
    for (let i = 0; i < 4; i++) { const a = -1.2 + i * 0.5, d = 60 + 160 * hit; p.ell(hip[0] - 40 + d * Math.cos(a), hip[1] - 120 + d * Math.sin(a), 26, 9, body, 5, 0, 360, 30 * i); }
  }
  p.rot = null;
};

/** 1930s flatbed truck, side view, nose right, on a 1600 x 800 canvas (wheels on y = 760) */
export const truck = (p: Pen, col = "#5f7a52") => {
  const dark = shade(col, 0.72);
  p.poly(rr(140, 470, 1080, 560, 12), "#8a6a48", 10);                         // flatbed
  for (let x = 170; x < 1060; x += 90) p.stroke([[x, 480], [x, 552]], 5, "#6d5236");
  p.poly([[1080, 300], [1300, 300], [1330, 420], [1480, 450], [1500, 600], [1080, 600]], col, 12); // cab + bonnet
  p.poly([[1110, 330], [1270, 330], [1290, 420], [1110, 420]], "#bfe0ea", 9);
  for (let k = 0; k < 4; k++) p.stroke([[1360 + k * 30, 470], [1360 + k * 30, 560]], 6, dark); // bonnet vents
  p.poly(rr(1460, 470, 1520, 540, 10), "#e9e2c8", 8);                          // lamp
  for (const x of [330, 1300]) {
    p.ell(x, 640, 140, 70, dark, 10, 180, 360);                                 // mudguard
    p.ell(x, 680, 92, 92, "#2a2730", 12);
    p.ell(x, 680, 48, 48, "#c9b98f", 9);
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; p.stroke([[x, 680], [x + 44 * Math.cos(a), 680 + 44 * Math.sin(a)]], 6, "#8d7c55"); }
  }
};

/** Lewis gun on its bipod, side view, muzzle right, on an 800 x 320 canvas; flash = muzzle flash; jam = smoke puff */
export const lewis = (p: Pen, flash: boolean, jam = false) => {
  p.line([[120, 170], [330, 160]], "#6d5236", 34);                              // stock
  p.poly(rr(300, 120, 640, 200, 30), "#3c3f44", 11);                            // cooling shroud
  for (let x = 330; x < 630; x += 26) p.stroke([[x, 128], [x, 192]], 4, "#2a2c30");
  p.line([[640, 160], [740, 158]], "#2a2c30", 18);                              // barrel
  p.ell(400, 112, 110, 26, "#2f3236", 10);                                      // drum magazine
  p.ell(400, 104, 30, 10, "#55595f", 0);
  p.line([[600, 200], [560, 300]], "#2a2c30", 10); p.line([[600, 200], [650, 300]], "#2a2c30", 10); // bipod
  if (flash) {
    const pts: P2[] = [];
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, r = i % 2 ? 26 : 62; pts.push([770 + r * Math.cos(a), 158 + r * Math.sin(a) * 0.7]); }
    p.poly(pts, "#ffd23a", 7); p.ell(770, 158, 20, 14, "#fff8d8", 0);
  }
  if (jam) { p.ell(700, 90, 40, 32, "rgba(150,150,160,0.9)", 0); p.ell(740, 60, 30, 26, "rgba(170,170,180,0.8)", 0); }
};

/** stack of ammo crates (no stencils) on a 600 x 400 canvas */
export const crates = (p: Pen, n = 3) => {
  const boxes: [number, number][] = [[40, 230], [300, 230], [170, 70]].slice(0, n) as [number, number][];
  for (const [x, y] of boxes) {
    p.poly(rr(x, y, x + 260, y + 160, 8), "#6f6a3e", 10);
    p.stroke([[x + 10, y + 50], [x + 250, y + 50]], 6, "#55512e"); p.stroke([[x + 10, y + 110], [x + 250, y + 110]], 6, "#55512e");
    p.poly(rr(x + 105, y + 66, x + 155, y + 94, 6), "#c9b98f", 6);
  }
};

/** eucalyptus (gum tree) on a 900 x 1400 canvas, base at the bottom centre */
export const gum = (p: Pen, seed: number) => {
  const lean = (hh(seed) - 0.5) * 80;
  p.line([[450, 1390], [440 + lean * 0.3, 900], [450 + lean, 560]], "#e8e2d6", 70);
  p.line([[440 + lean * 0.3, 900], [300, 640]], "#e8e2d6", 34);
  p.line([[450 + lean * 0.6, 760], [620, 560]], "#e8e2d6", 30);
  for (let k = 0; k < 4; k++) p.stroke([[430 + lean * 0.2, 1300 - k * 140], [460 + lean * 0.2, 1250 - k * 140]], 6, "#b8ad9a");
  const blobs: [number, number, number][] = [[300, 520, 150], [470 + lean, 420, 190], [640, 520, 150], [400, 330, 130], [560, 300, 120]];
  for (const [x, y, r] of blobs) p.ell(x, y, r * (0.9 + 0.2 * hh(seed + x)), r * 0.75, ["#7d9566", "#6e8a5c", "#8aa173"][(x + seed) % 3], 10);
};

/** tally board (wooden board on legs) with n tally groups of five, on a 700 x 600 canvas */
export const tally = (p: Pen, n: number) => {
  p.line([[140, 590], [170, 380]], "#6d5236", 18); p.line([[560, 590], [530, 380]], "#6d5236", 18);
  p.poly(rr(60, 40, 640, 420, 16), "#c9a774", 12);
  for (let g = 0; g < n; g++) {
    const x0 = 100 + (g % 6) * 88, y0 = 80 + Math.floor(g / 6) * 110;
    for (let k = 0; k < 4; k++) p.stroke([[x0 + k * 16, y0], [x0 + k * 16, y0 + 80]], 8, INK);
    p.stroke([[x0 - 10, y0 + 70], [x0 + 64, y0 + 10]], 8, "#b8322f");
  }
};
/** a single bullet (cartridge) standing, 120 x 300 */
export const bullet = (p: Pen) => {
  p.poly(rr(20, 110, 100, 290, 10), "#d9a441", 8);
  p.poly([[20, 112], [60, 10], [100, 112]], "#b07a3a", 8);
};

/** red crosshair on a 400 x 400 canvas */
export const crosshair = (p: Pen) => {
  p.ell(200, 200, 150, 150, null, 0);
  const g = p.g; g.beginPath(); g.arc(200, 200, 150, 0, Math.PI * 2); g.strokeStyle = "#ffffff"; g.lineWidth = 26; g.stroke();
  g.beginPath(); g.arc(200, 200, 150, 0, Math.PI * 2); g.strokeStyle = "#d42f2f"; g.lineWidth = 14; g.stroke();
  for (const [a, b] of [[[200, 20], [200, 120]], [[200, 280], [200, 380]], [[20, 200], [120, 200]], [[280, 200], [380, 200]]] as [P2, P2][]) { p.stroke([a, b], 24, "#ffffff"); p.stroke([a, b], 12, "#d42f2f"); }
};

/** speed lines (motion streaks trailing left) on a 600 x 300 canvas */
export const speed = (p: Pen) => {
  for (let i = 0; i < 6; i++) { const y = 40 + i * 44, l = 200 + 200 * hh(i); p.stroke([[560 - l, y], [560, y]], 9, "rgba(255,255,255,0.9)"); }
};
/** dust cloud kicked up by running feet / the truck, 300 x 300; t 0..1 */
export const dust = (p: Pen, t: number) => {
  for (let i = 0; i < 5; i++) {
    const a = ((160 + i * 55) * Math.PI) / 180, d = 30 + 60 * t, r = (36 + 16 * (i % 2)) * (0.6 + 0.6 * t);
    p.ell(150 + d * Math.cos(a), 190 + d * 0.4 * Math.sin(a), r, r * 0.8, `rgba(214,184,138,${((1 - t) * 0.9).toFixed(3)})`, 0);
  }
};
export { mix };
