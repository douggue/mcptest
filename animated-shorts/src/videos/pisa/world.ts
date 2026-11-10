// The Piazza dei Miracoli world for the Pisa short: lawn, marble paths, cathedral + baptistery (simple), the
// tower built storey by storey as a nested chain (so it can be built, tilted and bent like a banana on cue), the
// scaffolding, the 1990 barrier, the lead counterweights, the centre-of-weight diagram markers, and the cast.
// Engine rules from REFERENCE_STUDY.md live here too: every character idles (sway + breathing), blinks every
// 2.5-4.5 s, noodle limbs, softer cool shadows, stronger card gradients.
import * as THREE from "three";
import { Batch, boxGeo, V, lam, quad, Kit } from "../bridge/build";
import { ctex, cloudHD, grassHD, stoneHD, rep } from "../bridge/paint";
import { Pen, bodyFront, bodySide, fxBurst, fxContact, fxStars, Outfit, Expr, FrontOpts, SideOpts, SKINS } from "../bridge/toon";
import { LIGHTS, LOOK } from "../bridge/lights";
import { TONE, CHAR, untone } from "../bridge/shade";
import { NOINK } from "../bridge/ink";
import { Pool, Actor, Fx } from "../bridge/cast";
import { towerFace, FaceExpr, arcadeTex, baseTex, cutaway, chairGag, calPage, banana, protractor, closedSign, bucket, nest, cobweb, zzz, ripple, sparkle, rod, hammer } from "./draw";
import { FPS, SHOTS, V3, LAB, CHAIR, TOUR, FACE_Y, camAt, tilt, storeys, storeyPop, scaffold, closed, leadBlocks, smooth, clamp01, pop, lerp } from "./story";

export const loadKit = () => Promise.resolve({} as Kit);

// ---------------- the tower ----------------
const H = [11, 7, 7, 7, 7, 7, 7, 6.5];
const RAD = [7.7, 7.7, 7.7, 7.7, 7.7, 7.7, 7.7, 5.6];
const BEND = (k: number) => (k >= 3 ? 0.9 : 0); // degrees each upper storey leans back toward vertical (the banana)
const D2R = Math.PI / 180;

class Tower {
  root = new THREE.Group();
  levels: THREE.Group[] = [];
  bodies: THREE.Group[] = [];
  constructor(parent: THREE.Object3D) {
    const arc = lam("pisaArcade", () => ({ map: rep(ctex("pisaArcade", 512, 256, (g) => arcadeTex(g)), 6, 1) }));
    const base = lam("pisaBase", () => ({ map: rep(ctex("pisaBase", 512, 512, (g) => baseTex(g)), 6, 1) }));
    const marble = lam("pisaMarble", () => ({ color: "#efe8da" })), slab = lam("pisaSlab", () => ({ color: "#e2d9c6" }));
    const bell = lam("pisaBell", () => ({ map: rep(ctex("pisaArcade", 512, 256, (g) => arcadeTex(g)), 4, 1) }));
    let parentG: THREE.Object3D = this.root;
    for (let k = 0; k < 8; k++) {
      const lv = new THREE.Group(); lv.position.y = k === 0 ? 0 : H[k - 1]; parentG.add(lv); this.levels.push(lv);
      const body = new THREE.Group(); lv.add(body); this.bodies.push(body);
      const r = RAD[k], h = H[k];
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true).translate(0, h / 2, 0), k === 0 ? base : k === 7 ? bell : arc);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, h, 32).translate(0, h / 2, 0), marble);
      const corn = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.45, r + 0.45, 0.55, 48).translate(0, h - 0.27, 0), slab);
      for (const m of [shell, core, corn]) { m.castShadow = true; m.receiveShadow = true; body.add(m); }
      if (k === 7) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r + 0.2, 1.2, 32).translate(0, h + 0.6, 0), slab); cap.castShadow = true; body.add(cap); }
      parentG = lv;
    }
    parent.add(this.root);
  }
  pose(f: number) {
    const n = storeys(f);
    this.root.rotation.z = -tilt(f) * D2R;
    for (let k = 0; k < 8; k++) {
      const lv = this.levels[k], vis = k < n;
      lv.visible = vis;
      lv.rotation.z = BEND(k) * D2R;
      const s = Math.max(0.001, storeyPop(f, k));
      this.bodies[k].scale.set(1, s, 1);
    }
  }
  /** world point of a tower-local point at height y on the front (+z) face, using only the base tilt (face sits low) */
  facePoint(f: number, y: number, out = new THREE.Vector3()) {
    const t = tilt(f) * D2R; // rotation.z = -tilt sends the top toward +x
    return out.set(Math.sin(t) * y, Math.cos(t) * y, RAD[1] + 0.35);
  }
}

