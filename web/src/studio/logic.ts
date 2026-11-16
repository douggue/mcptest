// Pure editing operations on a ShortSpec. No React, no network.
import { Piece, buildPlan, outFrameOf, srcTimeAt, totalFrames } from '../remotion/timing';
import { ASPECTS, Anim, Aspect, Face, Graphic, GraphicType, Layout, Segment, ShortSpec, Shot, Word, Zone } from '../remotion/types';

export type EditSpec = ShortSpec & {
  /** Editor-only settings the composition ignores. */
  edit?: { silence: number };   // remove pauses longer than this many seconds; 0 = keep pauses
};

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

export const FILLERS = new Set(['um', 'uh', 'uhh', 'umm', 'er', 'erm', 'ah', 'hmm', 'mm']);
export const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/** Kept ranges of the source, derived from removed words and the silence setting. */
export function deriveSegments(spec: EditSpec): Segment[] {
  const { in: tin, out: tout } = spec;
  const words = spec.words.filter((w) => w.end > tin && w.start < tout);
  const cuts: Segment[] = [];
  const maxGap = spec.edit?.silence ?? 0;

  // runs of removed words
  let i = 0;
  while (i < words.length) {
    if (!words[i].removed) { i++; continue; }
    let j = i;
    while (j + 1 < words.length && words[j + 1].removed) j++;
    const before = words[i - 1];
    const after = words[j + 1];
    const start = before ? Math.min(before.end + 0.04, words[i].start) : tin;
    const end = after ? Math.max(after.start - 0.04, words[j].end) : tout;
    if (end - start > 0.06) cuts.push({ start, end });
    i = j + 1;
  }
  // long pauses between kept words
  if (maxGap > 0) {
    const live = words.filter((w) => !w.removed);
    const keep = Math.min(maxGap, 0.24) / 2;
    for (let k = 0; k + 1 < live.length; k++) {
      const gap = live[k + 1].start - live[k].end;
      if (gap > maxGap) cuts.push({ start: live[k].end + keep, end: live[k + 1].start - keep });
    }
    if (live.length) {
      if (live[0].start - tin > maxGap) cuts.push({ start: tin, end: live[0].start - 0.15 });
      if (tout - live[live.length - 1].end > maxGap + 0.2) cuts.push({ start: live[live.length - 1].end + 0.3, end: tout });
    }
  }
  cuts.sort((a, b) => a.start - b.start);
  const segs: Segment[] = [];
  let cursor = tin;
  for (const c of cuts) {
    const s = clamp(c.start, tin, tout);
    const e = clamp(c.end, tin, tout);
    if (e <= cursor) continue;
    if (s - cursor > 0.08) segs.push({ start: round3(cursor), end: round3(s) });
    cursor = Math.max(cursor, e);
  }
  if (tout - cursor > 0.08) segs.push({ start: round3(cursor), end: round3(tout) });
  return segs.length ? segs : [{ start: tin, end: tout }];
}

export const withSegments = (spec: EditSpec): EditSpec => ({ ...spec, segments: deriveSegments(spec) });

export function planOf(spec: ShortSpec): { plan: Piece[]; frames: number; seconds: number } {
  const plan = buildPlan(spec);
  const frames = totalFrames(plan);
  return { plan, frames, seconds: frames / spec.fps };
}

export const srcAt = (spec: ShortSpec, plan: Piece[], frame: number) => srcTimeAt(plan, frame, spec.fps);
export const outSeconds = (spec: ShortSpec, plan: Piece[], t: number) => outFrameOf(plan, t, spec.fps) / spec.fps;

/* ---------- words ---------- */
export const patchWord = (spec: EditSpec, id: number, patch: Partial<Word>): EditSpec =>
  withSegments({ ...spec, words: spec.words.map((w) => (w.id === id ? { ...w, ...patch } : w)) });

export function removeFillers(spec: EditSpec): { spec: EditSpec; count: number } {
  let count = 0;
  const words = spec.words.map((w) => {
    if (!w.removed && FILLERS.has(bare(w.text))) { count++; return { ...w, removed: true }; }
    return w;
  });
  return { spec: withSegments({ ...spec, words }), count };
}

