// Ink drawings for the Pisa short: the tower's face (the protagonist), the arcade texture, cutaway diagrams
// (foundation; drilling), the chair gag, calendar pages, the banana, the protractor, the closed sign, buckets,
// nest, cobweb, zzz, ripple rings, sparkle, crash stars. Plum ink, flat fills, soft gradients.
import { Pen, INK, shade, mix } from "../bridge/toon";

type P2 = [number, number];
const hh = (i: number) => { const v = Math.sin(i * 127.1) * 43758.5453; return v - Math.floor(v); };
const rr = (x0: number, y0: number, x1: number, y1: number, r: number): P2[] => {
  const pts: P2[] = [];
  for (const [cx, cy, a] of [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]] as const)
    for (let i = 0; i <= 6; i++) { const t = ((a + i * 15) * Math.PI) / 180; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return pts;
};

export type FaceExpr = "proud" | "smile" | "worried" | "shock" | "sleep" | "embarrassed" | "sweat" | "relief" | "wink" | "grin" | "squint";
/** the tower's face on a 1000 x 700 canvas (drawn straight onto the marble: no head outline). lid 0..1 blinks. */
export const towerFace = (p: Pen, e: FaceExpr, lid = 0, look = 0) => {
  const g = p.g, ex = 290, ey = 260, gap = 210;
  const brows: Record<FaceExpr, number> = { proud: -10, smile: -6, worried: 18, shock: -30, sleep: 0, embarrassed: 14, sweat: 20, relief: -4, wink: -8, grin: -8, squint: 10 };
  const b = brows[e];
  for (const s of [-1, 1]) {
    const cx = 500 + s * gap, wink = e === "wink" && s > 0, shut = e === "sleep" || wink || lid > 0.6 || e === "relief" || e === "squint";
    // brows (worried: inner ends up)
    p.stroke([[cx - 70, ey - 120 + (s < 0 ? b : -b) * 0.6], [cx + 70, ey - 120 - (s < 0 ? b : -b) * 0.6]], 22, INK);
    if (shut) {
      const happy = e === "relief" || wink || e === "squint";
      p.arc(cx, ey + (happy ? 10 : 0), 60, happy ? 34 : 6, happy ? 200 : 0, happy ? 340 : 180, 18, INK);
    } else {
      const r = e === "shock" ? 82 : 70, ry = r * (1 - 0.8 * lid);
      p.ell(cx, ey, r * 0.86, ry, "#ffffff", 14);
      p.ell(cx + 14 * look, ey + 6, (e === "shock" ? 20 : 30), (e === "shock" ? 20 : 30) * (1 - 0.8 * lid), INK, 0);
      p.ell(cx + 14 * look - 9, ey - 6, 9, 8 * (1 - lid), "#ffffff", 0);
    }
  }
  // mouth
  const my = 470;
  switch (e) {
    case "proud": case "smile": case "relief": p.arc(500, my - 40, 120, 70, 20, 160, 22, INK); break;
    case "grin": case "wink": p.poly([[380, my - 30], [620, my - 30], [590, my + 40], [500, my + 70], [410, my + 40]], "#7a2430", 18); p.poly([[400, my - 26], [600, my - 26], [590, my - 4], [410, my - 4]], "#ffffff", 0); break;
    case "worried": case "sweat": { const pts: P2[] = []; for (let i = 0; i <= 8; i++) pts.push([400 + i * 25, my + (i % 2 ? -14 : 14)]); p.stroke(pts, 18, INK); break; }
    case "shock": p.ell(500, my + 10, 60, 80, "#7a2430", 18); break;
    case "sleep": p.ell(500, my, 26, 18, "#7a2430", 12); break;
    case "embarrassed": p.arc(500, my + 30, 80, 30, 200, 340, 18, INK); for (const s of [-1, 1]) for (let k = 0; k < 3; k++) p.stroke([[500 + s * 250 + k * 22 - 22, 380], [500 + s * 250 + k * 22 - 34, 410]], 10, "#e8707a"); break;
    case "squint": p.stroke([[420, my], [580, my - 10]], 18, INK); break;
  }
  if (e === "sweat" || e === "worried") { p.poly([[820, 110], [860, 210], [820, 260], [780, 210]], "#9fd6f2", 10); p.ell(810, 205, 10, 20, "#ffffff", 0); }
  void g;
};

