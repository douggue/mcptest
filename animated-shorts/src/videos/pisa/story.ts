// "Why the Leaning Tower of Pisa Never Falls Over": shot plan built to REFERENCE_STUDY.md.
// - no hard cuts: every shot boundary is a 6-frame S-curve dissolve (layersAt);
// - every shot: a slow base push plus one bell-shaped move peaking on its key word (cam());
// - the protagonist is the tower itself (a face card on its front), on screen in most shots;
// - no roll shakes (impacts use ripple/burst graphics instead).
// World: tower base centred at the origin, leaning toward +x; the lawn and tourists to the south (+z); the
// cutaway stage far west (LAB); the chair gag on the lawn (CHAIR).
export const FPS = 30;
export const TOTAL = 1752;
export type V3 = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const glide = (u: number) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };
export const pop = (u: number) => { const x = clamp01(u); return x >= 1 ? 1 : 1 - Math.cos(x * Math.PI * 1.5) * (1 - x) ** 1.6; };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const LAB: V3 = [-400, 0, 0];
export const CHAIR: V3 = [26, 0, 44];
export const TOUR: V3 = [5.5, 0, 28];

export type Light = "day" | "golden";
export type ShotDef = { id: number; a: number; b: number; light: Light; era: "now" | "1173" | "war" | "1272" | "1990" | "fix" };
export const SHOTS: ShotDef[] = [
  { id: 1, a: 0, b: 161, light: "day", era: "now" },      // hook: tourists "holding it up", worried tower
  { id: 2, a: 161, b: 266, light: "day", era: "1173" },   // brand-new, shiny white marble, scaffolding
  { id: 3, a: 266, b: 305, light: "day", era: "1173" },   // cutaway: a three-metre foundation
  { id: 4, a: 305, b: 390, light: "day", era: "1173" },   // big mistake: soft wet clay (builder's boot sinks)
  { id: 5, a: 390, b: 449, light: "day", era: "1173" },   // by the third floor one side is sinking
  { id: 6, a: 449, b: 566, light: "day", era: "war" },    // war: tools down, a century of calendar pages
  { id: 7, a: 566, b: 702, light: "day", era: "1272" },   // they come back, build the new floors taller on the short side
  { id: 8, a: 702, b: 797, light: "day", era: "1272" },   // bent like a banana
  { id: 9, a: 797, b: 945, light: "day", era: "1990" },   // 1990: 5.5 degrees, closed to the public
  { id: 10, a: 945, b: 1116, light: "day", era: "1990" }, // why hasn't it fallen: centre of weight vs edge of base
  { id: 11, a: 1116, b: 1248, light: "day", era: "now" }, // chair: fine, fine, fine... too far
  { id: 12, a: 1248, b: 1310, light: "day", era: "1990" }, // Pisa was getting close to that centimetre
  { id: 13, a: 1310, b: 1398, light: "day", era: "fix" }, // hundreds of tonnes of lead on the high side
  { id: 14, a: 1398, b: 1515, light: "day", era: "fix" }, // drilling the soil out, a few buckets at a time
  { id: 15, a: 1515, b: 1595, light: "day", era: "fix" }, // slowly sinks back 45 cm
  { id: 16, a: 1595, b: TOTAL, light: "day", era: "now" }, // safe for 200 years; still hasn't landed; give it time
];
export const FLASH_AT = -100; // no flash: the hook dissolves like every other change
export const XF = 6;
export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
/** dissolve at every boundary, centred on the boundary frame, S-curve alpha (both shots keep moving) */
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    if (s.id === 1) continue;
    if (f >= s.a - XF / 2 && f < s.a + XF / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: smooth((f - (s.a - XF / 2) + 1) / (XF + 1)) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};

// ---- story state ----
/** lean in degrees (top toward +x) */
export const tilt = (f: number) => {
  if (f < 161) return 3.97;
  if (f < 390) return 0;
  if (f < 449) return lerp(0, 1.6, smooth((f - 425) / 26));
  if (f < 566) return lerp(1.6, 2.2, smooth((f - 449) / 117));
  if (f < 702) return lerp(2.2, 2.8, smooth((f - 566) / 136));
  if (f < 797) return 3.2;
  if (f < 1515) return 5.5;
  if (f < 1595) return lerp(5.5, 3.97, smooth((f - 1530) / 55));
  return 3.97;
};
/** storeys standing (of 8) */
export const storeys = (f: number) => {
  if (f < 161 || f >= 702) return 8;
  if (f < 566) return f < 185 ? 2 : 3;
  return 3 + [600, 622, 644, 666, 688].filter((k) => f >= k).length;
};
/** pop-in progress of storey k (0..1) when it is being added */
export const storeyPop = (f: number, k: number) => {
  if (f < 161 || f >= 702 || k < 2) return 1;
  const at = k === 2 ? 185 : [600, 622, 644, 666, 688][k - 3];
  return f >= at ? pop((f - at) / 10) : 0;
};
export const scaffold = (f: number) => f >= 161 && f < 449;
export const closed = (f: number) => f >= 900 && f < 945 + 300 && f < 1595;
export const leadBlocks = (f: number) => (f < 1310 || f >= 1595 ? (f >= 1515 && f < 1595 ? 8 : 0) : Math.min(8, Math.floor(Math.max(0, f - 1352) / 5)));

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
/** base push (~4 %/s) times one bell move: subject scale +amt, S-curve centred on `peak` over `dur` frames */
export const pk = (f: number, f0: number, peak = -1, amt = 0.35, dur = 36, base = 0.0014) =>
  Math.exp(-base * Math.max(0, f - f0)) * (peak < 0 ? 1 : 1 / (1 + amt * glide((f - (peak - dur / 2)) / dur)));
