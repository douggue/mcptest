// "The Whale That Came Back Down" (Florence, Oregon, 1970): shot plan, story state, cameras and lens per beat, timed
// to voice/words.json (64.4 s, 30 fps). World: beach along x, ocean to -z, the whale at WHALE, crowd and TV crew
// up the beach at +z, the parking lot behind them, the ketchup stage and the memorial park far away.
export const FPS = 30;
export const TOTAL = 1945;
export type V3 = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const glide = (u: number) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };
export const W = (s: number) => Math.round(s * FPS) - 2;

export const WHALE: V3 = [0, 0, -6];      // whale centre (card 14 m long)
export const CROWD: V3 = [4, 0, 34];      // spectators
export const TV: V3 = [-6, 0, 31];        // TV crew
export const LOT: V3 = [22, 0, 48];       // parking lot (the man's new car)
export const PLUNGE: V3 = [-14, 0, 22];   // detonator position
export const KETCH: V3 = [300, 0, 0];     // ketchup packet stage
export const PARK: V3 = [-300, 0, 200];   // Exploding Whale Memorial Park

export type Light = "day" | "golden";
export type ShotDef = { id: number; a: number; b: number; light: Light };
export const SHOTS: ShotDef[] = [
  { id: 1, a: 0, b: 144, light: "day" },       // hook: the whale goes up
  { id: 2, a: 144, b: 345, light: "day" },     // whale on the beach, it stinks
  { id: 3, a: 345, b: 546, light: "day" },     // the highway department arrives with dynamite
  { id: 4, a: 546, b: 658, light: "day" },     // the plan: tiny pieces, seagulls
  { id: 5, a: 658, b: 753, light: "day" },     // crowd on the dunes, TV crew
  { id: 6, a: 753, b: 912, light: "day" },     // the man warns them, nobody listens
  { id: 7, a: 912, b: 951, light: "day" },     // three, two, one: the plunger
  { id: 8, a: 951, b: 1032, light: "day" },    // up ... and back down
  { id: 9, a: 1032, b: 1140, light: "day" },   // blubber rains on the crowd, cars, TV crew
  { id: 10, a: 1140, b: 1212, light: "day" },  // "wait, why didn't it turn into tiny pieces?"
  { id: 11, a: 1212, b: 1419, light: "day" },  // ketchup packet
  { id: 12, a: 1419, b: 1566, light: "day" },  // the sand pushed back, the blast went up
  { id: 13, a: 1566, b: 1689, light: "day" },  // seagulls flee, crew buries the leftovers
  { id: 14, a: 1689, b: 1829, light: "day" },  // the man's brand new car
  { id: 15, a: 1829, b: TOTAL, light: "golden" }, // fifty years later: the memorial park
];
export const XFADE: Record<number, number> = { 11: 8, 12: 8, 15: 10 };
export const FLASH_AT = 144;
export const KICKS: [number, number][] = [[W(31.76), 0.03], [W(58.9), 0.02], [W(43.98), 0.012]];
export const BOOM = W(31.76);

export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    const x = XFADE[s.id];
    if (x && f >= s.a - x / 2 && f < s.a + x / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: (f - (s.a - x / 2) + 1) / (x + 1) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};
