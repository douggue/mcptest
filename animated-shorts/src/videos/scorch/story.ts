// "The Building That Cooked Breakfast": shot plan, cameras and lens per beat, all timed to voice/words.json
// (63.0 s narration, 30 fps). Coordinates: Eastcheap runs along x (road |z| < 4, pavements to |z| 6.5), the tower
// stands north of it (z < -24) with its concave face turned south to the street, the sun is in the south sky.
export const FPS = 30;
export const TOTAL = 1900;
export type V3 = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const glide = (u: number) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };
/** seconds -> frame, landing reactions 2 frames before the word (reference: 0-3 f lead) */
export const W = (s: number) => Math.round(s * FPS) - 2;

// ---- places ----
export const HOT: V3 = [4.5, 0, 2.2];          // the focal spot on Eastcheap (where the Jaguar is parked)
export const CAR: V3 = [4.5, 0, 2.6];          // car centre (side view card, faces the camera)
export const SHOP: V3 = [16, 0, 6.2];           // doormat in a shop doorway, south pavement
export const BIKE: V3 = [-9, 0, 5.4];           // bike leaning on the south pavement
export const KIDP: V3 = [-34, 0, 5.2];          // the kid with the magnifying glass (south pavement, west)
export const LAB: V3 = [-400, 0, 0];            // the flat-window diagram stage (far west, out of every other shot)
export const VEGAS: V3 = [700, 0, 0];           // the Las Vegas pool
export const ARCH: V3 = [-6, 0, -14];           // architect in the plaza under the tower

export type Light = "day" | "golden";
export type ShotDef = { id: number; a: number; b: number; light: Light };
// shot boundaries on word onsets (words.json): see SCRIPT.md for the lines
export const SHOTS: ShotDef[] = [
  { id: 1, a: 0, b: 105, light: "day" },       // hook: the tower, the beam, a car going soft
  { id: 2, a: 105, b: 333, light: "day" },     // 2013, the newest tower, "curved like a giant spoon"
  { id: 3, a: 333, b: 447, light: "day" },     // the businessman parks his brand new Jaguar
  { id: 4, a: 447, b: 633, light: "day" },     // two hours later: mirror, badge, panels
  { id: 5, a: 633, b: 741, light: "day" },     // doormat smoking, bike seat blisters
  { id: 6, a: 741, b: 885, light: "day" },     // the reporter, the frying pan, the egg
  { id: 7, a: 885, b: 951, light: "day" },     // "wait, how does a building make breakfast?"
  { id: 8, a: 951, b: 1065, light: "day" },    // flat window: parallel bounce, spread out
  { id: 9, a: 1065, b: 1122, light: "day" },   // "but this tower's face curves inwards"
  { id: 10, a: 1122, b: 1182, light: "day" },  // magnifying glass and a leaf
  { id: 11, a: 1182, b: 1368, light: "day" },  // the curved mirror squeezes the sun into one spot
  { id: 12, a: 1368, b: 1446, light: "day" },  // 160 metres tall
  { id: 13, a: 1446, b: 1566, light: "day" },  // paid for the car, bolted on a sunshade
  { id: 14, a: 1566, b: 1659, light: "day" },  // luckily / unluckily
  { id: 15, a: 1659, b: 1772, light: "day" },  // Las Vegas, frying tourists by the pool
  { id: 16, a: 1772, b: TOTAL, light: "golden" }, // the award
];
export const XFADE: Record<number, number> = { 8: 6, 10: 6, 15: 8, 16: 8 };
export const FLASH_AT = 105;
export const KICKS: [number, number][] = [[W(17.34), 0.012], [W(44.88), 0.016], [W(54.72), 0.01]]; // [frame, roll amplitude]

export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    const x = XFADE[s.id];
    if (x && f >= s.a - x / 2 && f < s.a + x / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: (f - (s.a - x / 2) + 1) / (x + 1) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};

// ---- story state (pure functions of the frame) ----
/** car melt 0..1 per part: mirror, badge, panels */
export const melt = (f: number) => {
  if (f < 105) return { mirror: 0.35 * smooth((f - 20) / 70), badge: 0.3 * smooth((f - 40) / 60), panel: 0.25 * smooth((f - 50) / 55) };
  if (f < 447) return { mirror: 0, badge: 0, panel: 0 };
  return { mirror: smooth((f - W(16.86)) / 22), badge: smooth((f - W(18.06)) / 26), panel: smooth((f - W(19.28)) / 40) };
};
/** the reporter's walk into the beam (x along the street) and the egg */
export const reporterX = (f: number) => -2.5 + 6.2 * smooth((f - 760) / 70);
export const eggT = (f: number) => clamp01((f - W(28.86)) / 20);
/** sunshade fins sliding out (0..1) */
export const shade = (f: number) => (f < 1446 ? 0 : smooth((f - W(49.66)) / 50));
/** rays drawn in the explanation: 0..1 growth */
export const rayIn = (f: number, f0: number, dur = 30) => clamp01((f - f0) / dur);

