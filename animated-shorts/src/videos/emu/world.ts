// One three.js world for the Emu War: red-dirt outback, wheat paddocks, a farmhouse with a windpump, the dirt
// track, the dam (watering hole), gum trees, far hills, and the cast (soldiers, farmers, emus, truck, Lewis guns)
// staged per shot. Look values (two-tone shading, sky, fog, ink, cards, grade) come from the bridge template.
import * as THREE from "three";
import { Batch, boxGeo, V, lam, quad, house, Kit } from "../bridge/build";
import { ctex, cloudHD } from "../bridge/paint";
import { Pen, bodyFront, fxBurst, fxContact, Outfit, Expr, FrontOpts, SKINS } from "../bridge/toon";
import { LIGHTS, LOOK } from "../bridge/lights";
import { TONE, CHAR, untone } from "../bridge/shade";
import { NOINK } from "../bridge/ink";
import { Pool, Actor, Fx } from "../bridge/cast";
import { emu, EmuOpts, truck, lewis, crates, gum, tally, crosshair, speed, dust } from "./draw";
import {
  FPS, SHOTS, V3, FARM, CAMP, DAM, AMBUSH, PLAIN, HOOK, W, camAt, firing, jammed, truckX, bump, smooth, clamp01,
} from "./story";

export const loadKit = () => Promise.resolve({} as Kit);

// ---------------- painted ground ----------------
const dirtTex = () => ctex("redDirt", 1024, 1024, (g, r) => {
  g.fillStyle = "#c9814f"; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 1800; i++) { g.fillStyle = r() < 0.5 ? "rgba(150,82,46,0.35)" : "rgba(226,170,120,0.35)"; const s = 3 + r() * 10; g.beginPath(); g.ellipse(r() * 1024, r() * 1024, s, s * 0.6, r() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 60; i++) { g.fillStyle = "rgba(140,150,90,0.5)"; const x = r() * 1024, y = r() * 1024; for (let k = 0; k < 6; k++) g.fillRect(x + k * 3, y - k * 2, 2, 8 + k); }
});
const wheatTex = () => ctex("wheat", 1024, 1024, (g, r) => {
  g.fillStyle = "#e3b850"; g.fillRect(0, 0, 1024, 1024);
  for (let y = 0; y < 1024; y += 16) { g.fillStyle = y % 32 ? "rgba(196,146,48,0.45)" : "rgba(246,214,120,0.45)"; g.fillRect(0, y, 1024, 7); }
  for (let i = 0; i < 2600; i++) { g.strokeStyle = r() < 0.5 ? "rgba(170,120,40,0.55)" : "rgba(255,232,150,0.6)"; g.lineWidth = 2; const x = r() * 1024, y = r() * 1024; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4 - r() * 8, y - 10 - r() * 10); g.stroke(); }
});
const grassTex = () => ctex("dryGrass", 1024, 1024, (g, r) => {
  g.fillStyle = "#c8b46a"; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2400; i++) { g.strokeStyle = r() < 0.5 ? "rgba(150,140,70,0.5)" : "rgba(230,214,140,0.5)"; g.lineWidth = 2; const x = r() * 1024, y = r() * 1024; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 - r() * 12, y - 8 - r() * 12); g.stroke(); }
  for (let i = 0; i < 300; i++) { g.fillStyle = "rgba(190,110,60,0.35)"; g.beginPath(); g.ellipse(r() * 1024, r() * 1024, 6 + r() * 14, 4 + r() * 8, 0, 0, 7); g.fill(); }
});
const trackTex = () => ctex("track", 512, 512, (g, r) => {
  g.fillStyle = "#d39a66"; g.fillRect(0, 0, 512, 512);
  for (const y of [120, 380]) { g.fillStyle = "rgba(150,90,50,0.45)"; g.fillRect(0, y - 26, 512, 52); }
  for (let i = 0; i < 700; i++) { g.fillStyle = "rgba(120,70,40,0.3)"; g.fillRect(r() * 512, r() * 512, 3, 3); }
});
const ground = (x0: number, x1: number, z0: number, z1: number, y: number, tile: number) =>
  quad(V(x0, y, z1), V(x1, y, z1), V(x1, y, z0), V(x0, y, z0), (x1 - x0) / tile, (z1 - z0) / tile);
