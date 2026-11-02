// "The War the Army Lost to Birds" (the Great Emu War, 1932): shot plan, story state, cameras and lens per beat,
// all timed to voice/words.json (63.5 s, 30 fps). World: wheat paddocks around x/z = 0, a dirt track along x,
// the farm at (-30, 0, -40), the watering hole (dam) at DAM, the outback stretching away.
export const FPS = 30;
export const TOTAL = 1920;
export type V3 = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const glide = (u: number) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };
/** seconds -> frame, landing reactions 2 frames ahead of the word */
export const W = (s: number) => Math.round(s * FPS) - 2;

export const FARM: V3 = [-30, 0, -40];
export const CAMP: V3 = [10, 0, 6];          // where the army's truck parks (on the track)
export const DAM: V3 = [80, 0, -20];         // the watering hole
export const AMBUSH: V3 = [80, 0, -5];       // the gun position at the dam (south bank)
export const PLAIN: V3 = [-120, 0, 60];      // open paddock for the scatter / truck chase / explanation
export const HOOK: V3 = [40, 0, 40];         // hook: the gunner in the wheat

export type Light = "day" | "golden";
export type ShotDef = { id: number; a: number; b: number; light: Light };
export const SHOTS: ShotDef[] = [
  { id: 1, a: 0, b: 138, light: "day" },       // hook: machine gun vs emus, emus win
  { id: 2, a: 138, b: 299, light: "day" },     // veterans' wheat farms
  { id: 3, a: 299, b: 382, light: "day" },     // 20,000 emus arrive and eat
  { id: 4, a: 382, b: 559, light: "day" },     // the army arrives: major, 2 soldiers, 2 guns, 10,000 bullets
  { id: 5, a: 559, b: 598, light: "day" },     // "how hard could it be?"
  { id: 6, a: 598, b: 731, light: "day" },     // day one: emus scatter every direction
  { id: 7, a: 731, b: 936, light: "day" },     // the ambush at the dam: fire, a dozen, jam
  { id: 8, a: 936, b: 1117, light: "day" },    // machine gun on a truck, bumpy chase
  { id: 9, a: 1117, b: 1205, light: "day" },   // "wait..." soldier and emu eye to eye
  { id: 10, a: 1205, b: 1496, light: "day" },  // explanation: small groups + lookouts
  { id: 11, a: 1496, b: 1590, light: "day" },  // hit, keeps running
  { id: 12, a: 1590, b: 1682, light: "day" },  // the tally: ten bullets each
  { id: 13, a: 1682, b: 1826, light: "golden" }, // "face any army in the world": emu army in helmets
  { id: 14, a: 1826, b: 1879, light: "golden" }, // the army goes home
  { id: 15, a: 1879, b: TOTAL, light: "golden" }, // the emus stayed
];
export const XFADE: Record<number, number> = { 2: 8, 10: 8, 13: 8 };
export const FLASH_AT = 138;
// impact flip-kicks [frame, roll amplitude]: gunfire, jam, bumps, the hit
export const KICKS: [number, number][] = [[W(29.24), 0.012], [W(30.68), 0.014], [W(35.34), 0.02], [W(50.52), 0.014]];

export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    const x = XFADE[s.id];
    if (x && f >= s.a - x / 2 && f < s.a + x / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: (f - (s.a - x / 2) + 1) / (x + 1) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};