// ---- cameras ----
export type Cam = { pos: V3; look: V3; fov: number; roll: number };
type Shot = { pos: V3; look: V3; fov?: number; roll?: number };
type Key = { f: number; dur?: number; cut?: boolean; s: (f: number) => Shot };
const full = (c: Shot): Cam => ({ fov: 40, roll: 0, ...c });
const lerpC = (a: Cam, b: Cam, k: number): Cam => ({
  pos: a.pos.map((v, i) => v + (b.pos[i] - v) * k) as V3, look: a.look.map((v, i) => v + (b.look[i] - v) * k) as V3,
  fov: a.fov + (b.fov - a.fov) * k, roll: a.roll + (b.roll - a.roll) * k,
});
const run = (keys: Key[], f: number) => {
  let cur = full(keys[0].s(f));
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    if (f < k.f) break;
    cur = k.cut ? full(k.s(f)) : lerpC(cur, full(k.s(f)), glide((f - k.f) / (k.dur ?? 24)));
  }
  return cur;
};
/** creeping push-in: every hold moves (reference: 0.15-0.35 %/f) */
const push = (f: number, f0: number, rate = 0.0025) => Math.exp(-rate * Math.max(0, f - f0));
const dolly = (pos: V3, look: V3, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos: [look[0] + (pos[0] - look[0]) * k, look[1] + (pos[1] - look[1]) * k, look[2] + (pos[2] - look[2]) * k], look, ...rest });
const zoom = (pos: V3, look: V3, fov: number, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos, look, fov: (360 / Math.PI) * Math.atan(Math.tan((fov * Math.PI) / 360) * k), ...rest });

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const CAMS: Record<number, Key[]> = {
  1: [{ f: 0, s: (f) => zoom([6.5, 0.6, 6.3], [1.5, 6, -16], 62, push(f, 0, 0.003), { roll: -0.07 }) }],
  2: [
    { f: 105, s: (f) => dolly([95, 55, 120], [0, 72, -30], push(f, 105, 0.0015), { fov: 44 }) },
    { f: 240, dur: 45, s: (f) => dolly([170, 70, -18], [0, 75, -26], push(f, 240, 0.0015), { fov: 46, roll: 0.03 }) },
  ],
  3: [{ f: 333, s: (f) => dolly([14, 1.3, 5.6], [4.5, 1.5, 1.5], push(f, 333, 0.0022), { fov: 50 }) }],
  4: [
    { f: 447, s: (f) => dolly([15, 1.5, 5.5], [7, 1.4, 2.6], push(f, 447, 0.002), { fov: 48 }) },
    { f: 500, cut: true, s: (f) => dolly(add(CAR, [1.5, 1.15, 3.1]), add(CAR, [1.35, 1.0, 0]), push(f, 500, 0.003), { fov: 36, roll: 0.06 }) },
    { f: W(18.06), cut: true, s: (f) => dolly(add(CAR, [3.6, 0.8, 3.0]), add(CAR, [2.05, 0.6, 0]), push(f, W(18.06), 0.003), { fov: 36, roll: -0.05 }) },
    { f: W(19.28), cut: true, s: (f) => dolly(add(CAR, [0, 1.3, -11]), add(CAR, [0, 0.8, 0]), push(f, W(19.28), 0.0025), { fov: 40 }) },
  ],
  5: [
    { f: 633, s: (f) => dolly(add(SHOP, [2.4, 1.0, -3.4]), add(SHOP, [0, 0.35, 0]), push(f, 633, 0.003), { fov: 40, roll: 0.05 }) },
    { f: W(23.46), cut: true, s: (f) => dolly(add(BIKE, [1.6, 1.4, -2.8]), add(BIKE, [0, 0.8, 0]), push(f, W(23.46), 0.003), { fov: 40, roll: -0.05 }) },
  ],
  6: [
    { f: 741, s: (f) => dolly([HOT[0] - 1, 1.6, -9], [HOT[0] - 1.2, 1.3, 2.4], push(f, 741, 0.002), { fov: 44 }) },
    { f: W(28.78), dur: 22, s: (f) => dolly([HOT[0] + 0.6, 1.5, -1.6], [HOT[0] + 0.25, 1.15, 2.6], push(f, W(28.78), 0.003), { fov: 38 }) },
  ],
  7: [
    { f: 885, s: () => ({ pos: [HOT[0] + 0.2, 1.2, 6.2], look: [HOT[0], 1.6, 2.6], fov: 40, roll: 0 }) },
    { f: 905, dur: 34, s: (f) => zoom([HOT[0] + 0.2, 1.2, 6.2], [0, 110, -30], 54, push(f, 905, 0.002), { roll: 0.075 }) },
  ],
  8: [
    { f: 951, s: (f) => dolly(add(LAB, [26, 9, 26]), add(LAB, [0, 4, 0]), push(f, 951, 0.0015), { fov: 46, roll: 0.02 }) },
  ],
  9: [{ f: 1065, s: (f) => dolly([200, 70, -12], [0, 80, -24], push(f, 1065, 0.002), { fov: 52 }) }],
  10: [{ f: 1122, s: (f) => dolly(add(KIDP, [1.3, 1.0, -2.5]), add(KIDP, [0.35, 0.65, 0.05]), push(f, 1122, 0.004), { fov: 42, roll: -0.04 }) }],
  11: [
    { f: 1182, s: (f) => dolly([130, 60, 150], [0, 70, -22], push(f, 1182, 0.0012), { fov: 48 }) },
    { f: W(43.3), dur: 40, s: (f) => dolly([HOT[0] + 9, 4, -9], [HOT[0], 0.6, HOT[2]], push(f, W(43.3), 0.003), { fov: 40, roll: 0.04 }) },
  ],
  12: [
    { f: 1368, s: () => ({ pos: [20, 1.5, 5.8], look: [HOT[0], 1, HOT[2]], fov: 50, roll: 0 }) },
    { f: 1380, dur: 40, s: (f) => zoom([20, 1.5, 5.8], [0, 120, -24], 64, push(f, 1380, 0.0015), { roll: -0.06 }) },
  ],
  13: [{ f: 1446, s: (f) => dolly([60, 22, 110], [0, 80, -18], push(f, 1446, 0.0018), { fov: 48 }) }],
  14: [{ f: 1566, s: (f) => dolly(add(ARCH, [1.0, 1.55, 4.6]), add(ARCH, [0, 1.75, 0]), push(f, 1566, 0.0035), { fov: 40 }) }],
  15: [{ f: 1659, s: (f) => dolly(add(VEGAS, [5, 1.8, 13]), add(VEGAS, [-1, 1.6, 4]), push(f, 1659, 0.0025), { fov: 52, roll: 0.03 }) }],
  16: [{ f: 1772, s: (f) => dolly([28, 1.7, 3], [0, 70, -20], push(f, 1772, 0.0015), { fov: 58, roll: -0.03 }) }],
};
export const camAt = (id: number, f: number): Cam => {
  const c = run(CAMS[id], f);
  // impact flip-kick: sign flips every frame, decays over 7 f
  for (const [k, a] of KICKS) { const d = f - k; if (d >= 0 && d < 8 && shotAt(k).id === id) c.roll += a * (d % 2 ? -1 : 1) * (1 - d / 8); }
  return c;
};