/** blast progress 0..1 (the hook replays it as a flash-forward) */
export const blastT = (f: number) => (f < 144 ? clamp01((f - 40) / 100) : clamp01((f - BOOM) / 75));

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
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const CAMS: Record<number, Key[]> = {
  1: [{ f: 0, s: (f) => dolly([6, 1.6, 22], [0, 5 + 0.06 * Math.max(0, f - 40), -6], push(f, 0, 0.002), { fov: 52, roll: -0.04 }) }],
  2: [
    { f: 144, s: (f) => dolly([40, 22, 34], add(WHALE, [0, 1, 0]), push(f, 144, 0.0018), { fov: 46 }) },
    { f: W(8.78), dur: 34, s: (f) => dolly(add(WHALE, [9, 1.7, 9]), add(WHALE, [7, 1.6, 3.5]), push(f, W(8.78), 0.003), { fov: 42, roll: 0.03 }) },
  ],
  3: [
    { f: 345, s: (f) => dolly([-24, 2.0, 16], [-6, 1.6, -2], push(f, 345, 0.002), { fov: 46 }) },
    { f: W(15.08), dur: 30, s: (f) => dolly(add(WHALE, [-4, 1.5, 8]), add(WHALE, [-2, 1.2, 1.4]), push(f, W(15.08), 0.0025), { fov: 44 }) },
  ],
  4: [
    { f: 546, s: (f) => dolly(add(WHALE, [-2.6, 1.6, 4.4]), add(WHALE, [-2.4, 1.7, 2.2]), push(f, 546, 0.004), { fov: 40 }) },
    { f: W(20.82), dur: 24, s: (f) => dolly(add(WHALE, [-2.6, 1.0, 5.4]), add(WHALE, [0, 9, 0]), push(f, W(20.82), 0.002), { fov: 50, roll: -0.04 }) },
  ],
  5: [{ f: 658, s: (f) => dolly(add(CROWD, [3, 2.2, 9]), add(WHALE, [0, 1.5, 0]), push(f, 658, 0.0015), { fov: 44 }) }],
  6: [
    { f: 753, s: (f) => dolly(add(CROWD, [-1.2, 1.6, 3.6]), add(CROWD, [-1.0, 1.65, 0]), push(f, 753, 0.003), { fov: 40 }) },
    { f: W(29.3), cut: true, s: (f) => dolly(add(PLUNGE, [1.2, 1.6, 3.4]), add(PLUNGE, [0.6, 1.6, 0]), push(f, W(29.3), 0.003), { fov: 40, roll: 0.04 }) },
  ],
  7: [{ f: 912, s: (f) => dolly(add(PLUNGE, [0.8, 1.0, 1.6]), add(PLUNGE, [0.7, 0.55, 0.4]), push(f, 912, 0.005), { fov: 38 }) }],
  8: [
    { f: 951, s: (f) => dolly(add(WHALE, [10, 1.5, 34]), add(WHALE, [0, 6, 0]), push(f, 951, 0.0015), { fov: 54 }) },
    { f: W(32.26), dur: 18, s: (f) => dolly(add(WHALE, [10, 1.5, 34]), add(WHALE, [0, 26, 0]), push(f, W(32.26), 0.0015), { fov: 58, roll: 0.03 }) },
    { f: W(33.44), dur: 16, s: (f) => dolly(add(WHALE, [10, 1.5, 34]), add(CROWD, [0, 1.5, -6]), push(f, W(33.44), 0.0015), { fov: 54, roll: -0.03 }) },
  ],
  9: [
    { f: 1032, s: (f) => dolly(add(CROWD, [6, 2.5, 8]), add(CROWD, [0, 1.6, 0]), push(f, 1032, 0.002), { fov: 48 }) },
    { f: W(36.44), dur: 18, s: (f) => dolly(add(LOT, [-6, 2.0, 7]), add(LOT, [0, 1.0, 0]), push(f, W(36.44), 0.002), { fov: 46 }) },
    { f: W(37.26), dur: 14, s: (f) => dolly(add(TV, [2.5, 1.6, 4.5]), add(TV, [0, 1.3, 0]), push(f, W(37.26), 0.003), { fov: 44, roll: 0.05 }) },
  ],
  10: [{ f: 1140, s: (f) => dolly(add(CROWD, [-1.2, 1.7, 3.0]), add(CROWD, [-1.0, 1.85, 0]), push(f, 1140, 0.004), { fov: 40 }) }],
  11: [{ f: 1212, s: (f) => dolly(add(KETCH, [0.4, 2.4, 3.2]), add(KETCH, [0.4, 0, 0]), push(f, 1212, 0.0025), { fov: 44 }) }],
  12: [{ f: 1419, s: (f) => dolly(add(WHALE, [0, 4, 30]), add(WHALE, [0, 6, 0]), push(f, 1419, 0.002), { fov: 54 }) }],
  13: [
    { f: 1566, s: (f) => dolly(add(WHALE, [-10, 1.2, 14]), add(WHALE, [0, 10, 0]), push(f, 1566, 0.002), { fov: 54, roll: 0.04 }) },
    { f: W(54.28), dur: 24, s: (f) => dolly(add(WHALE, [6, 2.5, 13]), add(WHALE, [0, 1, 0]), push(f, W(54.28), 0.002), { fov: 46 }) },
  ],
  14: [
    { f: 1689, s: (f) => dolly(add(LOT, [-2.5, 1.7, 5]), add(LOT, [-2.0, 1.6, 0.8]), push(f, 1689, 0.003), { fov: 42 }) },
    { f: W(57.68), dur: 20, s: (f) => dolly(add(LOT, [1.5, 1.4, 7]), add(LOT, [0.5, 1.0, 0]), push(f, W(57.68), 0.002), { fov: 46 }) },
  ],
  15: [{ f: 1829, s: (f) => dolly(add(PARK, [6, 2, 18]), add(PARK, [0, 2.5, 0]), push(f, 1829, 0.002), { fov: 46, roll: -0.02 }) }],
};
export const camAt = (id: number, f: number): Cam => {
  const c = run(CAMS[id], f);
  for (const [k, a] of KICKS) { const d = f - k; if (d >= 0 && d < 8 && shotAt(k).id === id) c.roll += a * (d % 2 ? -1 : 1) * (1 - d / 8); }
  return c;
};

type Dof = { f: number; dur?: number; cInf: number; focus?: (f: number) => V3 };
const DOF: Dof[] = [
  { f: 0, cInf: 4 }, { f: 144, cInf: 0 }, { f: W(8.78), dur: 34, cInf: 10 }, { f: 345, cInf: 4 }, { f: W(15.08), dur: 30, cInf: 8 },
  { f: 546, cInf: 13 }, { f: W(20.82), dur: 24, cInf: 3 }, { f: 658, cInf: 4 }, { f: 753, cInf: 13 }, { f: 912, cInf: 14 },
  { f: 951, cInf: 0 }, { f: 1032, cInf: 6 }, { f: 1140, cInf: 13 }, { f: 1212, cInf: 8 }, { f: 1419, cInf: 0 },
  { f: 1566, cInf: 4 }, { f: 1689, cInf: 10 }, { f: W(57.68), dur: 20, cInf: 6 }, { f: 1829, cInf: 5 },
];
export const dofAt = (f: number) => {
  let i = 0; while (i + 1 < DOF.length && f >= DOF[i + 1].f) i++;
  const d = DOF[i], p = DOF[Math.max(0, i - 1)];
  const k = d.dur ? Math.min(1, (f - d.f) / d.dur) : 1;
  return { cInf: p.cInf + (d.cInf - p.cInf) * k, focus: d.focus };
};