/** marble arcade band for one gallery storey (tiles horizontally), 512 x 256 */
export const arcadeTex = (g: CanvasRenderingContext2D) => {
  g.fillStyle = "#f3eee2"; g.fillRect(0, 0, 512, 256);
  g.fillStyle = "#e6dfcf"; for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 512, 3);
  for (let i = 0; i < 4; i++) {
    const x = 16 + i * 128;
    g.fillStyle = "#4a4f63"; g.beginPath(); g.moveTo(x + 18, 250); g.lineTo(x + 18, 110); g.arc(x + 64, 110, 46, Math.PI, 0); g.lineTo(x + 110, 250); g.closePath(); g.fill();
    g.fillStyle = "#6b7088"; g.fillRect(x + 22, 120, 30, 130);
    g.strokeStyle = "rgba(40,30,40,0.85)"; g.lineWidth = 5; g.beginPath(); g.moveTo(x + 18, 250); g.lineTo(x + 18, 110); g.arc(x + 64, 110, 46, Math.PI, 0); g.lineTo(x + 110, 250); g.stroke();
    g.fillStyle = "#fbf8f0"; g.fillRect(x + 4, 60, 10, 196); g.fillRect(x + 114, 60, 10, 196);
  }
  g.fillStyle = "#d9d0bc"; g.fillRect(0, 0, 512, 14); g.fillRect(0, 242, 512, 14);
};
/** ground-floor blind arcade (larger arches, closed), 512 x 512 */
export const baseTex = (g: CanvasRenderingContext2D) => {
  g.fillStyle = "#f1ebde"; g.fillRect(0, 0, 512, 512);
  g.fillStyle = "#e3dbc9"; for (let y = 0; y < 512; y += 40) g.fillRect(0, y, 512, 3);
  for (let i = 0; i < 2; i++) {
    const x = 30 + i * 256;
    g.strokeStyle = "rgba(60,50,60,0.8)"; g.lineWidth = 7;
    g.beginPath(); g.moveTo(x + 20, 512); g.lineTo(x + 20, 200); g.arc(x + 98, 200, 78, Math.PI, 0); g.lineTo(x + 176, 512); g.stroke();
    g.fillStyle = "rgba(200,190,170,0.5)"; g.fill();
  }
};

/** cutaway of the ground under the tower base, 1200 x 1000. mode "foundation": thin slab on soft clay, ruler.
 *  mode "drill": drill rig on the high (left) side, soil buckets rising (t loops), tower base rotating back by `back` 0..1. */
