// One three.js world for "The Building That Cooked Breakfast": sky, city streets (Eastcheap), the concave glass tower
// (top-heavy, south face curving in toward the street), its sunbeam, the sunshade fins, the flat-window diagram
// stage, the Las Vegas pool, and the cast. update(id, f, cam) poses everything for shot `id` at frame f.
// Look values (two-tone shading, sky stops, fog = horizon, ink layers, card shading) come from the bridge template.
import * as THREE from "three";
import { Batch, boxGeo, V, lam, quad, house, Kit } from "../bridge/build";
import { ctex, rep, stoneHD, cloudHD } from "../bridge/paint";
import { Pen, bodyFront, bodySide, fxBurst, fxContact, fxSplash, Outfit, Expr, FrontOpts, SideOpts, SKINS, KID, INK } from "../bridge/toon";
import { LIGHTS, LOOK } from "../bridge/lights";
import { TONE, CHAR, untone } from "../bridge/shade";
import { NOINK } from "../bridge/ink";
import { Pool, Actor, Fx } from "../bridge/cast";
import { car, doormat, smoke, bike, pan, magnifier, leaf, glow, rosette, palm, lounger, umbrella, spoon, dish, handle, coffee, cash, sweat, flame, glint, steam, trophy } from "./draw";
import {
  FPS, SHOTS, V3, HOT, CAR, SHOP, BIKE, KIDP, LAB, VEGAS, ARCH, W, camAt, melt, reporterX, eggT, shadeFins, rayIn, smooth, clamp01, pop, carArrive, carBounce, sunSwing,
} from "./story";

export const loadKit = () => Promise.resolve({} as Kit); // no external models: everything is built or painted here