export const restoreWords = (spec: EditSpec): EditSpec =>
  withSegments({ ...spec, words: spec.words.map((w) => (w.removed ? { ...w, removed: false } : w)), edit: { silence: 0 } });

/** Change the clip's range, pulling newly covered words from the full transcript. */
export function retime(spec: EditSpec, all: Word[], tin: number, tout: number): EditSpec {
  const have = new Map(spec.words.map((w) => [w.id, w]));
  const words = all.filter((w) => w.start >= tin - 0.05 && w.end <= tout + 0.05).map((w) => have.get(w.id) ?? { ...w });
  const shots = spec.shots.filter((s, i) => i === 0 || (s.start > tin && s.start < tout));
  shots[0] = { ...shots[0], start: tin };
  return withSegments({
    ...spec, in: round3(tin), out: round3(tout), words, shots,
    zooms: spec.zooms.filter((z) => z.at >= tin && z.at < tout),
    graphics: spec.graphics.filter((g) => g.at >= tin && g.at < tout),
  });
}

/* ---------- framing ---------- */
export function paneCount(layout: Layout): number {
  return layout === 'split' ? 2 : layout === 'trio' ? 3 : 1;
}

/** Crop position (0..100) that centres a face at `cx` (0..1 of the source) in one pane of this layout. */
export function faceToX(cx: number, spec: ShortSpec, layout: Layout): number {
  const n = paneCount(layout);
  const landscape = spec.width > spec.height;
  const paneAspect = landscape ? spec.width / n / spec.height : spec.width / (spec.height / n);
  const visible = paneAspect / (spec.srcW / spec.srcH);   // share of the source width a pane shows
  if (visible >= 1) return 50;
  return Math.round(clamp((cx - visible / 2) / (1 - visible), 0, 1) * 1000) / 10;
}

export type AnalysedShot = { start: number; end: number; faces: Face[]; track: { t: number; cx: number }[] };

/** Build the shot list from a picture analysis: one shot per camera cut, centred on whoever is speaking.
 *  With `keepLayouts`, the analysis is for the user's own cuts, so each shot keeps its layout and transition. */
export function applyAnalysis(spec: EditSpec, shots: AnalysedShot[], opts: { splitTwo: boolean; follow: boolean; keepLayouts?: boolean }): EditSpec {
  const sameCuts = !!opts.keepLayouts && shots.length === spec.shots.length;
  const next: Shot[] = shots.map((s, i) => {
    const prev = spec.shots[i];
    const faces = s.faces;
    const similar = faces.length >= 2 && Math.min(faces[0].w, faces[1].w) / Math.max(faces[0].w, faces[1].w) > 0.55;
    const layout: Layout = sameCuts ? prev.layout : opts.splitTwo && similar ? 'split' : 'single';
    const n = paneCount(layout);
    let x: number[];
    if (layout === 'fit') x = [50];
    else if (faces.length >= n && n > 1) x = [...faces.slice(0, n)].sort((a, b) => a.cx - b.cx).map((f) => faceToX(f.cx, spec, layout));
    else if (faces.length && n === 1) x = [faceToX(faces[0].cx, spec, layout)];
    else x = prev?.layout === layout ? prev.x : Array.from({ length: n }, (_, k) => (n === 1 ? 50 : Math.round((100 * (k + 0.5)) / n)));
    const moves = s.track.length > 1 && Math.max(...s.track.map((k) => k.cx)) - Math.min(...s.track.map((k) => k.cx)) > 0.04;
    return {
      start: round3(s.start), layout, x, y: sameCuts ? prev.y : undefined, transition: sameCuts ? prev.transition : 'cut', faces,
      track: opts.follow && layout === 'single' && moves ? s.track.map((k) => ({ t: k.t, x: faceToX(k.cx, spec, layout) })) : undefined,
    };
  });
  return { ...spec, shots: next.length ? next : spec.shots };
}

export function setLayout(spec: EditSpec, index: number, layout: Layout): EditSpec {
  const shots = spec.shots.map((s, i) => {
    if (i !== index) return s;
    const n = paneCount(layout);
    const faces = [...(s.faces ?? [])];
    const x = Array.from({ length: n }, (_, k) => {
      if (faces.length >= n) return faceToX([...faces.slice(0, n)].sort((a, b) => a.cx - b.cx)[k].cx, spec, layout);
      return n === 1 ? (s.x[0] ?? 50) : Math.round((100 * (k + 0.5)) / n);
    });
    return { ...s, layout, x, track: undefined };
  });
  return { ...spec, shots };
}

