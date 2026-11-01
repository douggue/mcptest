// Flat ink drawings for the props that carry the jokes (all text-free): the Jaguar-ish saloon melting, the doormat,
// the bike seat, the frying pan + egg, magnifying glass + leaf, smoke, the "worst building" rosette, palms,
// loungers, blue umbrellas. Same Pen / plum ink as the characters (toon.ts).
import { Pen, INK, mix, shade } from "../bridge/toon";

type P2 = [number, number];
const rr = (x0: number, y0: number, x1: number, y1: number, r: number): P2[] => {
  const pts: P2[] = [];
  for (const [cx, cy, a] of [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]] as const)
    for (let i = 0; i <= 6; i++) { const t = ((a + i * 15) * Math.PI) / 180; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  return pts;
};
const hh = (i: number) => { const v = Math.sin(i * 127.1) * 43758.5453; return v - Math.floor(v); };

/** side-view luxury saloon on a 1600 x 640 canvas, wheels on y = 600, nose to the right. m = melt 0..1 per part. */
export const car = (p: Pen, m: { mirror: number; badge: number; panel: number }, col = "#b3262d") => {
  const g = p.g, dark = shade(col, 0.72), lite = mix(col, "#ffffff", 0.35);
  // body: long low saloon, the lower edge sags and drips as the panels go soft
  const sag = 26 * m.panel;
  const top: P2[] = [[120, 400], [180, 330], [420, 300], [560, 190], [940, 180], [1120, 290], [1440, 320], [1520, 370], [1530, 440]];
  const bottom: P2[] = [];
  for (let i = 0; i <= 28; i++) {
    const x = 1530 - (1410 * i) / 28, k = Math.sin((i / 28) * Math.PI);
    bottom.push([x, 520 + sag * k + (i % 3 === 1 ? 10 * m.panel : 0)]);
  }
  p.poly([...top, ...bottom], col, 12);
  // shine stripe + lower shade
  p.poly([[200, 370], [520, 350], [1440, 360], [1450, 385], [520, 380], [200, 400]], lite, 0);
  p.clip([...top, ...bottom], () => { p.g.fillStyle = dark; p.g.fillRect(100, 470 + sag * 0.6, 1500, 120); });
  // drips off the sill
  for (let i = 0; i < 7; i++) {
    const x = 330 + i * 150 + 30 * hh(i), l = (40 + 60 * hh(i + 9)) * m.panel;
    if (l > 4) p.poly([[x - 16, 520 + sag], [x + 16, 520 + sag], [x + 10, 520 + sag + l], [x, 532 + sag + l], [x - 10, 520 + sag + l]], dark, 8);
  }
  // glasshouse
  p.poly([[600, 210], [920, 202], [1070, 300], [470, 310]], "#9fd0ea", 10);
  p.stroke([[770, 205], [770, 305]], 16, INK);
  p.poly([[640, 222], [700, 220], [600, 296], [540, 298]], "#e3f4fb", 0);
  // door lines + handles
  p.stroke([[770, 312], [770, 515]], 7, INK); p.stroke([[1080, 312], [1110, 512]], 7, INK);
  p.stroke([[830, 350], [880, 350]], 10, "#e9e9ee"); p.stroke([[1120, 350], [1170, 350]], 10, "#e9e9ee");
  // lamps
  p.poly([[1470, 340], [1525, 360], [1525, 395], [1470, 390]], "#fff3c4", 8);
  p.poly([[125, 395], [165, 372], [168, 420], [128, 425]], "#e6453a", 8);
  // wheels
  for (const x of [380, 1260]) {
    p.ell(x, 520, 96, 96, "#2a2730", 12);
    p.ell(x, 520, 54, 54, "#cfd3db", 10);
    for (let k = 0; k < 5; k++) { const a = (k * 2 * Math.PI) / 5; p.stroke([[x, 520], [x + 46 * Math.cos(a), 520 + 46 * Math.sin(a)]], 9, "#8d93a0"); }
    p.dot(x, 520, 12, INK);
  }
  // wing mirror: pivots at the A-pillar, droops and stretches into a drip
  const mx = 1050, my = 300, a = m.mirror * 1.15, L = 90 + 70 * m.mirror;
  const ex = mx + L * Math.cos(-0.3 + a), ey = my + L * Math.sin(-0.3 + a) * 0.9;
  p.line([[mx, my], [mx + 30, my - 8 + 30 * m.mirror], [ex, ey]], col, 26);
  p.ell(ex, ey + 10 * m.mirror, 44 - 10 * m.mirror, 30 + 22 * m.mirror, "#c8ccd6", 10, 0, 360, 25 + 60 * m.mirror);
  if (m.mirror > 0.4) p.poly([[ex - 8, ey + 40], [ex + 8, ey + 40], [ex + 3, ey + 40 + 90 * (m.mirror - 0.4)], [ex - 3, ey + 40 + 90 * (m.mirror - 0.4)]], col, 7);
  // round bonnet badge, sliding down the nose and dripping
  const bx = 1485, by = 330 + 70 * m.badge;
  p.ell(bx, by, 26, 26 + 16 * m.badge, "#e8c45a", 8);
  p.dot(bx, by, 8, "#a5832c");
  if (m.badge > 0.3) p.poly([[bx - 7, by + 30], [bx + 7, by + 30], [bx, by + 30 + 80 * (m.badge - 0.3)]], "#e8c45a", 6);
  // heat shimmer ticks over the roof
  if (m.panel + m.mirror > 0.2) {
    g.globalAlpha = Math.min(1, m.panel + m.mirror);
    for (let k = 0; k < 3; k++) { const x = 650 + k * 140; p.stroke([[x, 160], [x + 18, 130], [x - 6, 100], [x + 12, 70]], 9, "#fff0b8"); }
    g.globalAlpha = 1;
  }
};