const disc = (cx: number, cz: number, r: number, y: number, n = 48) => {
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    pos.push(cx, y, cz, cx + r * Math.cos(a1), y, cz - r * Math.sin(a1), cx + r * Math.cos(a0), y, cz - r * Math.sin(a0));
    uv.push(0.5, 0.5, 0.5 + 0.5 * Math.cos(a1), 0.5 + 0.5 * Math.sin(a1), 0.5 + 0.5 * Math.cos(a0), 0.5 + 0.5 * Math.sin(a0));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  return g;
};
const DAY_SUN = new THREE.Vector3(0.45, 0.72, 0.53).normalize();
const GOLD_SUN = new THREE.Vector3(0.78, 0.14, 0.6).normalize();

// ---------------- cast ----------------
type Place = { key: string; draw: (p: Pen) => void; x: number; y: number; z: number; size: [number, number, number]; card?: [number, number]; mirror?: boolean; yaw?: number; roll?: number; s?: number };
type FxPlace = { key: string; cw: number; ch: number; draw: (p: Pen) => void; x: number; y: number; z: number; w: number; h: number; flat?: boolean; rot?: number; soft?: boolean };
type Stage = { places: Place[]; fx: FxPlace[] };
type CamInfo = { pos: THREE.Vector3; right: THREE.Vector3; sun: THREE.Vector3 };

const KHAKI: Outfit = { jacket: "#8a7a4f", pants: "#6f6343", boots: "#4a3426", hat: "cap", cap: "#7d7046", belt: "#5a4a30", skin: SKINS[1] };
const SOLDIERS: Outfit[] = [{ ...KHAKI }, { ...KHAKI, skin: SKINS[0], moustache: "#4a3426" }];
const MAJOR: Outfit = { ...KHAKI, jacket: "#7f714a", cap: "#6a5e3c", moustache: "#5a4030", build: "stout", buttons: "#e8c45a", skin: SKINS[0] };
const FARMERS: Outfit[] = [
  { jacket: "#3f6fb5", pants: "#5a4a3a", boots: "#4a3426", hat: "tophat", skin: SKINS[1] },
  { jacket: "#b5653f", pants: "#3b3f52", boots: "#4a3426", hat: "hair", hair: "#8a4f2c", skin: SKINS[0], dress: "#d9a441" },
  { jacket: "#5d7a3a", pants: "#5a4a3a", boots: "#2a2a2a", hat: "cap", cap: "#8c3b4a", skin: SKINS[2] },
];
const q = (v: number, n = 120) => Math.round(v * n) / n;
const fkey = (o: object) => JSON.stringify(o, (_k, v) => (typeof v === "number" ? q(v) : v));
const tier = (d: number): [number, number, number] => (d < 3 ? [900, 1500, 1.5] : d < 8 ? [600, 1000, 1] : d < 20 ? [360, 600, 0.6] : [180, 300, 0.3]);
const lidAt = (f: number, i: number) => { const k = (f + i * 23) % 61; return k < 4 ? [0.5, 1, 1, 0.5][k] : 0; };
const light2D = (cam: CamInfo) => Math.round(Math.atan2(-cam.sun.y, cam.sun.dot(cam.right)) / (Math.PI / 4)) * (Math.PI / 4);
const hh = (i: number, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };

const person = (out: Stage, cam: CamInfo, o: Outfit, ok: string, x: number, z: number, fo: FrontOpts, i: number, f: number, y = 0) => {
  const d = cam.pos.distanceTo(V(x, 1.2, z)), [w, h, k] = tier(d);
  const f2: FrontOpts = { blink: lidAt(f, i), ...fo, light: light2D(cam), seed: (i % 7) + 1 };
  out.places.push({ key: `F|${ok}|${fkey(f2)}`, x, y, z, size: [w, h, k], draw: (p) => bodyFront(p, o, f2) });
  if (y < 0.1) contact(out, x, z);
};
/** an emu running/walking along direction (dx, dz); the side view is mirrored to face its way on screen */
const bird = (out: Stage, cam: CamInfo, x: number, z: number, dx: number, dz: number, o: EmuOpts, s = 1, y = 0) => {
  const d = cam.pos.distanceTo(V(x, 1.0, z)) / s, [w, h, k] = tier(d);
  const o2: EmuOpts = { ...o, phase: o.phase !== undefined ? Math.round(o.phase * 8) / 8 : 0, hit: o.hit ? q(o.hit, 8) : 0 };
  const mirror = dx * cam.right.x + dz * cam.right.z < 0;
  out.places.push({ key: `E|${fkey(o2)}`, x, y, z, size: [w, h, k], mirror, s, draw: (p) => emu(p, o2) });
  if (y < 0.1) contact(out, x, z, 0.9 * s);
};
const contact = (out: Stage, x: number, z: number, s = 1) =>
  out.fx.push({ key: "blob|contact|#5a3a3a", cw: 128, ch: 128, draw: (p) => fxContact(p, "#5a3a3a"), x, y: 0.03, z, w: 0.6 * s, h: 0.45 * s, flat: true });