// ---------------- ground + buildings ----------------
const ground = (x0: number, x1: number, z0: number, z1: number, y: number, tile: number) =>
  quad(V(x0, y, z1), V(x1, y, z1), V(x1, y, z0), V(x0, y, z0), (x1 - x0) / tile, (z1 - z0) / tile);
const disc = (cx: number, cz: number, r: number, y: number, n = 48) => {
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(cx, y, cz, cx + r * Math.cos(a1), y, cz - r * Math.sin(a1), cx + r * Math.cos(a0), y, cz - r * Math.sin(a0));
    uv.push(0.5, 0.5, 0.5 + 0.5 * Math.cos(a1), 0.5 + 0.5 * Math.sin(a1), 0.5 + 0.5 * Math.cos(a0), 0.5 + 0.5 * Math.sin(a0));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  return g;
};
const facadeTex = () => ctex("duomoFacade", 1024, 512, (g) => {
  g.fillStyle = "#efe8da"; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = "#c9c0ad"; for (let y = 0; y < 512; y += 24) g.fillRect(0, y, 1024, 4);
  for (let i = 0; i < 8; i++) { const x = 30 + i * 125; g.strokeStyle = "rgba(60,50,60,0.75)"; g.lineWidth = 6; g.beginPath(); g.moveTo(x, 500); g.lineTo(x, 260); g.arc(x + 50, 260, 50, Math.PI, 0); g.lineTo(x + 100, 500); g.stroke(); }
  g.fillStyle = "#4a4f63"; for (let i = 0; i < 12; i++) { const x = 40 + i * 82; g.beginPath(); g.arc(x + 20, 120, 18, Math.PI, 0); g.lineTo(x + 38, 190); g.lineTo(x + 2, 190); g.fill(); }
});
const DAY_SUN = new THREE.Vector3(0.62, 0.66, 0.42).normalize(); // from the south-east: lights the tower's front face