export function addCut(spec: EditSpec, t: number): EditSpec {
  if (spec.shots.some((s) => Math.abs(s.start - t) < 0.2) || t <= spec.in + 0.2 || t >= spec.out - 0.2) return spec;
  const idx = spec.shots.reduce((acc, s, i) => (s.start <= t ? i : acc), 0);
  const base = spec.shots[idx];
  const shot: Shot = { ...base, start: round3(t), track: undefined };
  const shots = [...spec.shots, shot].sort((a, b) => a.start - b.start);
  return { ...spec, shots };
}

export const removeShot = (spec: EditSpec, index: number): EditSpec =>
  index === 0 ? spec : { ...spec, shots: spec.shots.filter((_, i) => i !== index) };

export function autoZooms(spec: EditSpec): EditSpec {
  const zooms = [] as EditSpec['zooms'];
  let last = -99;
  for (const w of spec.words) {
    if (w.removed) continue;
    const strong = w.emphasis || /\d/.test(w.text) || /[!?]$/.test(w.text);
    if (strong && w.start - last > 4 && w.start > spec.in + 1.5) {
      zooms.push({ id: uid(), at: round3(Math.max(spec.in, w.start - 0.1)), duration: 1.4, scale: 1.14 });
      last = w.start;
    }
  }
  return { ...spec, zooms };
}

/* ---------- motion ---------- */
export const GRAPHIC_LABELS: Record<GraphicType, string> = {
  keyword: 'Keyword pop', cascade: 'Keyword cascade', gauge: 'Radial gauge', counter: 'Number counter',
  lowerthird: 'Lower third', steps: 'Step list', broll: 'B-roll', emoji: 'Emoji burst',
};
export const ZONE_LABELS: Record<Zone, string> = { full: 'Full', top: 'Top', center: 'Center', bottom: 'Bottom', overlay: 'Overlay' };
export const ANIM_LABELS: Record<Anim, string> = { pop: 'Spring pop', slam: 'Slam', fade: 'Fade', slide: 'Slide up', glitch: 'Glitch flash', type: 'Wipe in' };

export function newGraphic(type: GraphicType, at: number): Graphic {
  const zone: Zone = type === 'cascade' || type === 'steps' || type === 'broll' ? 'full' : type === 'lowerthird' ? 'bottom' : type === 'keyword' ? 'top' : 'center';
  return {
    id: uid(), type, zone, at: round3(at), duration: type === 'cascade' || type === 'steps' ? 3 : 2.2,
    animation: type === 'lowerthird' ? 'slide' : type === 'broll' ? 'fade' : 'pop', sfx: type === 'broll' ? '' : 'pop',
    primary: type === 'gauge' ? '40%' : type === 'counter' ? '100' : type === 'emoji' ? '🔥' : type === 'broll' ? '' : 'KEYWORD',
    headline: '', keywords: type === 'cascade' || type === 'steps' ? ['ONE', 'TWO', 'THREE'] : [],
  };
}

type RemixPlan = {
  hook: string; emphasis_word_ids: number[]; emojis: { word_id: number; emoji: string }[];
  zooms: { word_id: number; seconds: number }[];
  graphics: { word_id: number; type: GraphicType; zone: Zone; animation: Anim; sfx: string; seconds: number; primary: string; headline: string; keywords: string[] }[];
};