const puffAt = (out: Stage, f: number, x: number, z: number, size = 1, period = 24, k0 = 0) => {
  const u = (((f + k0 * 7) % period) + period) % period / period, tq = Math.round(u * 10) / 10;
  out.fx.push({ key: `dust|${tq}`, cw: 300, ch: 300, draw: (p) => dust(p, tq), x, y: 0.3 + u * 0.6 * size, z, w: size * (0.8 + u), h: size * (0.8 + u), soft: true });
};
const card = (out: Stage, key: string, draw: (p: Pen) => void, x: number, y: number, z: number, w: number, h: number, canvas: [number, number, number], mirror = false, roll = 0) =>
  out.places.push({ key, draw, x, y, z, size: canvas, card: [w, h], mirror, roll });
const gun = (out: Stage, x: number, y: number, z: number, flash: boolean, jam: boolean, mirror = false) =>
  card(out, `lewis|${flash}|${jam}`, (p) => lewis(p, flash, jam), x, y, z, 1.4, 0.56, [800, 320, 1], mirror);
const wheatRow = (out: Stage, cx: number, cz: number, n: number, spread: number) => {
  for (let i = 0; i < n; i++) {
    const x = cx + (hh(i, 1) - 0.5) * spread, z = cz + (hh(i, 2) - 0.5) * spread * 0.6;
    out.places.push({ key: `tuft${i % 3}`, x, y: 0, z, size: [300, 300, 0.5], card: [1.0, 0.9], draw: (p) => tuft(p, i % 3) });
  }
};
const tuft = (p: Pen, v: number) => {
  for (let k = 0; k < 9; k++) {
    const x = 60 + k * 22 + v * 4, top = 60 + ((k * 37 + v * 11) % 50);
    p.line([[x, 300], [x + (k % 3 - 1) * 14, top + 30]], "#d8a640", 7, false);
    p.ell(x + (k % 3 - 1) * 14, top + 16, 9, 22, "#e9c060", 4);
  }
};

