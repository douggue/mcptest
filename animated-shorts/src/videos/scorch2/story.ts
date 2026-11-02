// "The Building That Cooked Breakfast" v2: rebuilt shot plan for the Kokoro narration (scorch2/voice, 63.8 s).
// Coordinates as v1: Eastcheap along x (road |z| < 4, pavements to |z| 6.5, raised 15 cm), the tower north of it
// with its concave face turned south, the sun in the south sky. Every beat gets its own framing and some acting.
export const FPS = 30;
export const TOTAL = 1930;
export type V3 = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const glide = (u: number) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };
/** springy 0..1 with one overshoot (pop-ins) */
export const pop = (u: number) => { const x = clamp01(u); return x >= 1 ? 1 : 1 - Math.cos(x * Math.PI * 1.5) * (1 - x) ** 1.6; };
/** seconds -> frame, landing reactions 2 frames ahead of the word */
export const W = (s: number) => Math.round(s * FPS) - 2;

export const HOT: V3 = [4.5, 0, 2.2];
export const CAR: V3 = [4.5, 0, 2.6];
export const SHOP: V3 = [16, 0, 6.0];
export const BIKE: V3 = [-9, 0, 5.4];
export const KIDP: V3 = [-34, 0, 5.2];
export const LAB: V3 = [-400, 0, 0];
export const VEGAS: V3 = [700, 0, 0];
export const ARCH: V3 = [-6, 0, -14];

export type Light = "day" | "golden";
export type ShotDef = { id: number; a: number; b: number; light: Light };
export const SHOTS: ShotDef[] = [
  { id: 1, a: 0, b: 101, light: "day" },        // hook: melting mirror -> pull back to the tower
  { id: 2, a: 101, b: 312, light: "day" },      // 2013, nearly finished (crane), 37 floors, giant spoon
  { id: 3, a: 312, b: 414, light: "day" },      // businessman parks his brand-new Jaguar, pats it, walks off
  { id: 4, a: 414, b: 464, light: "day" },      // two hours later (time-lapse), he comes back with a coffee
  { id: 5, a: 464, b: 603, light: "day" },      // mirror / badge / panels + his reaction
  { id: 6, a: 603, b: 711, light: "day" },      // doormat smoking (shopkeeper stamping), bike seat (cyclist jumps)
  { id: 7, a: 711, b: 853, light: "day" },      // reporter walks into the light with a frying pan, cooks an egg
  { id: 8, a: 853, b: 918, light: "day" },      // wait: how does a building make breakfast?
  { id: 9, a: 918, b: 1022, light: "day" },     // flat window: bounces straight back, nice and spread out
  { id: 10, a: 1022, b: 1108, light: "day" },   // curved face, like a satellite dish
  { id: 11, a: 1108, b: 1197, light: "day" },   // magnifying glass + leaf: same trick
  { id: 12, a: 1197, b: 1346, light: "day" },   // catches sunlight over a huge area, squeezes it to one spot
  { id: 13, a: 1346, b: 1442, light: "day" },   // and this magnifying glass was 160 m tall
  { id: 14, a: 1442, b: 1558, light: "day" },   // paid for the car; sunshade bolted on
  { id: 15, a: 1558, b: 1642, light: "day" },   // luckily: the architect, smug
  { id: 16, a: 1642, b: 1699, light: "day" },   // unluckily: already twice
  { id: 17, a: 1699, b: 1819, light: "day" },   // Las Vegas: frying tourists by the pool
  { id: 18, a: 1819, b: TOTAL, light: "golden" }, // the award: Britain's worst new building
];
export const XFADE: Record<number, number> = { 9: 6, 17: 8, 18: 8 };
export const FLASH_AT = 101;
export const KICKS: [number, number][] = [[W(16.12), 0.012], [W(22.92), 0.012], [W(44.22), 0.018], [W(55.92), 0.012], [W(62.84), 0.012]];

export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    const x = XFADE[s.id];
    if (x && f >= s.a - x / 2 && f < s.a + x / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: (f - (s.a - x / 2) + 1) / (x + 1) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};