export function applyRemix(spec: EditSpec, plan: RemixPlan, keep: { hook: boolean }): EditSpec {
  const at = new Map(spec.words.map((w) => [w.id, w.start]));
  const emph = new Set(plan.emphasis_word_ids);
  const emoji = new Map(plan.emojis.map((e) => [e.word_id, e.emoji]));
  const broll = spec.graphics.filter((g) => g.type === 'broll');   // b-roll is chosen by the user; a remix leaves it alone
  return {
    ...spec,
    hook: keep.hook && spec.hook.text ? spec.hook : { ...spec.hook, text: plan.hook || spec.hook.text, visible: true },
    words: spec.words.map((w) => ({ ...w, emphasis: emph.has(w.id), emoji: emoji.get(w.id) })),
    zooms: plan.zooms.filter((z) => at.has(z.word_id)).map((z) => ({ id: uid(), at: round3(Math.max(spec.in, at.get(z.word_id)! - 0.1)), duration: clamp(z.seconds, 0.6, 3), scale: 1.14 })),
    graphics: [...broll, ...plan.graphics.filter((g) => at.has(g.word_id)).map((g) => ({
      id: uid(), type: g.type, zone: g.zone, at: round3(at.get(g.word_id)!), duration: clamp(g.seconds, 1, 6),
      animation: g.animation, sfx: g.sfx, primary: g.primary, headline: g.headline, keywords: g.keywords,
    }))].sort((a, b) => a.at - b.at),
  };
}

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

export function shuffleGraphics(spec: EditSpec): EditSpec {
  return {
    ...spec,
    graphics: spec.graphics.map((g) => {
      if (g.type === 'broll') return g;
      const zones: Zone[] = g.type === 'lowerthird' ? ['bottom', 'top'] : g.type === 'cascade' || g.type === 'steps' ? ['full', 'top'] : ['top', 'center', 'overlay', 'full'];
      return { ...g, zone: pick(zones), animation: pick(['pop', 'slam', 'fade', 'slide', 'glitch', 'type'] as const), sfx: pick(['pop', 'whoosh', 'click', 'ding', 'thud', 'swish', 'sparkle']) };
    }),
  };
}

export type BrollAsset = { name: string; url: string; type: 'image' | 'video' | 'gif' | 'audio'; id: string };

/** Place library media over the words they match (by file name), about `per30` times per 30 seconds. */
export function autoBroll(spec: EditSpec, assets: BrollAsset[], per30: number): { spec: EditSpec; added: number } {
  const usable = assets.filter((a) => a.type !== 'audio');
  if (!usable.length || per30 <= 0) return { spec, added: 0 };
  const tokens = usable.map((a) => ({ a, keys: a.id.toLowerCase().split(/[^a-z0-9]+/).filter((k) => k.length > 2) }));
  const gap = 30 / per30;
  const added: Graphic[] = [];
  let last = spec.in + 2 - gap;
  const used = new Set<string>();
  for (const w of spec.words) {
    if (w.removed || w.start - last < gap || w.start > spec.out - 2) continue;
    const key = bare(w.text);
    if (key.length < 3) continue;
    const hit = tokens.find((t) => !used.has(t.a.url) && t.keys.some((k) => k === key || (key.length > 4 && (k.startsWith(key) || key.startsWith(k)))));
    if (!hit) continue;
    used.add(hit.a.url);
    added.push({ ...newGraphic('broll', w.start), duration: 2.4, src: hit.a.url, mediaType: hit.a.type as Graphic['mediaType'], zone: 'top' });
    last = w.start;
  }
  const manual = spec.graphics.filter((g) => !(g.type === 'broll' && added.some((x) => x.src === g.src)));
  return { spec: { ...spec, graphics: [...manual, ...added].sort((a, b) => a.at - b.at) }, added: added.length };
}

/* ---------- format ---------- */
export function aspectOf(spec: ShortSpec): Aspect {
  const hit = (Object.keys(ASPECTS) as Aspect[]).find((k) => ASPECTS[k].width === spec.width && ASPECTS[k].height === spec.height);
  return hit ?? '9:16';
}

export function setAspect(spec: EditSpec, aspect: Aspect): EditSpec {
  const { width, height } = ASPECTS[aspect];
  const next = { ...spec, width, height };
  // crop positions depend on the pane shape, so re-centre shots that have a known face
  return {
    ...next,
    shots: next.shots.map((s) => {
      if (!s.faces?.length || s.track) return s;
      const n = paneCount(s.layout);
      if (s.faces.length < n) return s;
      return { ...s, x: [...s.faces.slice(0, n)].sort((a, b) => a.cx - b.cx).map((f) => faceToX(f.cx, next, s.layout)) };
    }),
  };
}

/** Caption lines as the composition groups them, for translation. */
export { captionPages } from '../remotion/timing';