// ---- story state ----
/** gunfire flashes: frames where a muzzle flash shows */
export const firing = (f: number) => {
  if (f < 138) return f > 30 && f < 120 && f % 4 < 2;
  if (f >= W(29.08) && f < W(30.68)) return f % 4 < 2;
  return false;
};
export const jammed = (f: number) => f >= W(30.68) && f < 936;
/** the truck along the chase line in shot 8 (x from the plain's west side), with its bounce */
export const truckX = (f: number) => PLAIN[0] - 40 + 9.5 * ((f - 936) / FPS);
export const bump = (f: number) => 0.18 * Math.abs(Math.sin(f * 0.9)) + 0.12 * Math.abs(Math.sin(f * 2.3 + 1));

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
  1: [{ f: 0, s: (f) => dolly(add(HOOK, [2.2, 0.9, 4.2]), add(HOOK, [-1.2, 0.9, -3]), push(f, 0, 0.0025), { fov: 46, roll: -0.05 }) }],
  2: [
    { f: 138, s: (f) => dolly(add(FARM, [45, 30, 70]), add(FARM, [0, 3, 0]), push(f, 138, 0.0018), { fov: 44 }) },
    { f: W(6.64), dur: 40, s: (f) => dolly(add(FARM, [14, 2.2, 16]), add(FARM, [2, 1.6, 6]), push(f, W(6.64), 0.002), { fov: 42 }) },
  ],
  3: [{ f: 299, s: (f) => dolly(add(FARM, [-1.5, 1.2, 21]), add(FARM, [4, 0.9, 9]), push(f, 299, 0.003), { fov: 48, roll: 0.04 }) }],
  4: [
    { f: 382, s: (f) => dolly(add(CAMP, [-14, 2.0, 12]), add(CAMP, [0, 1.3, 0]), push(f, 382, 0.002), { fov: 44 }) },
    { f: W(15.6), dur: 30, s: (f) => dolly(add(CAMP, [-2, 1.6, 7.5]), add(CAMP, [0.5, 1.3, 0.5]), push(f, W(15.6), 0.0025), { fov: 42 }) },
    { f: W(17.44), cut: true, s: (f) => dolly(add(CAMP, [3.2, 1.3, 3.6]), add(CAMP, [2.6, 0.4, 1.2]), push(f, W(17.44), 0.004), { fov: 40, roll: 0.05 }) },
  ],
  5: [{ f: 559, s: (f) => dolly(add(CAMP, [-0.6, 1.5, 2.6]), add(CAMP, [-0.4, 1.45, 0.6]), push(f, 559, 0.004), { fov: 38 }) }],
  6: [{ f: 598, s: (f) => dolly(add(PLAIN, [0, 9, 26]), add(PLAIN, [0, 0.5, -4]), push(f, 598, 0.0015), { fov: 50, roll: 0.02 }) }],
  7: [
    { f: 731, s: (f) => dolly(add(AMBUSH, [-6, 1.2, 6]), add(DAM, [0, 1, 0]), push(f, 731, 0.0015), { fov: 46 }) },
    { f: W(27.14), dur: 30, s: (f) => dolly(add(DAM, [12, 3, 16]), add(DAM, [0, 1, -2]), push(f, W(27.14), 0.002), { fov: 46 }) },
    { f: W(28.74), cut: true, s: (f) => dolly(add(AMBUSH, [2.4, 1.0, 2.4]), add(AMBUSH, [0, 0.7, -0.4]), push(f, W(28.74), 0.003), { fov: 42, roll: -0.04 }) },
  ],
  8: [
    { f: 936, s: (f) => { const x = truckX(f); return { pos: [x + 2.5, 1.7, PLAIN[2] + 9], look: [x + 0.8, 1.4, PLAIN[2]], fov: 50, roll: 0.03 }; } },
    { f: W(33.46), dur: 20, s: (f) => { const x = truckX(f); return { pos: [x + 16, 1.0, PLAIN[2] - 7], look: [x + 4, 1.2, PLAIN[2]], fov: 48, roll: -0.04 }; } },
  ],
  9: [{ f: 1117, s: (f) => dolly(add(PLAIN, [0.1, 1.85, 3.6]), add(PLAIN, [0, 1.85, 0]), push(f, 1117, 0.003), { fov: 38 }) }],
  10: [
    { f: 1205, s: (f) => dolly(add(PLAIN, [0, 24, 42]), add(PLAIN, [0, 0, -4]), push(f, 1205, 0.0012), { fov: 46 }) },
    { f: W(45.44), dur: 30, s: (f) => dolly(add(PLAIN, [2.5, 3.2, 19]), add(PLAIN, [0, 2.2, 8]), push(f, W(45.44), 0.003), { fov: 42, roll: 0.03 }) },
    { f: W(47.58), cut: true, s: (f) => dolly(add(PLAIN, [0, 24, 42]), add(PLAIN, [0, 0, -4]), push(f, W(47.58), 0.0012), { fov: 46 }) },
  ],
  11: [{ f: 1496, s: (f) => { const x = PLAIN[0] - 10 + 8 * ((f - 1496) / FPS); return { pos: [x + 3, 1.3, PLAIN[2] + 8], look: [x, 1.3, PLAIN[2]], fov: 42, roll: -0.03 }; } }],
  12: [{ f: 1590, s: (f) => dolly(add(CAMP, [1.4, 1.6, 4.2]), add(CAMP, [1.2, 1.3, 0.8]), push(f, 1590, 0.003), { fov: 42 }) }],
  13: [
    { f: 1682, s: (f) => dolly(add(CAMP, [-0.8, 1.7, 3.0]), add(CAMP, [-0.6, 1.8, 0.8]), push(f, 1682, 0.003), { fov: 40 }) },
    { f: W(59.28), cut: true, s: (f) => dolly(add(PLAIN, [6, 2.2, 20]), add(PLAIN, [0, 1.6, 0]), push(f, W(59.28), 0.002), { fov: 48, roll: 0.03 }) },
  ],
  14: [{ f: 1826, s: (f) => dolly(add(CAMP, [-18, 2.5, 14]), add(CAMP, [8, 1.5, 0]), push(f, 1826, 0.0015), { fov: 46 }) }],
  15: [{ f: 1879, s: (f) => dolly(add(HOOK, [1.6, 1.5, 4.2]), add(HOOK, [0, 1.6, 0]), push(f, 1879, 0.004), { fov: 40 }) }],
};
export const camAt = (id: number, f: number): Cam => {
  const c = run(CAMS[id], f);
  for (const [k, a] of KICKS) { const d = f - k; if (d >= 0 && d < 8 && shotAt(k).id === id) c.roll += a * (d % 2 ? -1 : 1) * (1 - d / 8); }
  if (id === 8) { const b = bump(f); c.pos[1] += b * 0.5; c.roll += 0.02 * Math.sin(f * 1.3); }
  return c;
};