// ---- story state ----
export const melt = (f: number) => {
  if (f < 101) return { mirror: 0.15 + 0.6 * smooth(f / 90), badge: 0.3 * smooth((f - 20) / 60), panel: 0.3 * smooth((f - 30) / 60) };
  if (f < 464) return { mirror: 0, badge: 0, panel: 0 };
  return { mirror: smooth((f - W(15.62)) / 16), badge: smooth((f - W(17.14)) / 18), panel: smooth((f - W(18.68)) / 26) };
};
/** car arrival (shot 3): x offset from CAR, 0 when parked, with a settle bounce */
export const carArrive = (f: number) => { const u = clamp01((f - 312) / 34); return -10 * (1 - u) ** 2.2; };
export const carBounce = (f: number) => { const d = f - 346; return d < 0 || d > 20 ? 0 : 0.06 * Math.sin(d * 0.9) * (1 - d / 20); };
export const reporterX = (f: number) => HOT[0] - 7 + 6.6 * smooth((f - 716) / 72);
export const eggT = (f: number) => clamp01((f - W(27.92)) / 18);
export const shadeFins = (f: number) => (f < 1442 ? 0 : clamp01((f - W(49.64)) / 48));
export const rayIn = (f: number, f0: number, dur = 30) => clamp01((f - f0) / dur);
/** time-lapse sun azimuth swing for shot 4 ("two hours later"), radians added to the day sun */
export const sunSwing = (f: number) => (f >= 414 && f < 450 ? 1.1 * smooth((f - 414) / 36) - 0.55 : 0);

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
const push = (f: number, f0: number, rate = 0.0025) => Math.exp(-rate * Math.max(0, f - f0));
const dolly = (pos: V3, look: V3, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos: [look[0] + (pos[0] - look[0]) * k, look[1] + (pos[1] - look[1]) * k, look[2] + (pos[2] - look[2]) * k], look, ...rest });
const zoom = (pos: V3, look: V3, fov: number, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos, look, fov: (360 / Math.PI) * Math.atan(Math.tan((fov * Math.PI) / 360) * k), ...rest });
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
// the car card faces the lens; its mirror sits ~0.95 m right of centre at ~1.1 m, the badge at the nose ~2.2 m right
const MIRROR = add(CAR, [0.95, 1.05, 0]), BADGE = add(CAR, [2.2, 0.95, 0]);

const CAMS: Record<number, Key[]> = {
  1: [
    { f: 0, s: (f) => dolly(add(MIRROR, [0.15, 0.1, 1.5]), MIRROR, push(f, 0, 0.004), { fov: 36, roll: 0.05 }) },
    { f: 40, dur: 55, s: (f) => zoom([8.6, 0.6, 6.3], [2, 9, -16], 62, push(f, 40, 0.002), { roll: -0.06 }) },
  ],
  2: [
    { f: 101, s: (f) => dolly([60, 30, 90], [0, 150, -30], push(f, 101, 0.0012), { fov: 50 }) },
    { f: 150, dur: 70, s: (f) => dolly([75, 120, 70], [0, 120, -24], push(f, 150, 0.0015), { fov: 48, roll: 0.02 }) },
    { f: W(8.94), cut: true, s: (f) => dolly([210, 80, -14], [24, 80, -24], push(f, W(8.94), 0.002), { fov: 56 }) },
  ],
  3: [
    { f: 312, s: (f) => dolly([15, 1.3, 5.7], [5.5, 1.3, 1.8], push(f, 312, 0.002), { fov: 50 }) },
    { f: 372, dur: 30, s: (f) => dolly([12, 1.5, 5.8], [6.5, 1.5, 2.6], push(f, 372, 0.0025), { fov: 48 }) },
  ],
  4: [{ f: 414, s: (f) => dolly([16, 2.0, 6.0], [6, 1.6, 1.0], push(f, 414, 0.002), { fov: 52 }) }],
  5: [
    { f: 464, s: (f) => dolly(add(MIRROR, [0.2, 0.15, 1.7]), MIRROR, push(f, 464, 0.004), { fov: 36, roll: 0.05 }) },
    { f: 507, cut: true, s: (f) => dolly(add(BADGE, [0.5, 0.1, 1.6]), BADGE, push(f, 507, 0.004), { fov: 36, roll: -0.05 }) },
    { f: 538, cut: true, s: (f) => dolly([14, 1.4, 5.9], [6.4, 1.3, 2.8], push(f, 538, 0.003), { fov: 50 }) },
  ],
  6: [
    { f: 603, s: (f) => dolly(add(SHOP, [2.2, 1.3, -3.6]), add(SHOP, [0.2, 0.8, 0]), push(f, 603, 0.003), { fov: 46, roll: 0.04 }) },
    { f: W(22.28), cut: true, s: (f) => dolly(add(BIKE, [2.0, 1.4, -3.4]), add(BIKE, [0.1, 1.0, 0]), push(f, W(22.28), 0.003), { fov: 46, roll: -0.04 }) },
  ],
  7: [
    { f: 711, s: (f) => dolly([HOT[0] - 3, 1.6, -9], [reporterX(f) + 0.4, 1.3, HOT[2] + 0.5], push(f, 711, 0.0015), { fov: 46 }) },
    { f: W(27.48), dur: 18, s: (f) => dolly([HOT[0] + 0.3, 1.5, -1.4], [HOT[0], 1.1, HOT[2] + 0.6], push(f, W(27.48), 0.004), { fov: 40 }) },
  ],
  8: [
    { f: 853, s: () => ({ pos: [HOT[0] + 0.3, 1.4, -1.6], look: [HOT[0], 1.6, HOT[2] + 0.6], fov: 42, roll: 0 }) },
    { f: 868, dur: 40, s: (f) => zoom([HOT[0] + 0.3, 1.0, -1.6], [-2, 120, -30], 58, push(f, 868, 0.002), { roll: 0.08 }) },
  ],
  9: [{ f: 918, s: (f) => dolly(add(LAB, [16, 6, 18]), add(LAB, [0, 4, 4]), push(f, 918, 0.0018), { fov: 50, roll: 0.02 }) }],
  10: [{ f: 1022, s: (f) => dolly([150, 45, 60], [10, 70, -18], push(f, 1022, 0.002), { fov: 54 }) }],
  11: [{ f: 1108, s: (f) => dolly(add(KIDP, [1.3, 1.0, -2.5]), add(KIDP, [0.35, 0.65, 0.05]), push(f, 1108, 0.004), { fov: 42, roll: -0.04 }) }],
  12: [
    { f: 1197, s: (f) => dolly([130, 60, 150], [0, 70, -22], push(f, 1197, 0.0012), { fov: 50 }) },
    { f: W(42.5), cut: true, s: (f) => dolly([HOT[0] + 7, 3.2, -9], [HOT[0], 0.8, HOT[2]], push(f, W(42.5), 0.003), { fov: 42, roll: 0.04 }) },
  ],
  13: [
    { f: 1346, s: () => ({ pos: [22, 1.5, 5.8], look: [HOT[0], 1, HOT[2]], fov: 50, roll: 0 }) },
    { f: 1356, dur: 50, s: (f) => zoom([22, 1.5, 5.8], [0, 115, -24], 66, push(f, 1356, 0.0015), { roll: -0.06 }) },
  ],
  14: [
    { f: 1442, s: (f) => dolly([12, 1.5, 5.8], [6.2, 1.5, 2.4], push(f, 1442, 0.003), { fov: 46 }) },
    { f: W(49.64), cut: true, s: (f) => dolly([60, 22, 110], [0, 95, -18], push(f, W(49.64), 0.0018), { fov: 50 }) },
  ],
  15: [{ f: 1558, s: (f) => dolly(add(ARCH, [1.0, 1.55, 4.4]), add(ARCH, [0, 1.75, 0]), push(f, 1558, 0.003), { fov: 42 }) }],
  16: [{ f: 1642, s: (f) => dolly(add(ARCH, [0.2, 1.75, 2.2]), add(ARCH, [0, 1.85, 0]), push(f, 1642, 0.006), { fov: 38, roll: 0.06 }) }],
  17: [
    { f: 1699, s: (f) => dolly(add(VEGAS, [5, 1.8, 13]), add(VEGAS, [-1, 1.6, 4]), push(f, 1699, 0.0025), { fov: 52, roll: 0.03 }) },
    { f: W(58.94), cut: true, s: (f) => dolly(add(VEGAS, [0.6, 1.3, 8.6]), add(VEGAS, [-0.6, 0.9, 5.5]), push(f, W(58.94), 0.004), { fov: 44, roll: -0.04 }) },
  ],
  18: [{ f: 1819, s: (f) => dolly([25, 1.5, 3.6], [4, 46, -22], push(f, 1819, 0.0016), { fov: 64, roll: -0.03 }) }],
};
export const camAt = (id: number, f: number): Cam => {
  const c = run(CAMS[id], f);
  for (const [k, a] of KICKS) { const d = f - k; if (d >= 0 && d < 8 && shotAt(k).id === id) c.roll += a * (d % 2 ? -1 : 1) * (1 - d / 8); }
  return c;
};