/** doormat lying flat (top-down) on a 600 x 400 canvas; burn 0..1 grows a scorched hole */
export const doormat = (p: Pen, burn: number) => {
  p.poly(rr(30, 40, 570, 360, 30), "#a97845", 10);
  p.poly(rr(70, 80, 530, 320, 20), "#c2905a", 0);
  for (let i = 0; i < 26; i++) p.stroke([[90 + i * 17, 95], [90 + i * 17, 305]], 3, "#9a6a3c");
  if (burn > 0.02) {
    const r = 30 + 110 * burn;
    p.ell(330, 200, r * 1.25, r, "#3a2620", 0);
    p.ell(330, 200, r * 0.7, r * 0.55, "#140e10", 0);
    p.ell(330, 200, r * 0.45, r * 0.35, burn > 0.5 ? "#ff8a2a" : "#2a1a14", 0);
  }
};

/** grey-brown smoke puff on a 300 x 300 canvas; t 0..1 (rises, grows, fades) */
export const smoke = (p: Pen, t: number, dark = false) => {
  const a = (1 - t) * (dark ? 0.95 : 0.85);
  for (let i = 0; i < 5; i++) {
    const ang = ((160 + i * 55) * Math.PI) / 180, d = 30 + 60 * t, r = (40 + 18 * (i % 2)) * (0.55 + 0.6 * t);
    p.ell(150 + d * Math.cos(ang), 160 + d * 0.5 * Math.sin(ang), r, r * 0.85, dark ? `rgba(90,86,96,${a.toFixed(3)})` : `rgba(170,166,176,${a.toFixed(3)})`, 0);
  }
};