// ---- lens blur per beat (cInf px at 1080 wide); focus = look point unless given ----
type Dof = { f: number; dur?: number; cInf: number; focus?: (f: number) => V3 };
const DOF: Dof[] = [
  { f: 0, cInf: 6, focus: () => [CAR[0], 1, CAR[2]] },
  { f: 105, cInf: 0 },
  { f: 333, cInf: 10, focus: () => [CAR[0] - 1.4, 1.6, CAR[2] + 0.6] },
  { f: 447, cInf: 8, focus: () => [7.4, 1.6, 3.6] },
  { f: 500, cInf: 13 },
  { f: 633, cInf: 13 },
  { f: 741, cInf: 10, focus: (f) => [reporterX(f), 1.5, HOT[2] + 0.5] },
  { f: 885, cInf: 8, focus: () => [HOT[0], 1.6, HOT[2] + 0.5] },
  { f: 905, dur: 30, cInf: 0 },
  { f: 951, cInf: 0 },
  { f: 1122, cInf: 14 },
  { f: 1182, cInf: 0 },
  { f: W(43.3), dur: 40, cInf: 7 },
  { f: 1368, cInf: 0 },
  { f: 1566, cInf: 12, focus: () => [ARCH[0], 1.9, ARCH[2]] },
  { f: 1659, cInf: 0 },
];
export const dofAt = (f: number) => {
  let i = 0; while (i + 1 < DOF.length && f >= DOF[i + 1].f) i++;
  const d = DOF[i], p = DOF[Math.max(0, i - 1)];
  const k = d.dur ? Math.min(1, (f - d.f) / d.dur) : 1;
  return { cInf: p.cInf + (d.cInf - p.cInf) * k, focus: d.focus };
};