type Dof = { f: number; dur?: number; cInf: number; focus?: (f: number) => V3 };
const DOF: Dof[] = [
  { f: 0, cInf: 15 }, { f: 40, dur: 55, cInf: 3 }, { f: 101, cInf: 0 },
  { f: 312, cInf: 8, focus: () => [CAR[0] + 2.5, 1.4, CAR[2] + 1] },
  { f: 414, cInf: 5 },
  { f: 464, cInf: 15 }, { f: 538, cInf: 9, focus: () => [CAR[0] + 3.2, 1.6, CAR[2] + 1] },
  { f: 603, cInf: 13 },
  { f: 711, cInf: 8, focus: (f) => [reporterX(f), 1.5, HOT[2] + 0.5] }, { f: W(27.48), dur: 18, cInf: 14 },
  { f: 853, cInf: 12 }, { f: 868, dur: 30, cInf: 0 },
  { f: 918, cInf: 0 }, { f: 1108, cInf: 14 }, { f: 1197, cInf: 0 }, { f: W(42.5), dur: 40, cInf: 7 },
  { f: 1346, cInf: 0 }, { f: 1442, cInf: 10, focus: () => [CAR[0] + 2.8, 1.6, CAR[2] + 1] }, { f: W(49.64), cInf: 0 },
  { f: 1558, cInf: 12, focus: () => [ARCH[0], 1.9, ARCH[2]] }, { f: 1642, cInf: 15, focus: () => [ARCH[0], 1.9, ARCH[2]] },
  { f: 1699, cInf: 3 }, { f: W(58.94), cInf: 12 }, { f: 1819, cInf: 0 },
];
export const dofAt = (f: number) => {
  let i = 0; while (i + 1 < DOF.length && f >= DOF[i + 1].f) i++;
  const d = DOF[i], p = DOF[Math.max(0, i - 1)];
  const k = d.dur ? Math.min(1, (f - d.f) / d.dur) : 1;
  return { cInf: p.cInf + (d.cInf - p.cInf) * k, focus: d.focus };
};