/** bicycle side view on a 900 x 600 canvas (ground y = 560); blister 0..1 bubbles the saddle */
export const bike = (p: Pen, blister: number) => {
  const fr = "#2f7fbf";
  p.ell(200, 440, 120, 120, null, 16); p.ell(700, 440, 120, 120, null, 16);
  p.ell(200, 440, 100, 100, null, 4); p.ell(700, 440, 100, 100, null, 4);
  p.line([[200, 440], [400, 440], [330, 250], [200, 440]], fr, 18);
  p.line([[400, 440], [620, 260], [330, 250]], fr, 18);
  p.line([[620, 260], [700, 440]], fr, 18);
  p.line([[620, 260], [600, 190], [660, 180]], INK, 12);
  p.dot(400, 440, 22, INK);
  // saddle on its post
  p.line([[330, 250], [320, 200]], "#9aa0aa", 12);
  p.poly([[240, 196], [400, 182], [420, 204], [260, 214]], "#2b2530", 9);
  if (blister > 0.02) for (let i = 0; i < 5; i++) {
    const r = (10 + 14 * hh(i)) * Math.min(1, blister * 1.6 - i * 0.15);
    if (r > 2) p.ell(270 + i * 30, 186 - r * 0.6, r, r * 0.8, "#4a3f50", 6);
  }
};

/** frying pan held flat-ish with an egg, on a 700 x 400 canvas; t 0..1 sets the egg (sizzle, bubbles) */
export const pan = (p: Pen, t: number) => {
  p.line([[470, 210], [690, 170]], "#2b2530", 30);
  p.ell(270, 220, 220, 120, "#3a3a44", 12);
  p.ell(270, 210, 190, 98, "#55555f", 0);
  const w = 0.6 + 0.4 * t;
  p.poly([[160, 210], [200, 160], [290, 150], [360, 175], [380, 225], [320, 265], [210, 262]].map(([x, y]) => [270 + (x - 270) * w, 210 + (y - 210) * w] as P2), "#fbf8ef", 8);
  p.ell(275, 205, 46, 40, "#ffb21e", 8);
  p.ell(262, 192, 12, 9, "#ffe39a", 0);
  if (t > 0) for (let i = 0; i < 6; i++) {
    const x = 120 + i * 60, h = 40 + 40 * hh(i + 3) * t;
    p.stroke([[x, 110], [x + 12, 110 - h * 0.5], [x - 4, 110 - h]], 7, "#ffffff");
  }
};

/** magnifying glass on a 500 x 700 canvas: lens up top, handle down */
export const magnifier = (p: Pen) => {
  p.line([[250, 420], [250, 660]], "#8a4f2c", 46);
  p.ell(250, 230, 190, 190, "#c9e9f7", 22);
  p.ell(190, 170, 50, 30, "#ffffff", 0, 0, 360, -35);
  p.ell(250, 230, 190, 190, null, 30);
};
/** leaf on the pavement (top-down) on a 400 x 300 canvas, with a burning spot */
export const leaf = (p: Pen, burn: number) => {
  p.poly([[40, 150], [140, 60], [300, 70], [370, 150], [300, 230], [140, 240]], "#5ca84a", 9);
  p.stroke([[50, 150], [360, 150]], 6, "#3d7a31");
  for (const x of [130, 200, 270]) { p.stroke([[x, 150], [x + 40, 95]], 4, "#3d7a31"); p.stroke([[x, 150], [x + 40, 205]], 4, "#3d7a31"); }
  if (burn > 0.02) { p.ell(220, 150, 30 * burn + 6, 26 * burn + 5, "#2a1a14", 0); p.ell(220, 150, 12 * burn + 3, 10 * burn + 3, "#ffcf3a", 0); }
};
/** sun spot / glow (soft) on a 256 x 256 canvas */
export const glow = (p: Pen, col = "255,236,170") => {
  const g = p.g, gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, `rgba(255,255,255,1)`); gr.addColorStop(0.25, `rgba(${col},0.9)`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
};