const stage = (id: number, f: number, cam: CamInfo): Stage => {
  const out: Stage = { places: [], fx: [] }, t = f / FPS;
  switch (id) {
    case 1: {
      const fire = firing(f), done = f > 118;
      person(out, cam, SOLDIERS[0], "s0", HOOK[0], HOOK[2], { mode: "stand", expr: done ? "dazed" : f > 30 ? "stern" : "neutral", look: 1 }, 1, f);
      gun(out, HOOK[0] + 0.55, 0.75, HOOK[2] + 0.25, fire, done);
      if (fire) out.fx.push({ key: `burst|${f % 8}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, (f % 8) / 8, "#ffe27a", 8), x: HOOK[0] + 1.3, y: 0.95, z: HOOK[2] + 0.3, w: 0.7, h: 0.7 });
      for (let i = 0; i < 9; i++) {
        const z = HOOK[2] - 3.5 - (i % 4) * 1.4, x = HOOK[0] - 9 + ((t * 11 + i * 1.7) % 15);
        bird(out, cam, x, z, 1, 0, { mode: "run", phase: t * 2.6 + i * 0.37, expr: "smug", col: i });
        if (i % 3 === 0) puffAt(out, f, x - 0.8, z, 0.8, 20, i);
      }
      wheatRow(out, HOOK[0], HOOK[2] + 1.6, 7, 4);
      break;
    }
    case 2: {
      for (let i = 0; i < 3; i++) person(out, cam, FARMERS[i], `fa${i}`, FARM[0] + 1 + i * 1.3, FARM[2] + 7 + (i % 2) * 0.6, { mode: "stand", expr: i === 1 ? "smile" : "grin", wave: i === 0 ? (t * 1.2) % 1 : undefined }, i + 3, f);
      break;
    }
    case 3: {
      person(out, cam, FARMERS[0], "fa0", FARM[0] - 3.2, FARM[2] + 16.5, { mode: "stand", expr: f > W(11.0) ? "shock" : "neutral" }, 3, f);
      for (let i = 0; i < 28; i++) {
        const x = FARM[0] - 1 + (i % 7) * 1.9 + hh(i) * 0.8, z = FARM[2] + 6 + Math.floor(i / 7) * 1.9 + hh(i, 4) * 0.6, eat = (i + Math.floor(t * 2)) % 3 === 0;
        const arrive = smooth((f - 300 - i * 1.5) / 36), xx = x + 22 * (1 - arrive);
        bird(out, cam, xx, z, -1, 0, { mode: arrive < 1 ? "walk" : eat ? "eat" : "stand", phase: t * 1.5 + i * 0.3, col: i, expr: i % 5 ? "normal" : "smug" });
      }
      wheatRow(out, FARM[0] + 4, FARM[2] + 13, 6, 6);
      break;
    }
    case 4: case 5: case 12: case 13: {
      const arrive = id === 4 ? smooth((f - 382) / 50) : 1, tx = CAMP[0] - 3 - 25 * (1 - arrive);
      card(out, "truck", (p) => truck(p), tx, 0, CAMP[2] - 2.2, 5.6, 2.8, [1600, 800, 0.8]);
      if (id === 4 && arrive < 1) puffAt(out, f, tx - 3, CAMP[2] - 2, 1.6, 16);
      if (id !== 13 || f < W(59.28)) {
        const salute = id === 13;
        person(out, cam, MAJOR, "maj", CAMP[0] - 0.4, CAMP[2] + 0.6, {
          mode: "stand", expr: id === 5 ? "grin" : id === 12 ? (f > W(55.46) ? "nervous" : "stern") : salute ? "relief" : f > 470 ? "grin" : "neutral",
          wave: salute ? 0.5 : undefined }, 7, f);
        if (id === 4 && f > 430 || id === 12) for (let i = 0; i < 2; i++) person(out, cam, SOLDIERS[i], `s${i}`, CAMP[0] + 1.1 + i * 0.9, CAMP[2] + 0.5 - i * 0.4, { mode: "stand", expr: "neutral" }, i + 1, f);
        if (id === 4 && f > 440) {
          for (let i = 0; i < 2; i++) gun(out, CAMP[0] + 2.4 + i * 0.3, 0.2 + i * 0.45, CAMP[2] + 1.4 - i * 0.1, false, false);
          card(out, "crates", (p) => crates(p, 3), CAMP[0] + 2.9, 0, CAMP[2] + 0.9, 1.5, 1.0, [600, 400, 1]);
        }
        if (id === 12) {
          const n = 1 + Math.floor(17 * clamp01((f - 1595) / 75));
          card(out, `tally|${n}`, (p) => tally(p, n), CAMP[0] + 1.3, 0, CAMP[2] + 0.4, 1.6, 1.37, [700, 600, 1]);
        }
      }
      if (id === 13 && f >= W(59.28)) {
        for (let i = 0; i < 15; i++) bird(out, cam, PLAIN[0] - 4 + (i % 5) * 2, PLAIN[2] - Math.floor(i / 5) * 2.2, -1, 0.3, { mode: "stand", expr: "smug", hat: "helmet", col: i });
      }
      break;
    }
    case 6: {
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * Math.PI * 2 + hh(i) * 0.3, r0 = 1 + 2.5 * hh(i, 3), go = Math.max(0, t - 20.3 - hh(i, 5) * 0.4), r = r0 + 9 * go;
        const x = PLAIN[0] + r * Math.cos(a), z = PLAIN[2] + r * Math.sin(a) * 0.9;
        bird(out, cam, x, z, Math.cos(a), Math.sin(a), { mode: go > 0 ? "run" : "stand", phase: t * 2.6 + i * 0.29, col: i, expr: go > 0 ? "smug" : "normal" });
        if (go > 0 && i % 4 === 0) puffAt(out, f, x - Math.cos(a) * 0.8, z - Math.sin(a) * 0.8, 1, 18, i);
      }
      for (let i = 0; i < 3; i++) person(out, cam, i ? SOLDIERS[i - 1] : MAJOR, i ? `s${i - 1}` : "maj", PLAIN[0] - 1.2 + i * 1.2, PLAIN[2] + 16, { mode: "stand", expr: t > 21 ? "shock" : "stern" }, i + 1, f);
      break;
    }
    case 7: {
      const fire = firing(f), jam = jammed(f), shotN = Math.floor(clamp01((f - W(29.08)) / (W(30.6) - W(29.08))) * 12);
      for (let i = 0; i < 2; i++) person(out, cam, SOLDIERS[i], `s${i}`, AMBUSH[0] - 0.7 + i * 1.3, AMBUSH[2] + 0.4 * i, { mode: "stand", expr: jam ? (i ? "shock" : "dazed") : fire ? "stern" : "nervous" }, i + 1, f);
      gun(out, AMBUSH[0] + 0.2, 0.5, AMBUSH[2] - 0.3, fire, jam);
      if (fire) out.fx.push({ key: `burst|${f % 8}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, (f % 8) / 8, "#ffe27a", 8), x: AMBUSH[0] + 0.9, y: 0.7, z: AMBUSH[2] - 0.4, w: 0.6, h: 0.6 });
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI - Math.PI, r = 9 + 7 * hh(i, 7);
        const walk = smooth((f - 760 - i * 2) / 160), flee = f > W(30.68) ? (f - W(30.68)) / FPS : 0;
        let x = DAM[0] + r * Math.cos(a) * 1.3, z = DAM[2] - 6 + r * Math.sin(a) * (0.4 + 0.6 * (1 - walk)) - 18 * (1 - walk);
        const hitI = i % 3 === 0 && i / 3 < shotN;
        if (flee > 0 && !hitI) { x += Math.cos(a) * 14 * flee; z -= 14 * flee; }
        if (hitI) { bird(out, cam, x, z, 1, 0, { mode: "stand", expr: "dazed", col: i, hit: 1 }, 1); continue; }
        bird(out, cam, x, z, flee > 0 ? Math.cos(a) : -Math.cos(a), flee > 0 ? -1 : 1, { mode: flee > 0 ? "run" : walk < 1 ? "walk" : "eat", phase: t * (flee > 0 ? 2.6 : 1.2) + i * 0.31, col: i, expr: flee > 0 ? "smug" : "normal" });
      }
      break;
    }
    case 8: {
      const x = truckX(f), b = bump(f), roll = 0.05 * Math.sin(f * 1.3);
      card(out, "truck", (p) => truck(p), x, b, PLAIN[2], 5.6, 2.8, [1600, 800, 0.8], false, roll);
      person(out, cam, SOLDIERS[0], "s0", x - 1.0, PLAIN[2] + 0.05, { mode: "stand", expr: "pained", tilt: 0.15 * Math.sin(f * 0.9) }, 1, f, 1.0 + b * 1.6);
      gun(out, x - 0.2, 2.0 + b * 1.8, PLAIN[2] + 0.1, false, false, false);
      for (let k = 0; k < 2; k++) puffAt(out, f, x - 3.2 - k, PLAIN[2] + 0.3, 1.8, 14, k);
      for (let i = 0; i < 7; i++) {
        const ex = x + 7 + 3.5 * ((f - 936) / FPS) + i * 1.8 + hh(i) * 2, ez = PLAIN[2] - 1.5 + (i % 3) * 1.2;
        bird(out, cam, ex, ez, 1, 0, { mode: "run", phase: t * 2.6 + i * 0.4, col: i, expr: "smug" });
        if (i % 2 === 0) puffAt(out, f, ex - 0.8, ez, 0.8, 18, i);
      }
      out.fx.push({ key: "speed", cw: 600, ch: 300, draw: speed, x: x + 4.5, y: 1.4, z: PLAIN[2] + 0.5, w: 2.2, h: 1.1, soft: true });
      break;
    }
    case 9: {
      person(out, cam, SOLDIERS[1], "s1", PLAIN[0] - 0.45, PLAIN[2], { mode: "stand", expr: f > W(38.64) ? "nervous" : "stern", look: 1 }, 2, f);
      bird(out, cam, PLAIN[0] + 0.5, PLAIN[2] - 0.05, -1, 0, { mode: "stand", expr: (f % 50) < 4 ? "blink" : f > W(39.72) ? "smug" : "wide", col: 1 }, 1.05);
      break;
    }
    case 10: {
      const aimAt = W(47.58), flee = f > W(48.6) ? (f - W(48.6)) / FPS : 0;
      for (let g = 0; g < 6; g++) {
        const ga = Math.PI / 2 + (g * Math.PI) / 3, gx = PLAIN[0] + 16 * Math.cos(ga), gz = PLAIN[2] - 4 + 12 * Math.sin(ga);
        const away = g === 0 ? 0 : 1, run = flee > 0;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2, x = gx + 2.2 * Math.cos(a) + Math.cos(ga) * 15 * flee * away, z = gz + 1.6 * Math.sin(a) + Math.sin(ga) * 15 * flee * away;
          if (g === 0 && run) continue; // the targeted group is gone too
          bird(out, cam, x, z, run ? Math.cos(ga) : Math.cos(a + 1.6), run ? Math.sin(ga) : Math.sin(a + 1.6), { mode: run ? "run" : i % 2 ? "eat" : "walk", phase: t * (run ? 2.6 : 1) + i * 0.3, col: i + g });
        }
        if (!(g === 0 && run)) bird(out, cam, gx + Math.cos(ga) * 15 * flee * away, gz + Math.sin(ga) * 15 * flee * away, 1, 0.2, { mode: run ? "run" : "stand", lookout: true, expr: f > aimAt - 10 ? "wide" : "normal", phase: t * 2.6 }, 1.2);
      }
      if (f >= aimAt) out.fx.push({ key: "crosshair", cw: 400, ch: 400, draw: crosshair, x: PLAIN[0], y: 1.2, z: PLAIN[2] + 8, w: 7, h: 7 });
      break;
    }
    case 11: {
      const x = PLAIN[0] - 10 + 8 * ((f - 1496) / FPS), hit = f >= W(50.52) ? clamp01((f - W(50.52)) / 14) : 0;
      bird(out, cam, x, PLAIN[2], 1, 0, { mode: "run", phase: t * 2.6, col: 2, expr: hit > 0 && hit < 1 ? "dazed" : "smug", hit: hit > 0 && hit < 1 ? hit : 0 }, 1.05);
      if (hit > 0 && hit < 1) out.fx.push({ key: `burst|${q(hit, 8)}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, q(hit, 8), "#fff3b0", 8), x: x - 0.1, y: 1.2, z: PLAIN[2] + 0.2, w: 0.8, h: 0.8 });
      puffAt(out, f, x - 0.9, PLAIN[2], 0.8, 16);
      break;
    }
    case 14: {
      const x = CAMP[0] - 3 + 6 * ((f - 1826) / FPS) ** 1.3;
      card(out, "truck", (p) => truck(p), x, 0, CAMP[2] - 2.2, 5.6, 2.8, [1600, 800, 0.8]);
      for (let i = 0; i < 2; i++) person(out, cam, i ? MAJOR : SOLDIERS[0], i ? "maj" : "s0", x - 1.4 + i * 1.0, CAMP[2] - 2.1, { mode: "stand", expr: "pained" }, i + 1, f, 1.0);
      puffAt(out, f, x - 3.2, CAMP[2] - 2, 1.6, 16);
      for (let i = 0; i < 5; i++) bird(out, cam, CAMP[0] - 10 + i * 2.2, CAMP[2] + 3 + (i % 2), 1, 0, { mode: "stand", expr: "smug", col: i });
      break;
    }
    case 15: {
      bird(out, cam, HOOK[0], HOOK[2], 1, 0.2, { mode: "stand", expr: (f % 45) < 4 ? "blink" : "smug", hat: "cap", col: 0 }, 1.05);
      for (let i = 0; i < 8; i++) bird(out, cam, HOOK[0] - 6 + i * 1.8, HOOK[2] - 6 - (i % 3) * 1.5, 1, 0, { mode: i % 2 ? "eat" : "stand", col: i, phase: 0 });
      wheatRow(out, HOOK[0], HOOK[2] + 1.5, 6, 4);
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
  private fog = new THREE.Fog("#bccbec", 60, 900);
  private clouds: THREE.Mesh[] = [];
  private cloudMaps: Record<"day" | "golden", THREE.Texture[]>;
  private wheel: THREE.Mesh;
  private trees: { x: number; z: number; s: number; seed: number }[] = [];
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
    this.cloudMaps = { day: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.day.cloud)), golden: [0, 1, 2, 3].map((k) => cloudHD(k, LOOK.golden.cloud)) };
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3, d = 900 + (i % 3) * 80;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.cloudMaps.day[i % 4], color: new THREE.Color(1.1, 1.1, 1.1), transparent: true, depthWrite: false, fog: false }));
      const w = 200 + (i % 4) * 50; m.position.set(Math.cos(a) * d, 150 + (i % 4) * 50, Math.sin(a) * d); m.scale.set(w, w / 2, 1);
      m.layers.set(NOINK); this.clouds.push(m); R.add(m);
    }

    const b = new Batch();
    const dirt = lam("redDirt", () => ({ map: dirtTex() })), wheat = lam("wheat", () => ({ map: wheatTex() }));
    const grass = lam("dryGrass", () => ({ map: grassTex() })), track = lam("track", () => ({ map: trackTex() }));
    b.add(ground(-1500, 1500, -1500, 1500, -0.02, 10), dirt);
    // wheat paddocks: the farm's (north of the track), the hook paddock (south-east), a few far ones
    for (const [x0, x1, z0, z1] of [[-90, 60, -100, 2], [18, 70, 11, 80], [-260, -150, -160, -40], [120, 260, 30, 160], [-60, 40, 100, 200]] as const) b.add(ground(x0, x1, z0, z1, 0.0, 8), wheat);
    b.add(ground(-200, -40, 14, 120, 0.0, 10), grass); // the open paddock (PLAIN)
    b.add(ground(-600, 600, 3.5, 8.5, 0.01, 5), track);
    // fences along the paddocks: posts + two wires (thin boxes)
    const post = lam("fencePost", () => ({ color: "#8a6a48" })), wire = lam("fenceWire", () => ({ color: "#6a6460" }));
    for (const z of [2.6, 9.4]) {
      for (let x = -200; x <= 200; x += 4) b.add(boxGeo(V(x - 0.06, 0, z - 0.06), V(x + 0.06, 1.1, z + 0.06)), post);
      for (const y of [0.55, 0.95]) b.add(boxGeo(V(-200, y - 0.012, z - 0.012), V(200, y + 0.012, z + 0.012)), wire);
    }
    // the farm: homestead + shed (period houses from the template), water tank, windpump tower
    house(b, FARM[0], FARM[2] - 4, 0, 10, 8, 3.8, 0, 0);
    house(b, FARM[0] + 13, FARM[2] - 3, -0.3, 7, 6, 3.2, 4, 0);
    const tank = lam("tank", () => ({ color: "#b9bcc2" })), timber = lam("timber", () => ({ color: "#8a6a48" }));
    b.add(new THREE.CylinderGeometry(1.4, 1.4, 2.4, 20).translate(0, 1.2 + 1.6, 0), tank, new THREE.Matrix4().makeTranslation(FARM[0] - 8, 0, FARM[2] - 2));
    for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) b.add(boxGeo(V(dx - 0.08, 0, dz - 0.08), V(dx + 0.08, 1.6, dz + 0.08)), timber, new THREE.Matrix4().makeTranslation(FARM[0] - 8, 0, FARM[2] - 2));
    const wp = V(FARM[0] - 14, 0, FARM[2] + 2);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
      const g = new THREE.CylinderGeometry(0.06, 0.06, 9.3, 6); g.translate(0, 4.6, 0);
      const m = new THREE.Matrix4().compose(V(wp.x + dx * 0.55, 0, wp.z + dz * 0.55), new THREE.Quaternion().setFromEuler(new THREE.Euler(-dz * 0.07, 0, dx * 0.07)), V(1, 1, 1));
      b.add(g, timber, m);
    }
    // the dam: water disc inside a raised mud ring
    const water = lam("damWater", () => ({ color: "#5f8fa8" })), mud = lam("mud", () => ({ color: "#a86a42" }));
    b.add(disc(DAM[0], DAM[2], 16, 0.03), mud);
    b.add(disc(DAM[0], DAM[2], 12, 0.06), water);
    // far hills: low flattened domes on the horizon
    const hill = lam("hills", () => ({ color: "#9a7a8a" }));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, d = 650 + (i % 3) * 90, r = 120 + (i % 4) * 40;
      const g = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.22, 0.7);
      b.add(g, hill, new THREE.Matrix4().makeTranslation(Math.cos(a) * d, -2, Math.sin(a) * d));
    }
    b.build(R);
    // windpump wheel (spins)
    this.wheel = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.08, 18).rotateX(Math.PI / 2), lam("pumpWheel", () => ({ color: "#d6d2c6" })));
    this.wheel.position.set(wp.x, 9.6, wp.z + 0.3); this.wheel.castShadow = true; R.add(this.wheel);
    // gum trees (cards, placed per shot near the lens)
    for (let i = 0; i < 70; i++) {
      const a = hh(i, 21) * Math.PI * 2, d = 25 + 220 * hh(i, 22), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(z - 6) < 6) continue;
      this.trees.push({ x, z, s: 0.8 + 0.6 * hh(i, 23), seed: i });
    }
    this.trees.push({ x: DAM[0] - 14, z: DAM[2] - 6, s: 1.2, seed: 3 }, { x: DAM[0] + 15, z: DAM[2] - 2, s: 1.0, seed: 8 }, { x: FARM[0] + 22, z: FARM[2] - 8, s: 1.3, seed: 5 });
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
    const sunDir = s.light === "golden" ? GOLD_SUN : DAY_SUN;
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemiI;
    this.sun.color.set(L.sunCol); this.sun.intensity = L.sunI;
    const Rr = THREE.MathUtils.clamp(dist * 0.9 + 8, 12, 120);
    this.sun.position.copy(focus).addScaledVector(sunDir, 400); this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.near = 50; sc.far = 900; sc.updateProjectionMatrix();
    this.sun.shadow.bias = L.bias; this.sun.shadow.normalBias = L.normalBias * (Rr / 12);
    TONE.uLitCol.value.set(...L.lit); TONE.uShadeCol.value.set(...L.shade); TONE.uShadeLift.value.set(...L.lift);
    TONE.uLambert.value = L.lambert; TONE.uSideK.value = L.sideK; TONE.uTerm.value = L.term; TONE.uBounce.value.set(...K.bounce); TONE.uSat.value = K.sat;
    CHAR.uCharTint.value.set(...L.charTint); CHAR.uCharShade.value = L.charShade; CHAR.uGrad.value = L.charGrad;
    CHAR.uBodyGrad.value = L.bodyGrad; CHAR.uSideTint.value.set(...L.sideTint);
    const su = this.skyMat.uniforms;
    K.sky.c.forEach((h, i) => untone(h, su["c" + i].value));
    const e = K.sky.e.map((deg) => THREE.MathUtils.degToRad(deg));
    su.e.value.set(e[1], e[2], e[3], e[4]);
    this.sky.position.copy(cam.position);
    untone(L.fog, this.fog.color); this.fog.near = 80; this.fog.far = 1000;
    scene.fog = this.fog; scene.background = null;
    for (let i = 0; i < this.clouds.length; i++) {
      const m = this.clouds[i]; m.lookAt(cam.position.x, m.position.y, cam.position.z);
      (m.material as THREE.MeshBasicMaterial).map = this.cloudMaps[s.light][i % 4];
    }
    this.wheel.rotation.z = (f / FPS) * 2.2;
    // ---- cast ----
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const ci: CamInfo = { pos: cam.position, right, sun: sunDir };
    const st = stage(id, f, ci);
    // gum trees: only ones within 160 m of the lens and not between the lens and its subject
    const fw = focus.clone().sub(cam.position).normalize();
    for (const tr of this.trees) {
      const d = Math.hypot(tr.x - cam.position.x, tr.z - cam.position.z);
      if (d > 160) continue;
      const along = (tr.x - cam.position.x) * fw.x + (tr.z - cam.position.z) * fw.z;
      if (along > 0 && along < dist + 4) { const px = cam.position.x + fw.x * along, pz = cam.position.z + fw.z * along; if (Math.hypot(tr.x - px, tr.z - pz) < 6 * tr.s) continue; }
      st.places.push({ key: `gum${tr.seed % 4}`, draw: (p) => gum(p, tr.seed % 4), x: tr.x, y: 0, z: tr.z, size: d < 30 ? [900, 1400, 1] : [450, 700, 0.5], card: [9 * tr.s, 14 * tr.s] });
    }
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let ai = 0, cj = 0;
    const used: Actor[] = [];
    for (const p of st.places) {
      const rad = p.card ? Math.max(...p.card) : 3 * (p.s ?? 1);
      if (!this.frustum.intersectsSphere(this.sph.set(V(p.x, p.y + 1.2, p.z), rad))) continue;
      const a = p.card ? this.card(cj++) : this.actor(ai++);
      const [w, h, k] = p.size;
      a.r = this.pool.req(p.key, w, h, k, p.draw);
      a.mesh.visible = true;
      a.mesh.position.set(p.x, p.y, p.z);
      a.mesh.rotation.set(0, p.yaw ?? Math.atan2(cam.position.x - p.x, cam.position.z - p.z), p.roll ?? 0);
      const sx = p.card ? p.card[0] : p.s ?? 1, sy = p.card ? p.card[1] : p.s ?? 1;
      a.mesh.scale.set(p.mirror ? -sx : sx, sy, p.s ?? 1);
      a.mesh.castShadow = L.actorShadow;
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