// ---------------- cast helpers ----------------
type Place = { key: string; draw: (p: Pen) => void; x: number; y: number; z: number; size: [number, number, number]; card?: [number, number]; mirror?: boolean; roll?: number; idle?: number };
type FxPlace = { key: string; cw: number; ch: number; draw: (p: Pen) => void; x: number; y: number; z: number; w: number; h: number; flat?: boolean; rot?: number; soft?: boolean; top?: boolean };
type Stage = { places: Place[]; fx: FxPlace[] };
type CamInfo = { pos: THREE.Vector3; right: THREE.Vector3; sun: THREE.Vector3 };
const q = (v: number, n = 120) => Math.round(v * n) / n;
const fkey = (o: object) => JSON.stringify(o, (_k, v) => (typeof v === "number" ? q(v) : v));
const tier = (d: number): [number, number, number] => (d < 3 ? [900, 1500, 1.5] : d < 8 ? [600, 1000, 1] : d < 20 ? [360, 600, 0.6] : [180, 300, 0.3]);
const hh = (i: number, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
/** blinks every 2.5-4.5 s per character (half, shut, shut, half) */
const lidAt = (f: number, i: number) => {
  let s = Math.round(-75 * hh(i, 9));
  for (let n = 0; s <= f && n < 200; n++) { const k = f - s; if (k >= 0 && k < 4) return [0.5, 1, 1, 0.5][k]; s += Math.round(75 + 60 * hh(i * 31 + n, 13)); }
  return 0;
};
const light2D = (cam: CamInfo) => Math.round(Math.atan2(-cam.sun.y, cam.sun.dot(cam.right)) / (Math.PI / 4)) * (Math.PI / 4);
const ARM: Record<string, [number, number, number, number]> = {
  headL: [-0.5, -0.3, -0.22, -0.72], headR: [0.5, -0.3, 0.22, -0.72], upL: [-0.3, -0.5, -0.42, -1.0], upR: [0.3, -0.5, 0.42, -1.0],
  pushL: [-0.1, -0.45, 0.28, -0.9], pushR: [0.42, -0.3, 0.75, -0.75], pointR: [0.45, -0.2, 0.95, -0.5], holdR: [0.4, 0.42, 0.12, 0.4],
  hipL: [-0.45, 0.25, -0.14, 0.55], hipR: [0.45, 0.25, 0.14, 0.55], mouthR: [0.38, 0.35, 0.04, -0.14], faceR: [0.4, 0.1, 0.1, -0.45],
  shrugL: [-0.42, 0.22, -0.62, 0.0], shrugR: [0.42, 0.22, 0.62, 0.0], carryL: [-0.3, 0.3, -0.05, -0.05], carryR: [0.3, 0.3, 0.05, -0.05],
};
const BUILDER: Outfit[] = [
  { jacket: "#8a5a3a", pants: "#5a4a3a", boots: "#3a2a1a", hat: "cap", cap: "#c0353a", skin: SKINS[1] },
  { jacket: "#5d7a3a", pants: "#4a4030", boots: "#3a2a1a", hat: "hair", hair: "#3b2a20", skin: SKINS[0], moustache: "#3b2a20" },
  { jacket: "#3f6fb5", pants: "#4a4030", boots: "#3a2a1a", hat: "cap", cap: "#d9a441", skin: SKINS[3] },
];
const OLD: Outfit[] = BUILDER.map((o, i) => ({ ...o, moustache: "#d9d9d9", hair: i === 1 ? "#d9d9d9" : o.hair }));
const ENGINEER: Outfit[] = [
  { jacket: "#f28c28", pants: "#3b3f52", boots: "#2a2a2a", hat: "cap", cap: "#f2c230", skin: SKINS[0] },
  { jacket: "#f28c28", pants: "#3b3f52", boots: "#2a2a2a", hat: "cap", cap: "#ffffff", skin: SKINS[2] },
];
const TOURIST: Outfit[] = [
  { jacket: "#e94e6a", pants: "#3b5b9a", boots: "#f4f1ea", hat: "hair", hair: "#5a3b2a", skin: SKINS[1] },
  { jacket: "#2fa8c8", pants: "#3b3f52", boots: "#2a2a2a", hat: "cap", cap: "#f2c230", skin: SKINS[3] },
  { jacket: "#f2a33a", pants: "#5d7a3a", boots: "#f4f1ea", hat: "hair", hair: "#d9a441", skin: SKINS[0], dress: "#c25a7a" },
];

const stage = (id: number, f: number, cam: CamInfo, tower: Tower): Stage => {
  const out: Stage = { places: [], fx: [] }, t = f / FPS;
  const contact = (x: number, z: number, s = 1, y = 0) => out.fx.push({ key: "blob|contact|#4a4a66", cw: 128, ch: 128, draw: (p) => fxContact(p, "#4a4a66"), x, y: y + 0.03, z, w: 0.6 * s, h: 0.45 * s, flat: true });
  const person = (o: Outfit, ok: string, x: number, z: number, fo: FrontOpts, i: number, y = 0, extra: Partial<Place> = {}) => {
    const d = cam.pos.distanceTo(V(x, 1.2, z)), [w, h, k] = tier(d);
    const f2: FrontOpts = { blink: lidAt(f, i), bend: 7, ...fo, light: light2D(cam), seed: (i % 7) + 1 };
    out.places.push({ key: `F|${ok}|${fkey(f2)}`, x, y, z, size: [w, h, k], idle: i, draw: (p) => bodyFront(p, o, f2), ...extra });
    if (y < 0.1) contact(x, z);
  };
  const walker = (o: Outfit, ok: string, x: number, z: number, dir: number, so: SideOpts, i: number) => {
    const d = cam.pos.distanceTo(V(x, 1.2, z)), [w, h, k] = tier(d);
    const mirror = dir * cam.right.x < 0;
    const s2: SideOpts = { blink: lidAt(f, i), mode: "march", phase: (t * 2.3) % 1, stride: 0.6, ...so, light: light2D(cam), seed: (i % 7) + 1 };
    out.places.push({ key: `S|${ok}|${fkey(s2)}`, x, y: 0, z, mirror, size: [w, h, k], idle: i, draw: (p) => bodySide(p, o, s2) });
    contact(x, z);
  };
  const fxCard = (key: string, cw: number, ch: number, draw: (p: Pen) => void, x: number, y: number, z: number, w: number, h: number, f0 = -1e9, rot = 0, soft = false) => {
    if (f < f0) return;
    const k = f0 > -1e8 ? pop((f - f0) / 12) : 1;
    out.fx.push({ key, cw, ch, draw, x, y: y + h * (1 - k) * 0.5, z, w: w * k, h: h * k, rot, soft });
  };
  const rippleAt = (f0: number, x: number, y: number, z: number, s = 1.2) => {
    const u = (f - f0) / 30; if (u < 0 || u >= 1) return; const tq = q(u, 10);
    out.fx.push({ key: `ripple|${tq}`, cw: 600, ch: 600, draw: (p) => ripple(p, tq), x, y, z, w: s, h: s, soft: true });
  };
  const sparkleAt = (f0: number, x: number, y: number, z: number, s = 1) => {
    const u = (f - f0) / 6; if (u < 0 || u >= 1) return; const k = Math.sin(u * Math.PI) * 1.2;
    out.fx.push({ key: "sparkle", cw: 200, ch: 200, draw: sparkle, x, y, z, w: s * k, h: s * k, soft: true });
  };
  // ---- the protagonist: the tower's face (on screen whenever the tower front is) ----
  const face = (e: FaceExpr, look = 0) => {
    const p = tower.facePoint(f, FACE_Y), lid = e === "sleep" ? 0 : lidAt(f, 99);
    const key = `face|${e}|${q(lid, 4)}|${look}`;
    out.fx.push({ key, cw: 1000, ch: 700, draw: (pp) => towerFace(pp, e, lid, look), x: p.x, y: p.y, z: p.z, w: 11, h: 7.7, rot: -tilt(f) * D2R * 0.9 });
  };
  switch (id) {
    case 1: case 16: {
      const pushPose = { armL: ARM.pushL, armR: ARM.pushR, frontR: false };
      person(TOURIST[0], "t0", TOUR[0], TOUR[2], { mode: "stand", expr: id === 16 && f > 1690 ? "laugh" : "grin", look: 1, ...pushPose }, 1);
      person(TOURIST[1], "t1", TOUR[0] - 3.4, TOUR[2] - 3, { mode: "stand", expr: "smile_closed", look: 1, ...pushPose }, 2);
      person(TOURIST[2], "t2", TOUR[0] + 2.6, TOUR[2] - 5, { mode: "stand", expr: "grin", look: -1, armR: ARM.holdR, frontR: true }, 3);
      const e: FaceExpr = id === 1 ? (f < 120 ? "worried" : "sweat") : f < 1690 ? "smile" : f < 1712 ? "grin" : "wink";
      face(e, id === 16 && f > 1712 ? 1 : 0);
      if (id === 1) rippleAt(142, 3, 26, 2, 6);
      if (id === 16) sparkleAt(1718, 5.2, FACE_Y + 2.5, 8.6, 1.4);
      break;
    }
    case 2: {
      face(f < 225 ? "smile" : "proud");
      sparkleAt(226, -3, 12, 8.5, 2.2); sparkleAt(232, 4, 7, 8.5, 1.8); sparkleAt(240, 1, 17, 8.5, 1.6);
      walker(BUILDER[0], "b0", -4 + 1.2 * ((f - 161) / FPS), 11, 1, { expr: "whistle" }, 4);
      person(BUILDER[1], "b1", 6, 10.5, { mode: "stand", expr: "grin", armL: ARM.hipL, armR: ARM.pointR }, 5);
      person(BUILDER[2], "b2", 10.2, 14, { mode: "stand", expr: "smile", armL: ARM.carryL, armR: ARM.carryR }, 6);
      break;
    }
    case 3: {
      fxCard("cut|foundation", 1200, 1000, (p) => cutaway(p, "foundation"), LAB[0], 3.6, LAB[2], 9.6, 8);
      if (f >= 276) out.fx.push({ key: "rod", cw: 120, ch: 900, draw: rod, x: LAB[0] + 3.0, y: 1.4, z: LAB[2] + 0.2, w: 0.3, h: 2.2 });
      break;
    }
    case 4: {
      const sink = f >= 367 ? smooth((f - 367) / 18) * 0.28 : 0;
      const expr: Expr = f < 329 ? "shock" : f < 367 ? "stern" : "pained";
      person(BUILDER[1], "b1", 9.6, 11.2, { mode: "stand", expr, armR: f < 329 ? ARM.faceR : f >= 367 ? ARM.upR : undefined, frontR: f < 329, armL: f >= 367 ? ARM.upL : ARM.hipL }, 5, -sink);
      if (f >= 367) { const tq = q(clamp01((f - 367) / 20), 10); out.fx.push({ key: `mud|${tq}`, cw: 600, ch: 600, draw: (p) => ripple(p, tq), x: 9.6, y: 0.04, z: 11.4, w: 1.4, h: 1.0, flat: true, soft: true }); }
      face("smile");
      break;
    }
    case 5: {
      face(f < 425 ? "proud" : "shock");
      person(BUILDER[0], "b0", 7.5, 13, { mode: "stand", expr: f < 428 ? "neutral" : "shock", armR: f >= 428 ? ARM.pointR : undefined, look: -1 }, 4);
      person(BUILDER[2], "b2", 4, 15, { mode: "stand", expr: f < 432 ? "smile" : "nervous", armL: f >= 432 ? ARM.headL : undefined, armR: f >= 432 ? ARM.headR : undefined }, 6);
      break;
    }
    case 6: {
      const sleep = f > 505;
      face(sleep ? "sleep" : "worried");
      if (sleep) fxCard("zzz", 300, 300, zzz, 6.5, FACE_Y + 4.5 + 0.4 * Math.sin(t * 3), 9, 3, 3, 505);
      // builders drop their tools on "war" and run off
      for (let i = 0; i < 3; i++) {
        const run = f > 452, x = -6 + i * 4 + (run ? -9 * ((f - 452) / FPS) : 0);
        if (x > -30) walker(BUILDER[i], `b${i}`, x, 12 + i, -1, { expr: run ? "nervous" : "neutral", phase: (t * (run ? 3.4 : 1)) % 1 }, 4 + i);
        if (run) out.fx.push({ key: "hammer", cw: 300, ch: 160, draw: hammer, x: -5 + i * 4, y: 0.06, z: 12.6 + i, w: 0.6, h: 0.32, flat: true, rot: i });
      }
      // a century of calendar pages
      for (let k = 0; k < 6; k++) {
        const f0 = 505 + k * 9, u = (f - f0) / 24; if (u < 0 || u >= 1) continue;
        out.fx.push({ key: `cal|${k % 3}`, cw: 400, ch: 460, draw: (p) => calPage(p, k), x: -7 + 14 * u, y: 6 + 10 * u + 3 * Math.sin(u * 5), z: 12, w: 2.2, h: 2.5, rot: u * 4 + k });
      }
      fxCard("nest", 400, 300, nest, 2.4, 26.5, 2, 3.2, 2.4, 520);
      fxCard("cobweb", 300, 300, cobweb, -6.4, 9.5, 8, 2.2, 2.2, 532);
      for (let i = 0; i < 9; i++) { const g = smooth((f - 500) / 50); if (g <= 0) continue; out.places.push({ key: "weed", x: -8 + i * 2.1, y: 0, z: 9.4 + (i % 3) * 0.4, size: [300, 300, 0.5], card: [1.4 * g, 1.8 * g], draw: (p) => { for (let k = 0; k < 7; k++) p.line([[150, 300], [60 + k * 30, 40 + (k % 3) * 40]], "#6aa34a", 16); } }); }
      break;
    }
    case 7: {
      const e: FaceExpr = f < 600 ? "squint" : f < 680 ? "worried" : "grin";
      face(e);
      for (let i = 0; i < 3; i++) person(OLD[i], `o${i}`, 5 + i * 2.6, 12 + i * 1.2, { mode: "stand", expr: f < 589 ? "shock" : i === 1 ? "grin" : "stern", armR: i === 0 && f > 640 ? ARM.pointR : undefined, armL: i === 2 ? ARM.hipL : undefined }, 7 + i);
      if (f > 650) out.fx.push({ key: "rod", cw: 120, ch: 900, draw: rod, x: 5.6, y: 1.8, z: 12.3, w: 0.35, h: 2.6 });
      for (let k = 3; k < 8; k++) { const at = [600, 622, 644, 666, 688][k - 3]; if (f >= at && f < at + 8) { const p = tower.facePoint(f, 11 + 7 * (k - 1)); rippleAt(at, p.x * 1.4, p.y, 9, 8); } }
      break;
    }
    case 8: {
      face(f < 776 ? "worried" : "embarrassed");
      fxCard("banana", 500, 1500, banana, 26, 29, 4, 15, 45, 776, -0.05);
      break;
    }
    case 9: {
      face(f < 900 ? "worried" : "sweat");
      const sad = f > 905;
      for (let i = 0; i < 3; i++) person(TOURIST[i], `t${i}`, TOUR[0] - 2.5 + i * 2.6, TOUR[2] - 2 - (i % 2) * 2.5, { mode: "stand", expr: sad ? (i === 1 ? "pained" : "nervous") : "grin", look: 0, headTilt: sad ? 0 : -8, armR: !sad && i === 0 ? ARM.pointR : undefined, armL: sad && i === 2 ? ARM.headL : undefined }, 1 + i);
      fxCard("protractor", 800, 460, (p) => protractor(p, 5.5 * clamp01((f - 860) / 14) * 8), -12, 40, 4, 12, 6.9, 858);
      if (closed(f)) out.places.push({ key: "closed", x: 1.2, y: 0, z: 13.8, size: [500, 700, 1], card: [1.6, 2.24], draw: closedSign, idle: 50 });
      break;
    }
    case 10: case 12: {
      face(id === 10 ? (f < 1040 ? "worried" : "sweat") : "sweat", 1);
      break;
    }
    case 11: {
      const rock = f < 1201 ? 0.22 + 0.08 * Math.sin(((f - 1150) / 13) * Math.PI) : f < 1231 ? lerp(0.3, 0.55, smooth((f - 1201) / 30)) : 0.55;
      const fall = f >= 1231 ? smooth((f - 1231) / 9) : 0;
      out.places.push({ key: `chair|${q(rock, 30)}|${q(fall, 10)}`, x: CHAIR[0], y: 0, z: CHAIR[2], size: [900, 1100, 1], card: [1.7, 2.08], draw: (p) => chairGag(p, rock, fall), idle: 60 });
      if (f >= 1240) { const u = clamp01((f - 1240) / 20); out.fx.push({ key: `stars|${q(u, 10)}`, cw: 420, ch: 210, draw: (p) => fxStars(p, u), x: CHAIR[0] + 0.5, y: 0.9, z: CHAIR[2] + 0.2, w: 0.9, h: 0.45 }); out.fx.push({ key: `burst|${q(u, 8)}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, q(u, 8)), x: CHAIR[0] + 0.6, y: 0.4, z: CHAIR[2] + 0.3, w: 1.2, h: 1.2 }); }
      break;
    }
    case 13: {
      face(f < 1355 ? "worried" : "squint");
      for (let i = 0; i < 2; i++) person(ENGINEER[i], `e${i}`, -13 + i * 3.2, 7 + i, { mode: "stand", expr: i ? "stern" : "grin", armR: i === 0 ? ARM.pointR : ARM.hipR, armL: ARM.hipL, look: 1 }, 10 + i);
      const n = leadBlocks(f);
      if (n > 0) rippleAt(1352 + (n - 1) * 5, -10.5, 0.6, 6, 2.2);
      break;
    }
    case 14: {
      const back = smooth((f - 1440) / 70);
      const tq = q(((f - 1398) / 45) % 1, 12);
      out.fx.push({ key: `cut|drill|${tq}|${q(back, 20)}`, cw: 1200, ch: 1000, draw: (p) => cutaway(p, "drill", tq, back), x: LAB[0], y: 3.6, z: LAB[2], w: 9.6, h: 8 });
      walker(ENGINEER[0], "e0", LAB[0] - 6 + 1.6 * ((f - 1398) / FPS), LAB[2] + 3.2, 1, { expr: "stern" }, 10);
      out.fx.push({ key: "bucket", cw: 260, ch: 260, draw: bucket, x: LAB[0] - 5.6 + 1.6 * ((f - 1398) / FPS), y: 1.0, z: LAB[2] + 3.4, w: 0.42, h: 0.42 });
      break;
    }
    case 15: {
      face(f < 1537 ? "worried" : "relief");
      sparkleAt(1556, 4.5, FACE_Y + 3.5, 8.6, 2.2);
      break;
    }
  }
  return out;
};

// ---------------- world ----------------
export class World {
  root = new THREE.Group();
  private pool = new Pool();
  private actors: Actor[] = []; private cards: Actor[] = []; private fxs: Fx[] = [];
  private hemi: THREE.HemisphereLight; private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh; private skyMat: THREE.ShaderMaterial;
  private fog = new THREE.Fog("#bccbec", 80, 900);
  private clouds: THREE.Mesh[] = [];
  private cloudMap: THREE.Texture[];
  private tower: Tower;
  private scaffold = new THREE.Group(); private barrier = new THREE.Group();
  private lead: THREE.Mesh[] = [];
  private ball: THREE.Mesh; private plumb: THREE.Mesh; private edge: THREE.Mesh; private edgeL: THREE.Mesh;
  private frustum = new THREE.Frustum(); private m4 = new THREE.Matrix4(); private sph = new THREE.Sphere();
  private CARD = (() => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); return g; })();

  constructor(_kit: Kit) {
    const R = this.root;
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
    this.cloudMap = [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.day.cloud));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3, d = 800 + (i % 3) * 80;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.cloudMap[i % 4], color: new THREE.Color(1.1, 1.1, 1.1), transparent: true, depthWrite: false, fog: false }));
      const w = 200 + (i % 4) * 50; m.position.set(Math.cos(a) * d, 120 + (i % 4) * 50, Math.sin(a) * d); m.scale.set(w, w / 2, 1);
      m.layers.set(NOINK); this.clouds.push(m); R.add(m);
    }
    const b = new Batch();
    const grass = lam("grassHD", () => ({ map: grassHD() }));
    const path = lam("pisaPath", () => ({ map: stoneHD("pisaPathHD", ["#efe8da", "#e6dfcf", "#f3eee2", "#ded5c2"], "#c9c0ad") }));
    const wall = lam("pisaWall", () => ({ color: "#d9b98a" })), roofM = lam("pisaRoof", () => ({ color: "#c47a5c" }));
    const facade = lam("duomoFacade", () => ({ map: facadeTex() }));
    b.add(ground(-1500, 1500, -1500, 1500, -0.02, 8), grass);
    b.add(disc(0, 0, 13, 0.01), path);                       // marble apron around the tower
    b.add(ground(-3, 3, 13, 90, 0.012, 3), path);            // path south across the lawn
    b.add(ground(-120, 60, -36, -30, 0.012, 3), path);       // path to the cathedral
    // cathedral (long nave + facade) and baptistery (drum + dome), far enough to frame the tower
    b.add(boxGeo(V(-110, 0, -80), V(-30, 26, -50), 0), facade);
    b.add(quad(V(-110, 26, -50), V(-30, 26, -50), V(-30, 26, -80), V(-110, 26, -80)), roofM);
    b.add(new THREE.CylinderGeometry(18, 18, 22, 40).translate(-150, 11, 10), facade);
    b.add(new THREE.SphereGeometry(18, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(-150, 22, 10), roofM);
    // the old city wall far behind
    b.add(boxGeo(V(-400, 0, -160), V(400, 9, -154), 0), wall);
    b.add(boxGeo(V(-400, 0, 154), V(400, 9, 160), 0), wall);
    // the cutaway stage: a plain studio floor
    b.add(ground(LAB[0] - 40, LAB[0] + 40, LAB[2] - 20, LAB[2] + 30, 0.01, 4), path);
    b.build(R);
    this.tower = new Tower(R);
    // scaffolding (1173): poles + ledgers around the lower storeys
    const wood = lam("scaffWood", () => ({ color: "#a8724a" }));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = 9.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 26, 6).translate(0, 13, 0), wood); pole.position.set(r * Math.cos(a), 0, r * Math.sin(a)); this.scaffold.add(pole);
    }
    for (let y = 4; y < 26; y += 5) { const ring = new THREE.Mesh(new THREE.TorusGeometry(9.6, 0.1, 6, 48).rotateX(Math.PI / 2).translate(0, y, 0), wood); this.scaffold.add(ring); }
    R.add(this.scaffold);
    // 1990 barrier: posts + red/white tape
    const red = lam("tapeRed", () => ({ color: "#d42f2f" })), white = lam("tapeWhite", () => ({ color: "#f4f1ea" }));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2, r = 15;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6).translate(0, 0.55, 0), white); p.position.set(r * Math.cos(a), 0, r * Math.sin(a)); this.barrier.add(p);
      const a2 = ((i + 1) / 20) * Math.PI * 2, x0 = r * Math.cos(a), z0 = r * Math.sin(a), x1 = r * Math.cos(a2), z1 = r * Math.sin(a2);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(x1 - x0, z1 - z0), 0.12, 0.03), i % 2 ? red : white);
      seg.position.set((x0 + x1) / 2, 0.95, (z0 + z1) / 2); seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0); this.barrier.add(seg);
    }
    R.add(this.barrier);
    // lead counterweights on the high (-x) side
    const leadM = lam("lead", () => ({ color: "#6b7088" }));
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 1.6), leadM); m.castShadow = true; m.visible = false; this.lead.push(m); R.add(m); }
    // centre-of-weight diagram (x-ray: drawn over everything)
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.2, 0.4), depthTest: false, fog: false });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 16), glowM);
    this.plumb = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 6).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.0, 0.3), depthTest: false, fog: false }));
    const edgeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.3, 0.3), depthTest: false, fog: false });
    this.edge = new THREE.Mesh(new THREE.BoxGeometry(1.0, 6, 1.0), edgeM); this.edgeL = new THREE.Mesh(new THREE.BoxGeometry(1.0, 6, 1.0), edgeM);
    for (const m of [this.ball, this.plumb, this.edge, this.edgeL]) { m.renderOrder = 10; m.layers.set(NOINK); m.visible = false; R.add(m); }
  }

  private actor(i: number) { while (this.actors.length <= i) this.actors.push(new Actor(this.root)); return this.actors[i]; }
  private card(i: number) { while (this.cards.length <= i) this.cards.push(new Actor(this.root, this.CARD)); return this.cards[i]; }
  private fx(i: number) { while (this.fxs.length <= i) this.fxs.push(new Fx(this.root)); return this.fxs[i]; }

  update(id: number, f: number, cam: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const s = SHOTS[id - 1], L = LIGHTS.day, K = LOOK.day;
    const c = camAt(id, f);
    cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(...c.look); cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.near = 0.2; cam.far = 3000; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    cam.layers.enable(NOINK);
    const focus = V(...c.look), dist = cam.position.distanceTo(focus);
    // ---- light: softer, cooler shadows than the bridge preset (reference study: shadow ~35 % darker, hue ~220) ----
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemiI;
    this.sun.color.set(L.sunCol); this.sun.intensity = L.sunI;
    const Rr = THREE.MathUtils.clamp(dist * 0.9 + 8, 12, 90);
    this.sun.position.copy(focus).addScaledVector(DAY_SUN, 400); this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.near = 50; sc.far = 900; sc.updateProjectionMatrix();
    this.sun.shadow.bias = L.bias; this.sun.shadow.normalBias = L.normalBias * (Rr / 12);
    TONE.uLitCol.value.set(1.45, 1.4, 1.3); TONE.uShadeCol.value.set(0.78, 0.86, 1.08); TONE.uShadeLift.value.set(0.05, 0.06, 0.1);
    TONE.uLambert.value = 0.35; TONE.uSideK.value = 0.84; TONE.uTerm.value = 0.35; TONE.uBounce.value.set(0, 0, 0); TONE.uSat.value = 1.1;
    CHAR.uCharTint.value.set(...L.charTint); CHAR.uCharShade.value = 0.84; CHAR.uGrad.value = 0.12; CHAR.uBodyGrad.value = 0.32; CHAR.uSideTint.value.set(0.86, 0.9, 1.0);
    const su = this.skyMat.uniforms;
    K.sky.c.forEach((h, i) => untone(h, su["c" + i].value));
    const e = K.sky.e.map((deg) => THREE.MathUtils.degToRad(deg));
    su.e.value.set(e[1], e[2], e[3], e[4]);
    this.sky.position.copy(cam.position);
    untone(L.fog, this.fog.color); scene.fog = this.fog; scene.background = null;
    for (const m of this.clouds) m.lookAt(cam.position.x, m.position.y, cam.position.z);
    // ---- era props ----
    this.tower.pose(f);
    this.scaffold.visible = scaffold(f);
    this.barrier.visible = s.era === "1990" && f >= 900;
    const n = leadBlocks(f);
    this.lead.forEach((m, i) => {
      m.visible = i < n && (s.era === "fix");
      const land = 1352 + i * 5, u = clamp01((f - land + 6) / 6), bounce = f > land && f < land + 6 ? 0.08 * Math.sin(((f - land) / 6) * Math.PI) : 0;
      m.position.set(-10.2 - (i % 2) * 2.5, 0.35 + Math.floor(i / 2) * 0.7 + (1 - u) * 6 + bounce, 5 + (i % 4 > 1 ? 1.7 : 0));
    });
    const diag = id === 10 || id === 12;
    for (const m of [this.ball, this.plumb, this.edge, this.edgeL]) m.visible = diag;
    if (diag) {
      // centre of weight on the tower axis at ~45 % height; illustrated sliding toward the base edge
      const tt = tilt(f) * D2R, hC = 26, slide = id === 10 ? smooth((f - 1046) / 54) * 3.2 : 4.4;
      const bx = Math.sin(tt) * hC + slide, by = Math.cos(tt) * hC;
      this.ball.position.set(bx, by, 0); this.ball.scale.setScalar(1 + 0.15 * Math.sin(f * 0.3));
      this.plumb.position.set(bx, by, 0); this.plumb.scale.set(1, by, 1);
      this.edge.position.set(7.9, 3, 0); this.edgeL.position.set(-7.9, 3, 0);
    }
    // ---- cast ----
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const st = stage(id, f, { pos: cam.position, right, sun: DAY_SUN }, this.tower);
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let ai = 0, cj = 0;
    const used: Actor[] = [], t = f / FPS;
    for (const p of st.places) {
      if (!this.frustum.intersectsSphere(this.sph.set(V(p.x, p.y + 1.2, p.z), p.card ? Math.max(...p.card) : 3))) continue;
      const a = p.card ? this.card(cj++) : this.actor(ai++);
      const [w, h, k] = p.size;
      a.r = this.pool.req(p.key, w, h, k, p.draw);
      a.mesh.visible = true;
      a.mesh.position.set(p.x, p.y, p.z);
      // idle: every character sways and breathes (never fully still); props get none
      const i = p.idle ?? -1, sway = i >= 0 && !p.card ? 0.017 * Math.sin((2 * Math.PI * t) / 3.1 + i * 1.7) : 0, br = i >= 0 && !p.card ? 1 + 0.012 * Math.sin((2 * Math.PI * t) / 2.6 + i) : 1;
      a.mesh.rotation.set(0, Math.atan2(cam.position.x - p.x, cam.position.z - p.z), (p.roll ?? 0) + sway);
      const sx = p.card ? p.card[0] : 1, sy = (p.card ? p.card[1] : 1) * br;
      a.mesh.scale.set(p.mirror ? -sx : sx, sy, 1);
      a.mesh.castShadow = false;
      used.push(a);
    }
    for (let i = ai; i < this.actors.length; i++) this.actors[i].mesh.visible = false;
    for (let i = cj; i < this.cards.length; i++) this.cards[i].mesh.visible = false;
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
    return focus;
  }
}