/** giant booby-prize rosette (no text) on an 800 x 1200 canvas: brown/grey, two ribbons, a wilted star */
export const rosette = (p: Pen) => {
  for (const [x0, x1] of [[300, 210], [500, 590]] as const) p.poly([[x0 - 70, 500], [x0 + 70, 500], [x1 + 70, 1150], [x1, 1080], [x1 - 70, 1150]], "#7d6a52", 12);
  const pts: P2[] = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, r = i % 2 ? 330 : 370; pts.push([400 + r * Math.cos(a), 420 + r * Math.sin(a)]); }
  p.poly(pts, "#a39072", 12);
  p.ell(400, 420, 250, 250, "#8f9a8a", 12);
  p.ell(400, 420, 170, 170, "#c8c2b2", 10);
  const st: P2[] = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 50 : 120; st.push([400 + r * Math.cos(a), 430 + r * Math.sin(a) + (i > 3 && i < 7 ? 30 : 0)]); }
  p.poly(st, "#8a8170", 9);
};

/** palm tree on a 600 x 1400 canvas (base at the bottom centre) */
export const palm = (p: Pen, seed: number) => {
  const lean = (hh(seed) - 0.5) * 120;
  p.line([[300, 1390], [300 + lean * 0.4, 900], [300 + lean, 330]], "#a77a4c", 46);
  for (let k = 0; k < 10; k++) p.stroke([[300 + lean * (0.35 + k * 0.06) - 22, 1300 - k * 100], [300 + lean * (0.35 + k * 0.06) + 22, 1290 - k * 100]], 5, "#7a5634");
  const cx = 300 + lean, cy = 330;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + (i / 6) * Math.PI, ex = cx + 270 * Math.cos(a), ey = cy + 120 * Math.sin(a) + 150 * Math.abs(Math.cos(a));
    p.poly([[cx, cy], [cx + 140 * Math.cos(a) - 30, cy - 40 + 60 * Math.sin(a)], [ex, ey], [cx + 140 * Math.cos(a) + 30, cy + 30 + 60 * Math.sin(a)]], i % 2 ? "#3f9a4a" : "#57b356", 9);
  }
  p.ell(cx, cy + 10, 34, 28, "#7a5634", 8);
};
/** sun lounger with a tourist lying on it, side view, on an 900 x 500 canvas; cook 0..1 = smoking hair */
export const lounger = (p: Pen, cook: number, skin = "#f5c9a0", suit = "#e94e6a") => {
  p.line([[120, 440], [160, 330]], INK, 10); p.line([[760, 440], [720, 330]], INK, 10);
  p.poly([[100, 340], [640, 340], [800, 230], [820, 250], [660, 370], [100, 370]], "#f2f2f2", 9);
  p.poly([[180, 300], [560, 300], [570, 340], [180, 340]], skin, 9);
  p.poly([[330, 296], [460, 296], [460, 342], [330, 342]], suit, 9);
  p.ell(650, 270, 70, 64, skin, 10);
  p.ell(675, 255, 16, 6, INK, 0); // shades
  p.poly([[640, 248], [700, 244], [700, 262], [640, 266]], "#2a2a33", 6);
  p.poly([[590, 230], [650, 196], [720, 210], [705, 236], [610, 250]], cook > 0.3 ? "#5a4636" : "#d9a441", 9);
  if (cook > 0.05) for (let i = 0; i < 3; i++) { const x = 620 + i * 34, h = 60 + 80 * cook; p.stroke([[x, 200], [x + 16, 200 - h * 0.5], [x - 6, 200 - h]], 9, "#8d8a94"); }
};
/** big blue pool umbrella, side view, on a 700 x 800 canvas */
export const umbrella = (p: Pen) => {
  p.line([[350, 780], [350, 200]], "#e9e6dd", 16);
  p.poly([[40, 260], [120, 170], [350, 110], [580, 170], [660, 260], [560, 230], [450, 255], [350, 230], [250, 255], [140, 230]], "#2f6fd0", 12);
  p.stroke([[350, 112], [250, 252]], 5, "#1d4fa0"); p.stroke([[350, 112], [450, 252]], 5, "#1d4fa0");
};