type Dof = { f: number; dur?: number; cInf: number; focus?: (f: number) => V3 };
const DOF: Dof[] = [
  { f: 0, cInf: 10 },
  { f: 138, cInf: 0 },
  { f: W(6.64), dur: 40, cInf: 8 },
  { f: 299, cInf: 10 },
  { f: 382, cInf: 6 },
  { f: W(17.44), cInf: 13 },
  { f: 559, cInf: 14 },
  { f: 598, cInf: 0 },
  { f: 731, cInf: 6 },
  { f: W(28.74), cInf: 12 },
  { f: 936, cInf: 6 },
  { f: 1117, cInf: 14 },
  { f: 1205, cInf: 0 },
  { f: W(45.44), dur: 30, cInf: 8 },
  { f: W(47.58), cInf: 0 },
  { f: 1496, cInf: 8 },
  { f: 1590, cInf: 12 },
  { f: W(59.28), dur: 26, cInf: 4 },
  { f: 1826, cInf: 4 },
  { f: 1879, cInf: 12 },
];
export const dofAt = (f: number) => {
  let i = 0; while (i + 1 < DOF.length && f >= DOF[i + 1].f) i++;
  const d = DOF[i], p = DOF[Math.max(0, i - 1)];
  const k = d.dur ? Math.min(1, (f - d.f) / d.dur) : 1;
  return { cInf: p.cInf + (d.cInf - p.cInf) * k, focus: d.focus };
};