export const cutaway = (p: Pen, mode: "foundation" | "drill", t = 0, back = 0) => {
  const g = p.g;
  g.fillStyle = "#cfe6f5"; g.fillRect(0, 0, 1200, 380);                       // sky band
  g.fillStyle = "#7fb069"; g.fillRect(0, 370, 1200, 30);                      // grass line
  const layers: [number, string][] = [[400, "#a9805a"], [520, "#8d6a4a"], [700, "#9a8a78"], [860, "#7c6a5a"]];
  for (const [y, c] of layers) { g.fillStyle = c; g.fillRect(0, y, 1200, 1000 - y); }
  // soft-clay wiggle lines
  g.strokeStyle = "rgba(60,40,30,0.35)"; g.lineWidth = 6;
  for (let k = 0; k < 9; k++) { g.beginPath(); for (let x = 0; x <= 1200; x += 40) { const y = 560 + k * 45 + 8 * Math.sin(x * 0.02 + k); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  const a = mode === "drill" ? (5.5 - 1.5 * back) * Math.PI / 180 : 0.03;
  p.rot = [a, 600, 470];
  p.poly(rr(380, 430, 820, 480, 6), "#bdb3a2", 10);                         // foundation slab (shallow)
  p.poly([[440, 430], [440, 40], [760, 40], [760, 430]], "#f3eee2", 12);   // tower base
  for (let k = 0; k < 4; k++) p.stroke([[440, 100 + k * 90], [760, 100 + k * 90]], 5, "#d9d0bc");
  p.rot = null;
  if (mode === "foundation") {
    p.line([[880, 400], [880, 480]], "#f2c230", 18); for (let k = 0; k <= 4; k++) p.stroke([[868, 400 + k * 20], [892, 400 + k * 20]], 5, INK);
    p.poly([[900, 420], [960, 400], [960, 440]], INK, 0);
  } else {
    // drill rig on the left (high) side, auger angled under the base
    p.poly(rr(90, 300, 260, 380, 10), "#f28c28", 10);
    p.line([[220, 380], [470, 560]], "#55595f", 22);
    for (let k = 0; k < 6; k++) { const u = k / 6; p.stroke([[220 + 250 * u - 10, 380 + 180 * u + 10], [220 + 250 * u + 10, 380 + 180 * u - 10]], 6, INK); }
    // buckets riding up a rope from the hole
    for (let k = 0; k < 3; k++) {
      const u = ((t + k / 3) % 1), x = 300 - 120 * u, y = 520 - 330 * u;
      p.poly(rr(x - 34, y - 30, x + 34, y + 30, 8), "#8a8f98", 8); p.ell(x, y - 30, 34, 10, "#7a5a3a", 6);
    }
    p.stroke([[300, 520], [180, 190]], 4, INK);
  }
};

/** the chair gag: a person rocking back on a chair, side view, 900 x 1100; lean in radians (+ = back), fallen 0..1 */
export const chairGag = (p: Pen, lean: number, fallen: number, skin = "#f5c9a0", shirt = "#3f6fb5") => {
  const pivot: P2 = [300, 1060], a = -(lean + fallen * 1.25);
  p.rot = [a, pivot[0], pivot[1]];
  p.line([[300, 1060], [320, 700]], "#8a5a3a", 22); p.line([[620, 1060], [600, 700]], "#8a5a3a", 22);   // legs
  p.line([[320, 700], [300, 320]], "#8a5a3a", 24);                                                         // back post
  p.poly(rr(290, 680, 640, 720, 10), "#a8724a", 10);                                                      // seat
  p.poly(rr(300, 360, 340, 640, 8), "#a8724a", 8);
  // sitter: bean body, head, noodle legs to the floor-ish, arms out for balance
  p.line([[560, 690], [700, 760], [760, 1000]], "#3b3f52", 26);
  p.ell(470, 560, 110, 150, shirt, 12, 0, 360, -8);
  p.ell(470, 330, 105, 98, skin, 12);
  p.ell(500, 315, 14, 16, INK, 0); p.ell(445, 318, 14, 16, INK, 0);
  const worry = fallen > 0 || lean > 0.33;
  if (worry) p.ell(475, 380, 22, 26, "#7a2430", 8); else p.arc(475, 360, 40, 24, 20, 160, 9, INK);
  p.line([[420, 520], [300 - 40 * Math.sin(lean * 9), 440]], "#3f6fb5", 18);
  p.line([[520, 520], [640 + 40 * Math.sin(lean * 9), 450]], "#3f6fb5", 18);
  p.rot = null;
};

/** calendar page flying (tears off), 400 x 460; seed varies the page */
export const calPage = (p: Pen, seed: number) => {
  p.poly(rr(20, 40, 380, 440, 16), "#ffffff", 10);
  p.poly(rr(20, 40, 380, 130, 16), "#d42f2f", 0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) p.ell(70 + c * 52, 180 + r * 62, 12, 12, (r * 6 + c + seed) % 7 ? "#c9c2b6" : "#d42f2f", 0);
  for (const x of [120, 280]) p.ell(x, 40, 14, 14, "#8d93a0", 6);
};
/** banana, 500 x 1500 (curved to match the bent tower) */
export const banana = (p: Pen) => {
  const L: P2[] = [], R: P2[] = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20, x = 250 + 120 * Math.sin(t * Math.PI * 0.9) - 60 * t, y = 1440 - t * 1380, w = 20 + 90 * Math.sin(t * Math.PI); L.push([x - w, y]); R.push([x + w, y]); }
  p.poly([...L, ...R.reverse()], "#ffd23a", 14);
  p.line([[L[0][0] + 90, 1440], [L[0][0] + 80, 1490]], "#6b4a2a", 26);
  p.stroke(L.slice(3, 17).map(([x, y]) => [x + 50, y] as P2), 8, "#d9a521");
};
/** protractor reading the lean, 800 x 460; deg = angle shown */
export const protractor = (p: Pen, deg: number) => {
  p.ell(400, 420, 360, 360, "rgba(220,240,255,0.85)", 10, 180, 360);
  for (let d = 0; d <= 180; d += 10) { const a = Math.PI + (d * Math.PI) / 180; p.stroke([[400 + 330 * Math.cos(a), 420 + 330 * Math.sin(a)], [400 + (d % 30 ? 300 : 280) * Math.cos(a), 420 + (d % 30 ? 300 : 280) * Math.sin(a)]], 6, INK); }
  const a = -Math.PI / 2 + (deg * Math.PI) / 180;
  p.line([[400, 420], [400 + 300 * Math.cos(a), 420 + 300 * Math.sin(a)]], "#d42f2f", 14);
  p.stroke([[400, 420], [400, 110]], 6, "#3f6fb5");
  p.ell(400, 420, 18, 18, INK, 0);
};
/** "closed" sign on a post (in-scene text), 500 x 700 */
export const closedSign = (p: Pen) => {
  p.line([[250, 690], [250, 330]], "#8a8f98", 22);
  p.poly(rr(40, 60, 460, 340, 22), "#d42f2f", 12);
  p.poly(rr(70, 90, 430, 310, 14), null, 8);
  const g = p.g; g.fillStyle = "#ffffff"; g.font = "bold 92px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("CHIUSO", 250, 200);
};
/** soil bucket (carried), 260 x 260 */
export const bucket = (p: Pen) => { p.poly([[40, 70], [220, 70], [195, 240], [65, 240]], "#8a8f98", 10); p.ell(130, 70, 90, 22, "#7a5a3a", 8); p.arc(130, 70, 90, 70, 180, 360, 6, INK); };
/** bird's nest with a bird, 400 x 300 */
export const nest = (p: Pen) => {
  p.ell(200, 220, 170, 60, "#8a5a3a", 10);
  for (let k = 0; k < 10; k++) p.stroke([[60 + k * 30, 200 + (k % 2) * 20], [100 + k * 28, 240 - (k % 3) * 10]], 5, "#5a3a20");
  p.ell(210, 140, 70, 55, "#e9e6dd", 10); p.ell(255, 115, 34, 30, "#e9e6dd", 9); p.poly([[285, 112], [325, 120], [285, 128]], "#f2b23a", 5); p.dot(262, 108, 6, INK);
};
/** cobweb in a corner, 300 x 300 */
export const cobweb = (p: Pen) => {
  for (let k = 0; k < 6; k++) { const a = (k / 5) * (Math.PI / 2); p.stroke([[0, 0], [290 * Math.cos(a), 290 * Math.sin(a)]], 3, "rgba(255,255,255,0.85)"); }
  for (let r = 60; r < 290; r += 55) { const pts: P2[] = []; for (let k = 0; k <= 5; k++) { const a = (k / 5) * (Math.PI / 2); pts.push([r * Math.cos(a), r * Math.sin(a)]); } p.stroke(pts, 3, "rgba(255,255,255,0.85)"); }
};
/** "zzz" sleep marks, 300 x 300 (no text font: drawn strokes) */
export const zzz = (p: Pen) => {
  for (const [x, y, s] of [[60, 220, 50], [150, 140, 64], [230, 50, 80]] as const) p.stroke([[x, y], [x + s, y], [x, y + s], [x + s, y + s]], 12, "#3f6fb5");
};
/** ripple rings (sound / impact), 600 x 600; t 0..1 */
export const ripple = (p: Pen, t: number) => {
  const g = p.g;
  for (let k = 0; k < 3; k++) { const u = t - k * 0.18; if (u <= 0 || u >= 1) continue; g.beginPath(); g.arc(300, 300, 40 + 250 * u, 0, Math.PI * 2); g.strokeStyle = `rgba(255,255,255,${(0.6 * (1 - u)).toFixed(3)})`; g.lineWidth = 10; g.stroke(); }
};
/** 4-point sparkle, 200 x 200 */
export const sparkle = (p: Pen) => p.poly([[100, 0], [118, 82], [200, 100], [118, 118], [100, 200], [82, 118], [0, 100], [82, 82]], "#ffffff", 0);
/** measuring stick (builder's rod), 120 x 900 */
export const rod = (p: Pen) => { p.line([[60, 30], [60, 870]], "#e9c060", 30); for (let k = 0; k < 9; k++) p.stroke([[42, 80 + k * 90], [78, 80 + k * 90]], 6, INK); };
/** hammer lying / dropped tool, 300 x 160 */
export const hammer = (p: Pen) => { p.line([[30, 120], [220, 60]], "#a8724a", 20); p.poly(rr(200, 20, 280, 110, 10), "#6b7088", 9); };
export { mix, shade, hh };