const dolly = (pos: V3, look: V3, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos: [look[0] + (pos[0] - look[0]) * k, look[1] + (pos[1] - look[1]) * k, look[2] + (pos[2] - look[2]) * k], look, ...rest });
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** where the face sits (tower front, ~storey 2-3), for framing the protagonist */
export const FACE_Y = 14.5;

const CAMS: Record<number, Key[]> = {
  1: [{ f: 0, s: (f) => dolly([8.5, 1.35, 33], [3, 9.5, 0], pk(f, 0, 142, 0.3), { fov: 56, roll: -0.05 }) }],
  2: [{ f: 158, s: (f) => dolly([12, 1.7, 22], [3, 7.5, 0], pk(f, 158, 230, 0.3), { fov: 54 }) }],
  3: [{ f: 263, s: (f) => dolly(add(LAB, [0, 4, 15]), add(LAB, [0, 3.6, 0]), pk(f, 263, 282, 0.3, 24), { fov: 46 }) }],
  4: [{ f: 302, s: (f) => dolly([10.5, 1.5, 14.8], [9.6, 1.0, 11.2], pk(f, 302, 367, 0.45), { fov: 44, roll: 0.06 }) }],
  5: [{ f: 387, s: (f) => dolly([13, 2.2, 36], [2, 10, 0], pk(f, 387, 430, 0.3, 30), { fov: 52, roll: -0.04 }) }],
  6: [{ f: 446, s: (f) => dolly([-10, 2.2, 36], [0, 12, 0], pk(f, 446, 535, 0.3, 50), { fov: 54, roll: 0.03 }) }],
  7: [
    { f: 563, s: (f) => dolly([14, 2.5, 34], [0, 12, 0], pk(f, 563, 655, 0.25, 60), { fov: 52 }) },
    { f: 600, dur: 90, s: (f) => dolly([24, 8, 62], [2, 28, 0], pk(f, 600, -1), { fov: 54 }) },
  ],
  8: [{ f: 699, s: (f) => dolly([0, 26, 95], [3, 28, 0], pk(f, 699, 778, 0.3, 30), { fov: 50, roll: 0.05 }) }],
  9: [
    { f: 794, s: (f) => dolly([8, 1.4, 34], [2, 11, 0], pk(f, 794, 866, 0.2), { fov: 58 }) },
    { f: 900, dur: 30, s: (f) => dolly([4, 1.5, 22], [1, 6, 12], pk(f, 900, 925, 0.25, 24), { fov: 50, roll: 0.04 }) },
  ],
  10: [{ f: 942, s: (f) => dolly([0, 26, 105], [2, 26, 0], pk(f, 942, 1088, 0.3, 40), { fov: 52 }) }],
  11: [{ f: 1113, s: (f) => dolly(add(CHAIR, [3.6, 1.0, 3.4]), add(CHAIR, [0.1, 0.9, 0]), pk(f, 1113, 1201, 0.15, 30), { fov: 44, roll: 0.03 }) }],
  12: [{ f: 1245, s: (f) => dolly([2, FACE_Y + 0.5, 30], [1.5, FACE_Y, 0], pk(f, 1245, 1265, 0.5, 24), { fov: 40, roll: -0.08 }) }],
  13: [{ f: 1307, s: (f) => dolly([-24, 2.0, 22], [-10, 2.5, 2], pk(f, 1307, 1360, 0.35, 30), { fov: 48, roll: 0.04 }) }],
  14: [{ f: 1395, s: (f) => dolly(add(LAB, [0, 4.4, 16]), add(LAB, [0, 3.4, 0]), pk(f, 1395, 1480, 0.3, 50), { fov: 50 }) }],
  15: [{ f: 1512, s: (f) => dolly([6, 3, 70], [2, 26, 0], pk(f, 1512, 1553, 0.3, 40), { fov: 50, roll: -0.03 }) }],
  16: [
    { f: 1592, s: (f) => dolly([9, 1.3, 34], [3, 13, 0], pk(f, 1592, 1678, 0.3, 40), { fov: 50, roll: -0.05 }) },
    { f: 1705, dur: 26, s: (f) => dolly([2.5, FACE_Y + 1, 26], [1.6, FACE_Y + 0.5, 0], pk(f, 1705, -1), { fov: 42 }) },
  ],
};
export const camAt = (id: number, f: number): Cam => run(CAMS[id], f);

type Dof = { f: number; dur?: number; cInf: number; focus?: (f: number) => V3 };
const DOF: Dof[] = [
  { f: 0, cInf: 9, focus: () => [TOUR[0], 1.6, TOUR[2]] }, { f: 158, cInf: 3 }, { f: 263, cInf: 0 },
  { f: 302, cInf: 14 }, { f: 387, cInf: 3 }, { f: 446, cInf: 4 }, { f: 563, cInf: 3 }, { f: 699, cInf: 0 },
  { f: 794, cInf: 8, focus: () => [TOUR[0], 1.6, TOUR[2] - 2] }, { f: 942, cInf: 0 }, { f: 1113, cInf: 14 },
  { f: 1245, cInf: 6 }, { f: 1307, cInf: 10 }, { f: 1395, cInf: 0 }, { f: 1512, cInf: 0 },
  { f: 1592, cInf: 9, focus: () => [TOUR[0], 1.6, TOUR[2]] }, { f: 1705, dur: 26, cInf: 4 },
];
export const dofAt = (f: number) => {
  let i = 0; while (i + 1 < DOF.length && f >= DOF[i + 1].f) i++;
  const d = DOF[i], p = DOF[Math.max(0, i - 1)];
  const k = d.dur ? Math.min(1, (f - d.f) / d.dur) : 1;
  return { cInf: p.cInf + (d.cInf - p.cInf) * k, focus: d.focus };
};