// ---------------- the tower ----------------
type TowerSpec = { cx: number; cz: number; H: number; w0: number; w1: number; z0: number; lean: number; dish: number; back: number };
export const TOWER: TowerSpec = { cx: 0, cz: 0, H: 160, w0: 44, w1: 62, z0: -24, lean: 16, dish: 4, back: -58 };
const HOTEL: TowerSpec = { cx: VEGAS[0], cz: VEGAS[2] - 26, H: 100, w0: 70, w1: 74, z0: 0, lean: 2, dish: 14, back: -22 };
const widthAt = (T: TowerSpec, y: number) => T.w0 + (T.w1 - T.w0) * (y / T.H);
/** z of the south face at (x, y): leans out toward the street as it rises (concave in section) and dishes in plan */
export const faceZ = (T: TowerSpec, x: number, y: number) => {
  const u = y / T.H, hw = widthAt(T, y) / 2;
  return T.cz + T.z0 + T.lean * u ** 1.7 - T.dish * (1 - (x / hw) ** 2);
};
const grid = (nx: number, ny: number, pt: (i: number, j: number) => THREE.Vector3, uv: (i: number, j: number) => [number, number]) => {
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const p = pt(i, j); pos.push(p.x, p.y, p.z); uvs.push(...uv(i, j)); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
};
const glassTex = (key: string, top: string, mid: string, low: string, frame: string) => ctex(key, 512, 1024, (g, r) => {
  const gr = g.createLinearGradient(0, 0, 0, 1024);
  gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, low);
  g.fillStyle = gr; g.fillRect(0, 0, 512, 1024);
  // painted sky reflections: soft diagonal light streaks and a few cloud blobs
  g.globalAlpha = 0.18; g.fillStyle = "#ffffff";
  for (let k = 0; k < 4; k++) { const y = 140 + k * 230 + r() * 60; g.beginPath(); g.moveTo(0, y); g.lineTo(512, y - 160); g.lineTo(512, y - 110); g.lineTo(0, y + 50); g.fill(); }
  g.globalAlpha = 1;
  // mullions (vertical) and floor bands (horizontal), 8 x 16 panes per tile
  g.fillStyle = frame;
  for (let i = 0; i <= 8; i++) g.fillRect(i * 64 - 3, 0, 6, 1024);
  for (let j = 0; j <= 16; j++) g.fillRect(0, j * 64 - 5, 512, 10);
  for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(255,255,255,${0.12 + 0.2 * r()})`; g.fillRect(Math.floor(r() * 8) * 64 + 6, Math.floor(r() * 16) * 64 + 8, 52, 50); }
});
const buildTower = (b: Batch, T: TowerSpec, glass: THREE.Material, roofM: THREE.Material) => {
  const NX = 28, NY = 40, floors = T.H / 4.2;
  // south face (concave), uv: one tile = 8 bays x 16 floors
  b.add(grid(NX, NY, (i, j) => { const y = (j / NY) * T.H, hw = widthAt(T, y) / 2, x = -hw + (2 * hw * i) / NX; return V(T.cx + x, y, faceZ(T, x, y)); },
    (i, j) => [(i / NX) * (T.w1 / 1.6) / 8, (j / NY) * floors / 16]), glass);
  // east / west sides: from the face edge back to the flat north face
  for (const s of [-1, 1]) b.add(grid(8, NY, (i, j) => {
    const y = (j / NY) * T.H, hw = widthAt(T, y) / 2, zf = faceZ(T, s * hw, y), zb = T.cz + T.back, k = s > 0 ? i / 8 : 1 - i / 8;
    return V(T.cx + s * hw, y, zf + (zb - zf) * k);
  }, (i, j) => [(i / 8) * 2.5, (j / NY) * floors / 16]), glass);
  // north face, flat
  b.add(grid(8, NY, (i, j) => { const y = (j / NY) * T.H, hw = widthAt(T, y) / 2; return V(T.cx + hw - (2 * hw * i) / 8, y, T.cz + T.back); },
    (i, j) => [(i / 8) * (T.w1 / 1.6) / 8, (j / NY) * floors / 16]), glass);
  // roof garden cap: a sloped glazed lid, green inside
  const hw = widthAt(T, T.H) / 2, pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) { const x = -hw + (2 * hw * i) / 12; pts.push(V(T.cx + x, T.H, faceZ(T, x, T.H))); }
  pts.push(V(T.cx + hw, T.H, T.cz + T.back), V(T.cx - hw, T.H, T.cz + T.back));
  const c = V(T.cx, T.H + 6, (faceZ(T, 0, T.H) + T.cz + T.back) / 2), pos: number[] = [];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], d = pts[(i + 1) % pts.length]; pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z); }
  const lid = new THREE.BufferGeometry(); lid.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); lid.computeVertexNormals();
  b.add(lid, roofM);
};

// ---------------- helpers ----------------
/** ground quad facing up, uv tiled every `tile` metres */
const ground = (x0: number, x1: number, z0: number, z1: number, y: number, tile: number) =>
  quad(V(x0, y, z1), V(x1, y, z1), V(x1, y, z0), V(x0, y, z0), (x1 - x0) / tile, (z1 - z0) / tile);
const asphalt = () => ctex("asphalt", 1024, 1024, (g, r) => {
  g.fillStyle = "#6c6a72"; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? "rgba(40,38,46,0.25)" : "rgba(170,168,176,0.18)"; const s = 2 + r() * 5; g.fillRect(r() * 1024, r() * 1024, s, s); }
  g.fillStyle = "rgba(50,48,56,0.35)"; for (let k = 0; k < 6; k++) g.fillRect(0, r() * 1024, 1024, 3);
});
const kerbStone = () => stoneHD("pavingHD", ["#cfc6b8", "#c6bdaf", "#d6cec1", "#bdb4a6"], "#9c9284");
const DAY_SUN = new THREE.Vector3(0.42, 0.74, 0.53).normalize();
const GOLD_SUN = new THREE.Vector3(0.72, 0.16, 0.68).normalize();

/** a thin glowing rod from a to b, grown to fraction u (light rays of the explanation) */
class Ray {
  m: THREE.Mesh;
  constructor(parent: THREE.Object3D, mat: THREE.Material, r: number) {
    const g = new THREE.CylinderGeometry(r, r, 1, 8, 1, true); g.translate(0, 0.5, 0);
    this.m = new THREE.Mesh(g, mat); this.m.layers.set(NOINK); this.m.visible = false; this.m.frustumCulled = false;
    parent.add(this.m);
  }
  set(a: V3, b: V3, u: number) {
    const A = V(...a), B = V(...b), d = B.clone().sub(A), L = d.length();
    this.m.visible = u > 0.001;
    this.m.position.copy(A);
    this.m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    this.m.scale.set(1, Math.max(1e-3, L * u), 1);
  }
}

// ---------------- the cast ----------------
type Place = { key: string; draw: (p: Pen) => void; x: number; y: number; z: number; size: [number, number, number]; card?: [number, number]; mirror?: boolean; yaw?: number };
type FxPlace = { key: string; cw: number; ch: number; draw: (p: Pen) => void; x: number; y: number; z: number; w: number; h: number; flat?: boolean; rot?: number; soft?: boolean; glow?: number };
type Stage = { places: Place[]; fx: FxPlace[] };
type CamInfo = { pos: THREE.Vector3; right: THREE.Vector3; sun: THREE.Vector3 };

const BIZ: Outfit = { jacket: "#2f3e5c", pants: "#2a2f3d", boots: "#1b1b1b", hat: "hair", hair: "#3b2a20", skin: SKINS[0] };
const REPORTER: Outfit = { jacket: "#b5653f", pants: "#3b3f52", boots: "#4a3426", hat: "cap", cap: "#3f6fb5", skin: SKINS[3] };
const ARCHITECT: Outfit = { jacket: "#26262c", pants: "#26262c", boots: INK, hat: "hair", hair: "#dcdcdc", skin: SKINS[2], build: "stout" };
const FOLK: Outfit[] = [
  { jacket: "#3f6fb5", pants: "#3b3f52", boots: "#4a3426", hat: "hair", hair: "#5a3b2a", skin: SKINS[1] },
  { jacket: "#8c3b4a", pants: "#2f3440", boots: "#2a2a2a", hat: "hair", hair: "#d9a441", skin: SKINS[0], dress: "#5a8fc2" },
  { jacket: "#5d7a3a", pants: "#3b3f52", boots: "#4a3426", hat: "cap", cap: "#e2453c", skin: SKINS[3] },
  { jacket: "#2f5f6a", pants: "#3b3f52", boots: "#2a2a2a", hat: "hair", hair: "#1e1a18", skin: SKINS[2] },
  { jacket: "#d9a441", pants: "#3b5b9a", boots: "#4a3426", hat: "hair", hair: "#8a4f2c", skin: SKINS[1], dress: "#c25a7a" },
];
/** ground height at (x, z): the pavements and the tower plaza are raised 15 cm above the road */
export const gy = (x: number, z: number) => (Math.abs(z) > 4.1 && Math.abs(z) < 6.6) || (Math.abs(x) < 24 && z < -6.4 && z > -40) ? 0.15 : x > 300 ? 0.01 : 0;
const SU = 0.00216; // metres per design unit (bridge cast.ts): 1000 units = 2.16 m
const q = (v: number, n = 120) => Math.round(v * n) / n;
const fkey = (o: object) => JSON.stringify(o, (_k, v) => (typeof v === "number" ? q(v) : v));
/** canvas tiers by distance (smaller than the bridge's 2K tiers: this build targets 1080 x 1920) */
const tier = (d: number): [number, number, number] => (d < 3 ? [900, 1500, 1.5] : d < 8 ? [600, 1000, 1] : d < 20 ? [360, 600, 0.6] : [180, 300, 0.3]);
const lidAt = (f: number, i: number) => { const k = (f + i * 23) % 61; return k < 4 ? [0.5, 1, 1, 0.5][k] : 0; };
const light2D = (cam: CamInfo, mirror: boolean) => {
  const sx = cam.sun.dot(cam.right) * (mirror ? -1 : 1), sy = -cam.sun.y;
  return Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) * (Math.PI / 4);
};
let SEED = 1;
const front = (cam: CamInfo, o: Outfit, ok: string, x: number, z: number, fo: FrontOpts, i: number, f: number): Place => {
  const d = cam.pos.distanceTo(V(x, 1.2, z)), [w, h, k] = tier(d);
  const f2: FrontOpts = { blink: lidAt(f, i), ...fo, light: light2D(cam, false), seed: (i % 7) + 1 };
  return { key: `F|${ok}|${fkey(f2)}`, x, y: gy(x, z), z, size: [w, h, k], draw: (p) => bodyFront(p, o, f2) };
};
const side = (cam: CamInfo, o: Outfit, ok: string, x: number, z: number, dirX: number, so: SideOpts, i: number, f: number): Place => {
  const d = cam.pos.distanceTo(V(x, 1.2, z)), [w, h, k] = tier(d);
  const mirror = dirX * (cam.right.x) < 0;
  const s2: SideOpts = { blink: lidAt(f, i), ...so, light: light2D(cam, mirror), seed: (i % 7) + 1 };
  return { key: `S|${ok}|${fkey(s2)}`, x, y: gy(x, z), z, mirror, size: [w, h, k], draw: (p) => bodySide(p, o, s2) };
};
const contact = (out: Stage, x: number, z: number, s = 1) =>
  out.fx.push({ key: "blob|contact|#3a3a55", cw: 128, ch: 128, draw: (p) => fxContact(p, "#3a3a55"), x, y: gy(x, z) + 0.02, z, w: 0.6 * s, h: 0.45 * s, flat: true });
const puff = (out: Stage, f: number, at: V3, n = 3, size = 0.8, period = 40, dark = false) => {
  for (let k = 0; k < n; k++) {
    const u = (((f + (k * period) / n) % period) + period) % period / period;
    const tq = Math.round(u * 12) / 12;
    out.fx.push({ key: `smoke${dark ? "d" : ""}|${tq}`, cw: 300, ch: 300, draw: (p) => smoke(p, tq, dark), x: at[0] + 0.15 * Math.sin(k * 2.1 + u * 3), y: at[1] + u * 2.2 * size, z: at[2], w: size * (0.7 + u), h: size * (0.7 + u), soft: true });
  }
};

const ARM: Record<string, [number, number, number, number]> = {
  headL: [-0.5, -0.3, -0.22, -0.72], headR: [0.5, -0.3, 0.22, -0.72],
  upL: [-0.3, -0.5, -0.42, -1.0], upR: [0.3, -0.5, 0.42, -1.0],
  shrugL: [-0.42, 0.22, -0.62, 0.0], shrugR: [0.42, 0.22, 0.62, 0.0],
  pointR: [0.45, -0.2, 0.95, -0.5], holdR: [0.4, 0.42, 0.12, 0.4], holdL: [-0.4, 0.42, -0.12, 0.4],
  hipL: [-0.45, 0.25, -0.14, 0.55], hipR: [0.45, 0.25, 0.14, 0.55], thumbR: [0.42, 0.3, 0.3, -0.08],
  mouthR: [0.38, 0.35, 0.04, -0.14], patR: [0.45, 0.12, 0.85, 0.38], giveR: [0.42, 0.25, 0.7, 0.1], takeL: [-0.42, 0.25, -0.7, 0.1],
};
const SHOPK: Outfit = { jacket: "#2f6a43", pants: "#3b3f52", boots: "#2a2a2a", hat: "hair", hair: "#9a9a9a", skin: SKINS[0], moustache: "#7a7a7a", build: "stout" };
const CYCLIST: Outfit = { jacket: "#f2c230", pants: "#2a2a2a", boots: "#2a2a2a", hat: "cap", cap: "#e2453c", skin: SKINS[2] };
const OWNER: Outfit = { jacket: "#4a4f5c", pants: "#2f3440", boots: "#1b1b1b", hat: "hair", hair: "#1e1a18", skin: SKINS[1] };
const TOURIST: Outfit = { jacket: "#f2a33a", pants: "#3fa0d0", boots: "#f4f1ea", hat: "hair", hair: "#d9a441", skin: SKINS[1] };

/** who and what stands where in shot id at frame f */
const stage = (id: number, f: number, cam: CamInfo): Stage => {
  const out: Stage = { places: [], fx: [] }, t = f / FPS;
  const m = melt(f);
  const carCard = (x: number, mm = m, y = 0) => {
    const key = `car|${q(mm.mirror, 24)}|${q(mm.badge, 24)}|${q(mm.panel, 24)}`;
    const d = cam.pos.distanceTo(V(x, 1, CAR[2])), big = d < 7;
    out.places.push({ key, x, y, z: CAR[2], size: big ? [1600, 640, 1] : [800, 320, 0.5], card: [5.0, 2.0], draw: (p) => car(p, mm) });
    for (const dx of [-1.6, 1.4]) contact(out, x + dx, CAR[2] + 0.05, 2.2);
  };
  const steamAt = (x: number, y: number, z: number, s = 0.6) => {
    const tq = Math.round(((t * 1.5) % 1) * 12) / 12;
    out.fx.push({ key: `steam|${tq}`, cw: 300, ch: 400, draw: (p) => steam(p, tq), x, y, z, w: s * 0.75, h: s, soft: true });
  };
  const popFx = (key: string, cw: number, ch: number, draw: (p: Pen) => void, x: number, y: number, z: number, w: number, h: number, f0: number, rot = 0) => {
    if (f < f0) return;
    const k = pop((f - f0) / 14);
    out.fx.push({ key, cw, ch, draw, x, y: y + h * (1 - k) * 0.5, z, w: w * k, h: h * k, rot });
  };
  const person = (o: Outfit, ok: string, x: number, z: number, fo: FrontOpts, i: number, extra: Partial<Place> = {}) => {
    const p = front(cam, o, ok, x, z, fo, i, f); Object.assign(p, extra); out.places.push(p); contact(out, x, z);
  };
  const walker = (o: Outfit, ok: string, x: number, z: number, dir: number, expr: Expr, i: number, stride = 0.7) => {
    out.places.push(side(cam, o, ok, x, z, dir, { mode: "march", phase: (t * 1.05) % 1, expr, stride }, i, f)); contact(out, x, z);
  };
  switch (id) {
    case 1: {
      carCard(CAR[0]);
      steamAt(CAR[0] + 0.9, 1.6, CAR[2] + 0.1); steamAt(CAR[0] - 0.8, 1.7, CAR[2] + 0.1, 0.8);
      if (f % 20 < 10) out.fx.push({ key: "glint", cw: 200, ch: 200, draw: glint, x: CAR[0] + 0.95 + 0.1 * Math.sin(f), y: 1.25, z: CAR[2] + 0.2, w: 0.25, h: 0.25, soft: true });
      break;
    }
    case 2: {
      if (f > W(7.28) && f < W(8.94)) for (let i = 0; i < 9; i++) {
        const on = (f + i * 5) % 18 < 9; if (!on) continue;
        const x = -20 + 5 * i, y = 30 + ((i * 37) % 110);
        out.fx.push({ key: "glint", cw: 200, ch: 200, draw: glint, x, y, z: faceZ(TOWER, x, y) + 1.5, w: 9, h: 9, soft: true });
      }
      popFx("spoon", 600, 1600, spoon, 62, 62, -10, 34, 90, W(9.52));
      break;
    }
    case 3: {
      const x = CAR[0] + carArrive(f);
      carCard(x, { mirror: 0, badge: 0, panel: 0 }, carBounce(f));
      if (f < 346) { const tq = Math.round(((t * 3) % 1) * 10) / 10; out.fx.push({ key: `smoke|${tq}`, cw: 300, ch: 300, draw: (p) => smoke(p, tq), x: x - 2.7, y: 0.35, z: CAR[2] + 0.2, w: 0.7, h: 0.7, soft: true }); }
      if (f >= 356 && f < 392) {
        const pat = f > 366 && f < 388, bob = pat ? 0.03 * Math.abs(Math.sin(f * 0.6)) : 0;
        const out_ = smooth((f - 356) / 9), bx = CAR[0] + 1.6 + 1.4 * out_, bz = CAR[2] - 0.6 + 1.5 * out_;
        person(BIZ, "biz", bx, bz, { mode: out_ < 1 ? "stroll" : "stand", phase: (t * 1.2) % 1, expr: pat ? "smile_closed" : "grin", look: -1, armR: pat ? ARM.patR : undefined, armL: pat ? undefined : ARM.hipL }, 1, { y: gy(bx, bz) + bob });
      } else if (f >= 392) {
        const wx = CAR[0] + 3.0 + 1.5 * ((f - 392) / FPS);
        walker(BIZ, "biz", wx, CAR[2] + 1.0, 1, "whistle", 1);
      }
      break;
    }
    case 4: {
      carCard(CAR[0], { mirror: 0, badge: 0, panel: 0 });
      const bx = CAR[0] + 9 - 1.4 * ((f - 426) / FPS);
      if (f > 426) {
        walker(BIZ, "biz", bx, CAR[2] + 1.0, -1, "smile", 1, 0.6);
        out.fx.push({ key: "coffee", cw: 200, ch: 300, draw: coffee, x: bx - 0.32, y: 0.95, z: CAR[2] + 1.1, w: 0.14, h: 0.21 });
      }
      break;
    }
    case 5: {
      carCard(CAR[0]);
      steamAt(CAR[0] + 0.95, 1.5, CAR[2] + 0.15, 0.5); steamAt(CAR[0] + 2.1, 1.3, CAR[2] + 0.15, 0.4);
      if (f >= 538) {
        const bx = CAR[0] + 3.2, bz = CAR[2] + 1.0, drop = f >= W(18.68);
        const expr: Expr = f < W(18.68) ? "shock" : "pained";
        person(BIZ, "biz", bx, bz, { mode: "stand", expr, look: -1, armL: drop ? ARM.headL : ARM.holdL, armR: drop ? ARM.headR : undefined, headTilt: drop ? -6 : 0 }, 1,
          { y: gy(bx, bz) + (f >= W(18.68) && f < W(18.68) + 6 ? 0.08 * Math.sin(((f - W(18.68)) / 6) * Math.PI) : 0) });
        if (!drop) out.fx.push({ key: "coffee", cw: 200, ch: 300, draw: coffee, x: bx - 0.3, y: 1.0, z: bz + 0.12, w: 0.14, h: 0.21 });
        else { const u = clamp01((f - W(18.68)) / 10); out.fx.push({ key: "coffee", cw: 200, ch: 300, draw: coffee, x: bx - 0.35 - 0.1 * u, y: Math.max(0.2, 1.0 - 0.9 * u * u), z: bz + 0.12, w: 0.14, h: 0.21, rot: 1.6 * u }); }
      }
      break;
    }
    case 6: {
      const burn = clamp01((f - W(21.14)) / 30);
      out.fx.push({ key: `mat|${q(burn, 20)}`, cw: 600, ch: 400, draw: (p) => doormat(p, burn), x: SHOP[0], y: 0.18, z: SHOP[2], w: 1.2, h: 0.8, flat: true });
      if (burn > 0.1) puff(out, f, [SHOP[0], 0.25, SHOP[2]], 4, 0.7, 30, true);
      if (f < W(22.28) && f > W(21.3)) {
        out.places.push(side(cam, SHOPK, "shopk", SHOP[0] - 0.55, SHOP[2] - 0.1, 1, { mode: "march", phase: (t * 2.6) % 1, expr: "shock", stride: 0.35, stomp: 1.4 }, 4, f));
        contact(out, SHOP[0] - 0.55, SHOP[2] - 0.1);
      } else if (f <= W(21.3)) person(SHOPK, "shopk", SHOP[0] - 0.7, SHOP[2] - 0.1, { mode: "stand", expr: "nervous", look: 1 }, 4);
      const bl = clamp01((f - W(22.68)) / 14);
      out.places.push({ key: `bike|${q(bl, 20)}`, x: BIKE[0], y: 0.15, z: BIKE[2], size: [900, 600, 1], card: [1.8, 1.2], draw: (p) => bike(p, bl) });
      if (f >= W(22.28)) {
        const jump = f >= W(22.92) ? Math.max(0, Math.sin(clamp01((f - W(22.92)) / 14) * Math.PI)) : 0;
        person(CYCLIST, "cyc", BIKE[0] - 0.55, BIKE[2] + 0.35, { mode: "stand", expr: jump > 0 ? "pained" : "neutral", armR: jump > 0 ? ARM.upR : ARM.holdR, armL: jump > 0 ? ARM.upL : undefined }, 5,
          { y: 0.15 + 0.55 * jump });
        if (bl > 0.4) puff(out, f, [BIKE[0] - 0.25, 1.05, BIKE[2]], 2, 0.35, 24);
      }
      break;
    }
    case 7: case 8: {
      const x = reporterX(f), z = HOT[2] + 0.5, e = eggT(f);
      carCard(CAR[0] + 6.5, { mirror: 1, badge: 1, panel: 1 });
      if (f < 790) {
        walker(REPORTER, "rep", x, z, 1, "grin", 3);
        out.fx.push({ key: "pan|0", cw: 700, ch: 400, draw: (p) => pan(p, 0), x: x + 0.45, y: 1.0, z: z + 0.1, w: 0.75, h: 0.43 });
      } else {
        const expr: Expr = id === 8 ? (f < 866 ? "lick" : "nervous") : e > 0.5 ? "laugh" : e > 0 ? "grin" : "smile";
        person(REPORTER, "rep", x, z, { mode: "stand", expr, look: id === 8 && f > 866 ? 0 : 1, armR: ARM.holdR, frontR: true, headTilt: id === 8 && f > 866 ? -8 : 0 }, 3);
        out.fx.push({ key: `pan|${q(e, 12)}`, cw: 700, ch: 400, draw: (p) => pan(p, e), x: x + 0.3, y: 0.98, z: z + 0.25, w: 0.75, h: 0.43 });
        if (e > 0) steamAt(x + 0.3, 1.2, z + 0.3, 0.5);
        if (e > 0 && e < 1) { const tb = q(e, 10); out.fx.push({ key: `burst|${tb}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, tb), x: x + 0.3, y: 1.15, z: z + 0.32, w: 0.9, h: 0.9 }); }
      }
      break;
    }
    case 9: {
      person(FOLK[3], "folk3", LAB[0] + 0.6, LAB[2] + 7.5, { mode: "stand", expr: f > W(32.92) ? "smile_closed" : "smile", armL: ARM.upL, armR: ARM.upR }, 21);
      break;
    }
    case 10: popFx("dish", 900, 900, dish, 52, 50, -6, 46, 46, W(35.94)); break;
    case 11: {
      const burn = clamp01((f - W(37.44)) / 40), lit = f >= W(39.12);
      person(KID, "kid", KIDP[0], KIDP[2], { mode: "stand", expr: lit ? "shock" : burn > 0.3 ? "grin" : "smile", look: 1, armR: ARM.holdR, frontR: true }, 5);
      out.fx.push({ key: "magnifier", cw: 500, ch: 700, draw: magnifier, x: KIDP[0] + 0.55, y: 0.72, z: KIDP[2] + 0.18, w: 0.32, h: 0.45, rot: -0.5 });
      out.fx.push({ key: `leaf|${q(burn, 20)}`, cw: 400, ch: 300, draw: (p) => leaf(p, burn), x: KIDP[0] + 0.7, y: 0.17, z: KIDP[2] + 0.12, w: 0.36, h: 0.27, flat: true });
      out.fx.push({ key: "glow", cw: 256, ch: 256, draw: (p) => glow(p), x: KIDP[0] + 0.72, y: 0.19, z: KIDP[2] + 0.12, w: 0.12, h: 0.12, flat: true, soft: true });
      if (lit) { const tq = Math.round(((t * 2) % 1) * 8) / 8; out.fx.push({ key: `flame|${tq}`, cw: 300, ch: 400, draw: (p) => flame(p, tq * 6), x: KIDP[0] + 0.72, y: 0.3, z: KIDP[2] + 0.14, w: 0.22, h: 0.3 }); }
      else if (burn > 0.3) puff(out, f, [KIDP[0] + 0.72, 0.2, KIDP[2] + 0.12], 3, 0.25, 30);
      break;
    }
    case 12: case 13: {
      carCard(CAR[0], { mirror: 1, badge: 1, panel: 1 });
      steamAt(CAR[0], 1.8, CAR[2] + 0.1, 0.9);
      if (f > W(44.22) && f < W(44.22) + 18) { const tb = q(clamp01((f - W(44.22)) / 18), 12); out.fx.push({ key: `burst|${tb}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, tb), x: HOT[0], y: 1.2, z: HOT[2] + 0.4, w: 3, h: 3 }); }
      if (id === 13) person(BIZ, "biz", CAR[0] + 3.4, CAR[2] + 1.0, { mode: "stand", expr: "shock", look: 0, headTilt: -10, armL: ARM.headL }, 1);
      break;
    }
    case 14: {
      if (f < W(49.64)) {
        carCard(CAR[0] - 1, { mirror: 1, badge: 1, panel: 1 });
        const give = f > W(48.38);
        person(OWNER, "owner", CAR[0] + 2.0, CAR[2] + 1.0, { mode: "stand", expr: "nervous", armR: give ? ARM.giveR : undefined }, 8);
        person(BIZ, "biz", CAR[0] + 3.6, CAR[2] + 1.2, { mode: "stand", expr: give ? "grin" : "stern", armL: give ? ARM.takeL : ARM.hipL, armR: ARM.hipR }, 1);
        if (give) out.fx.push({ key: "cash", cw: 400, ch: 260, draw: cash, x: CAR[0] + 2.8, y: 1.2, z: CAR[2] + 1.3, w: 0.4, h: 0.26 });
      } else {
        const fin = shadeFins(f);
        for (let i = 0; i < 6; i++) { const y = 74 + i * 13, k = Math.floor((f - W(49.64)) / 8); if (k % 6 === i && fin < 1) out.fx.push({ key: "glint", cw: 200, ch: 200, draw: glint, x: -20 + ((i * 17) % 40), y, z: faceZ(TOWER, 0, y) + 4, w: 7, h: 7, soft: true }); }
      }
      break;
    }
    case 15: case 16: {
      const unl = id === 16, twice = f >= W(55.92);
      const expr: Expr = !unl ? (f > W(53.96) ? "smile_closed" : "smile") : twice ? "pained" : "nervous";
      person(ARCHITECT, "arch", ARCH[0], ARCH[2], { mode: "stand", expr, armR: !unl ? (f > W(52.8) ? ARM.thumbR : ARM.hipR) : twice ? ARM.mouthR : ARM.hipR, armL: ARM.hipL, frontR: unl && twice, headTilt: !unl ? 4 : 0 }, 7);
      if (unl) { const k = clamp01((f - 1650) / 20); if (k > 0) out.fx.push({ key: "sweat", cw: 120, ch: 180, draw: sweat, x: ARCH[0] + 0.38, y: 2.0 - 0.15 * k, z: ARCH[2] + 0.2, w: 0.1 * k, h: 0.15 * k }); }
      break;
    }
    case 17: {
      const cook = clamp01((f - W(58.94)) / 20);
      for (let i = 0; i < 5; i++) {
        const x = VEGAS[0] - 9 + i * 4.2, z = VEGAS[2] + 5.5, c = Math.abs(i - 2) <= 1 ? cook : 0;
        out.places.push({ key: `lounger|${i % 3}|${q(c, 10)}`, x, y: 0, z, size: [900, 500, 1], card: [2.1, 1.17],
          draw: (p) => lounger(p, c, SKINS[i % 4], ["#e94e6a", "#2fa8c8", "#f2a33a"][i % 3]) });
        if (c > 0.2) puff(out, f, [x + 0.7, 0.9, z], 2, 0.4, 22);
      }
      // one tourist leaps up and runs for the pool
      if (f >= W(59.52)) {
        const u = clamp01((f - W(59.52)) / 24), jx = VEGAS[0] + 1.5 - 2.5 * u, jy = 2.2 * Math.sin(u * Math.PI) * 0.5;
        if (u < 1) person(TOURIST, "tour", jx, VEGAS[2] + 4.2 - 1.2 * u, { mode: "stand", expr: "pained", armL: ARM.upL, armR: ARM.upR }, 9, { y: jy });
        else { const su = clamp01((f - W(59.52) - 24) / 20); out.fx.push({ key: `splash|${q(su, 10)}`, cw: 800, ch: 800, draw: (p) => fxSplash(p, q(su, 10)), x: VEGAS[0] - 1, y: 0.3, z: VEGAS[2] + 2.8, w: 2.4, h: 2.4 }); }
      }
      for (let i = 0; i < 3; i++) out.places.push({ key: "umbrella", x: VEGAS[0] - 14 + i * 13, y: 0, z: VEGAS[2] + 8, size: [700, 800, 0.8], card: [3.0, 3.4], draw: umbrella });
      for (let i = 0; i < 6; i++) { const sx = i % 2 ? 1 : -1; out.places.push({ key: `palm${i % 3}`, x: VEGAS[0] + sx * (16 + (i >> 1) * 7), y: 0, z: VEGAS[2] + 2 - (i >> 1) * 5, size: [600, 1400, 0.6], card: [4.2, 9.8], draw: (p) => palm(p, i % 3) }); }
      break;
    }
    case 18: {
      popFx("rosette", 800, 1200, rosette, 0, 78, faceZ(TOWER, 0, 78) + 2, 26, 39, W(61.92));
      for (let i = 0; i < 7; i++) {
        const x = -2.5 + (i % 4) * 1.6 + (i >> 2) * 0.8, z = -11.2 - (i >> 2) * 1.5 - (i % 2) * 0.4, up = Math.floor(f / 6 + i) % 2 === 0;
        person(FOLK[i % FOLK.length], `folk${i % FOLK.length}`, x, z, { mode: "stand", expr: i % 3 ? "laugh" : "grin", look: -1, armL: up ? ARM.upL : ARM.shrugL, armR: up ? ARM.upR : ARM.shrugR }, i + 20);
      }
      person(ARCHITECT, "arch", 2.6, -9.2, { mode: "stand", expr: "nervous", armR: ARM.holdR, frontR: true, look: -1 }, 7);
      out.fx.push({ key: "trophy", cw: 500, ch: 700, draw: trophy, x: 2.92, y: 1.12, z: -8.95, w: 0.32, h: 0.45 });
      break;
    }
  }
  return out;
};

// ---------------- world ----------------
export class World {
  root = new THREE.Group();
  private pool = new Pool();
  private actors: Actor[] = []; private cards: Actor[] = [];
  private fxs: Fx[] = [];
  private hemi: THREE.HemisphereLight; private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh; private skyMat: THREE.ShaderMaterial;
  private fog = new THREE.Fog("#bccbec", 25, 420);
  private clouds: THREE.Mesh[] = [];
  private cloudMaps: Record<"day" | "golden", THREE.Texture[]>;
  private beam: THREE.Mesh; private beamV: THREE.Mesh; private spot: THREE.Mesh;
  private fins: THREE.Mesh[] = [];
  private crane = new THREE.Group();
  private rays: Ray[] = []; private labRays: Ray[] = [];
  private frustum = new THREE.Frustum(); private m4 = new THREE.Matrix4(); private sph = new THREE.Sphere();
  private CARD = (() => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); return g; })();

  constructor(_kit: Kit) {
    const R = this.root;
    // ---- sky (5 elevation stops, tone-map-inverted), sun, hemi, clouds: as the bridge ----
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() },
        c3: { value: new THREE.Color() }, c4: { value: new THREE.Color() }, e: { value: new THREE.Vector4() } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 c0, c1, c2, c3, c4; uniform vec4 e; varying vec3 vP;
        void main(){ float el = asin(clamp(normalize(vP).y, -1.0, 1.0));
          vec3 c = mix(c0, c1, smoothstep(0.0, e.x, el)); c = mix(c, c2, smoothstep(e.x, e.y, el));
          c = mix(c, c3, smoothstep(e.y, e.z, el)); c = mix(c, c4, smoothstep(e.z, e.w, el)); gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), this.skyMat);
    this.sky.renderOrder = -1; this.sky.frustumCulled = false; this.sky.layers.set(NOINK); R.add(this.sky);
    this.hemi = new THREE.HemisphereLight("#cfe6ff", "#6c5c8c", 1.1);
    this.sun = new THREE.DirectionalLight("#fff0d6", 2.6);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    R.add(this.hemi, this.sun, this.sun.target);
    this.cloudMaps = { day: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.day.cloud)), golden: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.golden.cloud)) };
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3, d = 900 + (i % 3) * 80;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.cloudMaps.day[i % 4], color: new THREE.Color(1.1, 1.1, 1.1), transparent: true, depthWrite: false, fog: false }));
      const w = 200 + (i % 4) * 50; m.position.set(Math.cos(a) * d, 200 + (i % 4) * 60, Math.sin(a) * d); m.scale.set(w, w / 2, 1);
      m.layers.set(NOINK); this.clouds.push(m); R.add(m);
    }

    // ---- ground, streets ----
    const b = new Batch();
    const pave = lam("pavingHD", () => ({ map: kerbStone() }));
    const road = lam("asphalt", () => ({ map: asphalt() }));
    const line = lam("roadline", () => ({ color: "#f2efe6" }));
    const yellow = lam("roadyellow", () => ({ color: "#e8c23a" }));
    const kerb = lam("kerb", () => ({ color: "#b9b2a6" }));
    b.add(ground(-1500, 1500, -1500, 1500, -0.02, 6), pave);
    for (const [x0, x1] of [[-200, 200]] as const) {
      b.add(ground(x0, x1, -4, 4, 0.0, 8), road);
      for (const s of [-1, 1]) {
        b.add(boxGeo(V(x0, -0.02, s < 0 ? -4.15 : 4), V(x1, 0.15, s < 0 ? -4 : 4.15)), kerb);
        b.add(ground(x0, x1, s < 0 ? -3.85 : 3.7, s < 0 ? -3.7 : 3.85, 0.012, 4), yellow);
        b.add(ground(x0, x1, s < 0 ? -6.5 : 4.15, s < 0 ? -4.15 : 6.5, 0.15, 2.4), pave);
      }
      for (let x = x0; x < x1; x += 6) b.add(ground(x, x + 3, -0.08, 0.08, 0.012, 4), line);
    }
    // cross street (north-south) through the city block east of the tower
    b.add(ground(40, 47, -200, -4, 0.0, 8), road);
    b.add(ground(40, 47, 4, 200, 0.0, 8), road);
    // city: period rows on Eastcheap and the blocks behind them (the plaza under the tower is left open)
    let si = 0;
    const row = (z: number, yaw: number, xs: [number, number][], hs: number[]) => {
      // 6 house types only (style, width and height all follow the type), so only 6 facade canvases get painted
      for (const [a, c] of xs) { let x = a; while (x < c) { const k = si++ % 6, w = [8, 10, 9][k % 3], h = hs[k % hs.length]; if (x + w > c) break; house(b, x + w / 2, z, yaw, w, 8, h, k, 0.15); x += w + 0.3; } }
    };
    const HS = [11.2, 14, 12.6, 16.8, 14, 11.2];
    row(-10.5, 0, [[-160, -24], [24, 40], [47, 160]], HS);
    row(10.5, Math.PI, [[-160, 40], [47, 160]], HS);
    row(-22, Math.PI, [[-160, -40], [47, 160]], HS);
    row(22, 0, [[-160, 40], [47, 160]], HS);
    // distant blocks: plain boxes with one shared window texture (cheap; they only read in the aerials)
    const block = lam("blockFacade", () => ({ map: rep(glassTex("blockWin", "#c9c2b6", "#bdb6aa", "#b3ab9e", "#6e6a72"), 1, 1) }));
    const br = (x: number, z: number, w: number, d: number, h: number) => b.add(boxGeo(V(x - w / 2, 0, z - d / 2), V(x + w / 2, h, z + d / 2), 5), block);
    for (let i = 0; i < 70; i++) {
      const x = -300 + (i % 14) * 44 + ((i * 17) % 9), z = (i < 35 ? 1 : -1) * (48 + Math.floor((i % 35) / 14) * 40 + ((i * 7) % 11));
      if (Math.abs(x) < 40 && z < 0 && z > -100) continue;
      br(x, z, 26 + (i % 4) * 4, 24, 18 + ((i * 13) % 5) * 7);
    }
    // the tower plaza paving, planters
    b.add(ground(-24, 24, -40, -6.5, 0.15, 2.4), pave);
    const planter = lam("planter", () => ({ color: "#8f8a80" })), hedge = lam("hedge", () => ({ color: "#5c9a48" }));
    for (const x of [-16, -8, 8, 16]) { b.add(boxGeo(V(x - 1.4, 0.15, -9.6), V(x + 1.4, 0.8, -8.2)), planter); b.add(boxGeo(V(x - 1.2, 0.8, -9.4), V(x + 1.2, 1.3, -8.4)), hedge); }
    // the tower
    const glass = lam("glassLondon", () => ({ map: glassTex("glassLondon", "#5f8fd6", "#8fb8e8", "#6f95c8", "#3a4a66") }));
    const roofG = lam("skyGarden", () => ({ color: "#7cbf8a" }));
    buildTower(b, TOWER, glass, roofG);
    // the flat-window stage: a big plain glass pane on a plinth
    const pane = lam("pane", () => ({ map: glassTex("pane", "#7fb0e6", "#a9cdef", "#86acd8", "#3a4a66") }));
    b.add(boxGeo(V(LAB[0] - 5, 0.4, LAB[2] - 0.3), V(LAB[0] + 5, 10.4, LAB[2] + 0.3)), pane);
    b.add(boxGeo(V(LAB[0] - 5.5, 0, LAB[2] - 0.8), V(LAB[0] + 5.5, 0.4, LAB[2] + 0.8)), kerb);
    // Las Vegas: pool deck, pool, the curved hotel
    const deck = lam("deck", () => ({ color: "#efdcb8" }));
    const pool = lam("pool", () => ({ color: "#3fb6e0" }));
    b.add(ground(VEGAS[0] - 60, VEGAS[0] + 60, VEGAS[2] - 30, VEGAS[2] + 40, 0.01, 4), deck);
    b.add(ground(VEGAS[0] - 12, VEGAS[0] + 12, VEGAS[2] - 2, VEGAS[2] + 3.5, 0.03, 4), pool);
    const bronze = lam("glassVegas", () => ({ map: glassTex("glassVegas", "#6f86b8", "#b9a77f", "#8d7a5c", "#3e3328") }));
    buildTower(b, HOTEL, bronze, kerb);
    b.build(R);

    // ---- sunshade fins (slide out of the face in shot 13 onward) ----
    const craneM = lam("crane", () => ({ color: "#f2c230" })), craneD = lam("craneD", () => ({ color: "#3c3f44" }));
    const cz = faceZ(TOWER, 0, 160) - 12;
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const me = new THREE.Mesh(g, m); me.castShadow = true; this.crane.add(me); };
    add(boxGeo(V(-1.2, 160, cz - 1.2), V(1.2, 196, cz + 1.2)), craneM);
    add(boxGeo(V(-1.0, 194, cz - 34), V(1.0, 196.4, cz + 14)), craneM);
    add(boxGeo(V(-2.2, 191, cz + 8), V(2.2, 194, cz + 14)), craneD);
    add(boxGeo(V(-1.6, 196, cz - 2), V(1.6, 199, cz + 2)), craneD);
    add(boxGeo(V(-0.08, 176, cz - 26.1), V(0.08, 194, cz - 25.9)), craneD);
    add(boxGeo(V(-0.8, 174.5, cz - 26.8), V(0.8, 176, cz - 25.2)), craneD);
    this.crane.visible = false; R.add(this.crane);
    const finM = lam("fin", () => ({ color: "#e8e4dc" }));
    for (let y = 70; y < 150; y += 3.2) {
      const hw = widthAt(TOWER, y) / 2, z = faceZ(TOWER, 0, y);
      const g = new THREE.BoxGeometry(2 * hw * 0.92, 0.25, 2.2);
      const m = new THREE.Mesh(g, finM); m.position.set(0, y, z + 1.0 - TOWER.dish * 0.0); m.visible = false; m.castShadow = true;
      this.fins.push(m); R.add(m);
    }

    // ---- the beam: a glowing cone from the face to the hot spot, plus the spot itself ----
    const beamTex = ctex("beamFade", 8, 256, (g) => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "#000000"); gr.addColorStop(0.55, "#5a5a5a"); gr.addColorStop(1, "#ffffff"); g.fillStyle = gr; g.fillRect(0, 0, 8, 256); });
    beamTex.colorSpace = THREE.NoColorSpace;
    // opaque queue + renderOrder 0.8: drawn after the city but before the character cards, so a card in the beam stays solid
    const beamM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.13, 0.1, 0.035), map: beamTex, transparent: false, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide, fog: false });
    const mkBeam = (a: THREE.Vector3, bb: THREE.Vector3, rA: number, rB: number) => {
      const L = a.distanceTo(bb), g = new THREE.CylinderGeometry(rB, rA, L, 32, 1, true); g.translate(0, L / 2, 0);
      const m = new THREE.Mesh(g, beamM); m.position.copy(a); m.quaternion.setFromUnitVectors(V(0, 1, 0), bb.clone().sub(a).normalize());
      m.layers.set(NOINK); m.frustumCulled = false; m.renderOrder = 0.8; R.add(m); return m; // before the cards (1): never washes a character
    };
    this.beam = mkBeam(V(HOT[0], 0.1, HOT[2]), V(0, 105, faceZ(TOWER, 0, 105) + 1), 1.2, 15);
    this.beamV = mkBeam(V(VEGAS[0], 0.1, VEGAS[2] + 5), V(VEGAS[0], 55, faceZ(HOTEL, 0, 55) + 1), 1.6, 26);
    const spotG = new THREE.PlaneGeometry(1, 1); spotG.rotateX(-Math.PI / 2);
    this.spot = new THREE.Mesh(spotG, new THREE.MeshBasicMaterial({ map: ctex("spotGlow", 256, 256, (g) => glow(new Pen(g))), color: new THREE.Color(2.4, 2.0, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.spot.position.set(HOT[0], 0.03, HOT[2]); this.spot.scale.set(5, 1, 3.5); this.spot.layers.set(NOINK); this.spot.renderOrder = 3; R.add(this.spot);

    // ---- rays for the explanation ----
    const rayM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.6), fog: false, toneMapped: true });
    for (let i = 0; i < 24; i++) this.rays.push(new Ray(R, rayM, 0.45));
    for (let i = 0; i < 10; i++) this.labRays.push(new Ray(R, rayM, 0.07));
  }

  private actor(i: number) { while (this.actors.length <= i) this.actors.push(new Actor(this.root)); return this.actors[i]; }
  private card(i: number) { while (this.cards.length <= i) this.cards.push(new Actor(this.root, this.CARD)); return this.cards[i]; }
  private fx(i: number) { while (this.fxs.length <= i) this.fxs.push(new Fx(this.root)); return this.fxs[i]; }

  update(id: number, f: number, cam: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const s = SHOTS[id - 1], L = LIGHTS[s.light], K = LOOK[s.light];
    const c = camAt(id, f);
    cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(...c.look); cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.near = 0.2; cam.far = 3000; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    cam.layers.enable(NOINK);
    const focus = V(...c.look), dist = cam.position.distanceTo(focus);
    // ---- light rig: world-fixed sun in the south sky ----
    const swing = sunSwing(f);
    const sunDir = s.light === "golden" ? GOLD_SUN : swing ? DAY_SUN.clone().applyAxisAngle(V(0, 1, 0), swing) : DAY_SUN;
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemiI;
    this.sun.color.set(L.sunCol); this.sun.intensity = L.sunI;
    const Rr = THREE.MathUtils.clamp(dist * 0.9 + 8, 12, 140);
    this.sun.position.copy(focus).addScaledVector(sunDir, 400); this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.near = 50; sc.far = 900; sc.updateProjectionMatrix();
    this.sun.shadow.bias = L.bias; this.sun.shadow.normalBias = L.normalBias * (Rr / 12);
    TONE.uLitCol.value.set(...L.lit); TONE.uShadeCol.value.set(...L.shade); TONE.uShadeLift.value.set(...L.lift);
    TONE.uLambert.value = L.lambert; TONE.uSideK.value = L.sideK; TONE.uTerm.value = L.term; TONE.uBounce.value.set(...K.bounce); TONE.uSat.value = K.sat;
    CHAR.uCharTint.value.set(...L.charTint); CHAR.uCharShade.value = L.charShade; CHAR.uGrad.value = L.charGrad;
    CHAR.uBodyGrad.value = L.bodyGrad; CHAR.uSideTint.value.set(...L.sideTint);
    // ---- sky + fog ----
    const su = this.skyMat.uniforms;
    K.sky.c.forEach((h, i) => untone(h, su["c" + i].value));
    const e = K.sky.e.map((deg) => THREE.MathUtils.degToRad(deg));
    su.e.value.set(e[1], e[2], e[3], e[4]);
    this.sky.position.copy(cam.position);
    untone(L.fog, this.fog.color); this.fog.near = 60; this.fog.far = 900;
    scene.fog = this.fog; scene.background = null;
    for (let i = 0; i < this.clouds.length; i++) {
      const m = this.clouds[i]; m.lookAt(cam.position.x, m.position.y, cam.position.z);
      (m.material as THREE.MeshBasicMaterial).map = this.cloudMaps[s.light][i % 4];
    }
    // ---- beam, spot, fins, rays ----
    // the beam cone reads in wides and the reporter's walk; never over the car close-ups
    const beamOn = (id === 1 && f > 78) || id === 7 && f < W(27.48) || (id === 8 && f > 868) || id === 12 || id === 13;
    const spotOn = beamOn || id === 4 || id === 5 || id === 7 || id === 1;
    this.beam.visible = beamOn; this.spot.visible = spotOn;
    // shot 4 time-lapse: the hot spot crawls along the street onto the parked car
    const crawl = id === 4 ? smooth((f - 414) / 36) : 1;
    this.spot.position.set(HOT[0] - 9 * (1 - crawl), 0.03, HOT[2]);
    this.beamV.visible = id === 17;
    const fin = id === 14 ? shadeFins(f) : id >= 15 && id !== 17 ? 1 : 0;
    this.crane.visible = id === 2;
    for (const m of this.fins) { m.visible = fin > 0.01; m.scale.set(Math.max(0.01, fin), 1, 1); }
    this.poseRays(id, f);
    // ---- cast ----
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const st = stage(id, f, { pos: cam.position, right, sun: sunDir });
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let ai = 0, ci = 0;
    const used: Actor[] = [];
    for (const p of st.places) {
      if (!this.frustum.intersectsSphere(this.sph.set(V(p.x, p.y + 1.2, p.z), p.card ? Math.max(...p.card) : 3))) continue;
      const a = p.card ? this.card(ci++) : this.actor(ai++);
      const [w, h, k] = p.size;
      a.r = this.pool.req(p.key, w, h, k, p.draw);
      a.mesh.visible = true;
      a.mesh.position.set(p.x, p.y, p.z);
      a.mesh.rotation.set(0, p.yaw ?? Math.atan2(cam.position.x - p.x, cam.position.z - p.z), 0);
      const sx = p.card ? p.card[0] : 1, sy = p.card ? p.card[1] : 1;
      a.mesh.scale.set(p.mirror ? -sx : sx, sy, 1);
      a.mesh.castShadow = L.actorShadow;
      used.push(a);
    }
    for (let i = ai; i < this.actors.length; i++) this.actors[i].mesh.visible = false;
    for (let i = ci; i < this.cards.length; i++) this.cards[i].mesh.visible = false;
    let fi = 0;
    const fused: Fx[] = [];
    for (const p of st.fx) {
      if (!this.frustum.intersectsSphere(this.sph.set(V(p.x, p.y, p.z), Math.max(p.w, p.h)))) continue;
      const e2 = this.fx(fi++);
      e2.r = this.pool.req(p.key, p.cw, p.ch, 1, p.draw);
      e2.use(!!p.soft);
      e2.mesh.visible = true;
      e2.mesh.position.set(p.x, p.y, p.z);
      if (p.flat) e2.mesh.rotation.set(-Math.PI / 2, 0, p.rot ?? 0);
      else { e2.mesh.quaternion.copy(cam.quaternion); e2.mesh.rotateZ(p.rot ?? 0); }
      e2.mesh.scale.set(p.w, p.h, 1);
      fused.push(e2);
    }
    for (let i = fi; i < this.fxs.length; i++) this.fxs[i].mesh.visible = false;
    this.pool.flush();
    for (const a of used) a.bind();
    for (const e3 of fused) e3.bind();
    void SU;
    return focus;
  }

  /** shot 8: parallel rays bounce off a flat pane and stay spread out; shot 11: the curved face squeezes them into one spot */
  private poseRays(id: number, f: number) {
    for (const r of this.rays) r.m.visible = false;
    for (const r of this.labRays) r.m.visible = false;
    const inc = V(0, -0.55, -0.83).normalize();
    if (id === 9) {
      for (let i = 0; i < 5; i++) {
        const x = LAB[0] - 3.2 + i * 1.6, y = 3 + (i % 2) * 2.5, P: V3 = [x, y, LAB[2] + 0.32];
        const from: V3 = [x, y - inc.y * 14, LAB[2] + 0.32 - inc.z * 14];
        // reflection off a vertical pane facing +z: flip the z part; it lands on the ground spread out
        const out = V(inc.x, inc.y, -inc.z), k = y / -out.y, land: V3 = [x, 0.05, LAB[2] + 0.32 + out.z * k];
        const u1 = rayIn(f, 925 + i * 3, 26), u2 = rayIn(f, W(31.36) + i * 3, 26);
        this.labRays[i * 2].set(from, P, u1);
        this.labRays[i * 2 + 1].set(P, land, u2);
      }
    }
    if (id === 12) {
      let n = 0;
      for (const y of [45, 80, 115, 145]) for (const x of [-16, 0, 16]) {
        const P: V3 = [x, y, faceZ(TOWER, x, y) + 0.6], from: V3 = [x - inc.x * 140, y - inc.y * 140, P[2] - inc.z * 140];
        const u1 = rayIn(f, W(40.42) + n * 2, 30), u2 = rayIn(f, W(42.5) + n * 2, 30);
        this.rays[n * 2].set(from, P, u1);
        this.rays[n * 2 + 1].set(P, [HOT[0], 0.6, HOT[2]], u2);
        n++;
      }
    }
  }
}
