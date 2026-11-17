// Pure editing operations on a ShortSpec. No React, no network.
import { Piece, buildPlan, captionPages as pagesOf, outFrameOf, srcTimeAt, totalFrames } from '../remotion/timing';
import { ASPECTS, Anim, Aspect, Face, Freeze, Graphic, GraphicType, Layout, Segment, ShortSpec, Shot, Speed, Word, Zone } from '../remotion/types';

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
  if (!spec.ranges?.length) return segs.length ? segs : [{ start: tin, end: tout }];
  const kept = intersect(segs, spec.ranges);
  if (kept.length) return kept;
  // everything inside the parts was cut: fall back to the parts themselves, never to the gaps between them
  const parts = intersect([{ start: tin, end: tout }], spec.ranges);
  return parts.length ? parts : [{ start: tin, end: tout }];
}

/** A multi-part clip's parts after its start or end moved: cut to the new span, the first and last part
 *  stretched when the span grew, so dragging a handle outwards adds video as it does on any clip. */
export function moveRanges(ranges: Segment[] | undefined, tin: number, tout: number): Segment[] | undefined {
  if (!ranges?.length) return ranges;
  const out = ranges.map((r) => ({ start: Math.max(r.start, tin), end: Math.min(r.end, tout) })).filter((r) => r.end - r.start > 0.05);
  if (!out.length) return [{ start: round3(tin), end: round3(tout) }];
  if (tin < ranges[0].start) out[0].start = tin;
  if (tout > ranges[ranges.length - 1].end) out[out.length - 1].end = tout;
  return out.map((r) => ({ start: round3(r.start), end: round3(r.end) }));
}

/** The parts of `a` that also lie inside `b` (both sorted, non-overlapping). */
function intersect(a: Segment[], b: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
    if (e - s > 0.08) out.push({ start: round3(s), end: round3(e) });
  }
  return out;
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
    ...spec, in: round3(tin), out: round3(tout), words, shots, ranges: moveRanges(spec.ranges, tin, tout),
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
  // the picture area is the whole frame, or the panel box when the video sits in one
  const panel = spec.frame?.mode === 'panel';
  const bw = panel ? (spec.width * spec.frame!.width) / 100 : spec.width;
  const bh = panel ? Math.min(spec.height, bw / spec.frame!.aspect) : spec.height;
  const landscape = bw > bh;
  const paneAspect = landscape ? bw / n / bh : bw / (bh / n);
  const visible = paneAspect / (spec.srcW / spec.srcH);   // share of the source width a pane shows
  if (visible >= 1) return 50;
  return Math.round(clamp((cx - visible / 2) / (1 - visible), 0, 1) * 1000) / 10;
}

export type AnalysedShot = { start: number; end: number; faces: Face[]; track: { t: number; cx: number }[] };

/** Build the shot list from a picture analysis: one shot per camera cut, centred on whoever is speaking.
 *  With `keepLayouts`, the analysis is for the user's own cuts, so each shot keeps its layout and transition. */
/** True when the people in a shot cannot all be shown in one crop: their faces span more of the picture than a
 *  single crop shows. Only people of a similar size count, so a small figure in the background does not. */
export function peopleDoNotFit(faces: Face[], spec: ShortSpec): boolean {
  // a face found in only a few of the sampled frames is often a false detection (a lamp, a grill), so only steady
  // ones count; older analyses without the count never switch
  const steady = faces.filter((f) => (f.seen ?? 0) >= 0.6);
  const big = steady.filter((f) => f.w >= Math.max(...steady.map((x) => x.w)) * 0.5);
  if (big.length < 2) return false;
  const panel = spec.frame?.mode === 'panel';
  const bw = panel ? (spec.width * spec.frame!.width) / 100 : spec.width;
  const bh = panel ? Math.min(spec.height, bw / spec.frame!.aspect) : spec.height;
  const visible = (bw / bh) / (spec.srcW / spec.srcH);   // share of the source width one crop shows
  if (visible >= 1) return false;
  const left = Math.min(...big.map((f) => f.cx - f.w * 0.6)), right = Math.max(...big.map((f) => f.cx + f.w * 0.6));
  return right - left > visible;
}

export function applyAnalysis(spec: EditSpec, shots: AnalysedShot[], opts: { splitTwo: boolean; follow: boolean; keepLayouts?: boolean; fitWide?: boolean }): EditSpec {
  const sameCuts = !!opts.keepLayouts && shots.length === spec.shots.length;
  const next: Shot[] = shots.map((s, i) => {
    const prev = spec.shots[i];
    const faces = s.faces;
    const similar = faces.length >= 2 && Math.min(faces[0].w, faces[1].w) / Math.max(faces[0].w, faces[1].w) > 0.55;
    const layout: Layout = sameCuts ? prev.layout : opts.splitTwo && similar ? 'split' : opts.fitWide && peopleDoNotFit(faces, spec) ? 'fit' : 'single';
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
  label: 'Text label', nametag: 'Name tag', circle: 'Circle callout', arrow: 'Arrow', spotlight: 'Spotlight', flash: 'Flash', dip: 'Dip to black', heart: 'Heart ending',
  image: 'Image or sticker', blurbox: 'Blur box (hide a face or plate)',
  keyword: 'Keyword pop', cascade: 'Keyword cascade', gauge: 'Radial gauge', counter: 'Number counter',
  lowerthird: 'Lower third', steps: 'Step list', broll: 'B-roll', emoji: 'Emoji burst',
};
export const ZONE_LABELS: Record<Zone, string> = { free: 'Free', full: 'Full', top: 'Top', center: 'Center', bottom: 'Bottom', overlay: 'Overlay' };
export const ANIM_LABELS: Record<Anim, string> = { pop: 'Spring pop', slam: 'Slam', fade: 'Fade', slide: 'Slide up', glitch: 'Glitch flash', type: 'Wipe in', none: 'None (already there)' };
/** Placed anywhere on the frame; no zone, and for the last three no text at all. */
export const FREE_TYPES: GraphicType[] = ['label', 'nametag', 'circle', 'arrow', 'spotlight', 'image', 'blurbox', 'flash', 'dip', 'heart'];
export const isFree = (t: GraphicType) => FREE_TYPES.includes(t);
export const TEXTLESS: GraphicType[] = ['circle', 'arrow', 'spotlight', 'flash', 'dip', 'broll', 'image', 'blurbox'];

export function newGraphic(type: GraphicType, at: number): Graphic {
  if (isFree(type)) {
    const base = { id: uid(), type, zone: 'free' as Zone, at: round3(at), headline: '', keywords: [], animation: 'pop' as Anim, sfx: '' };
    switch (type) {
      case 'label': return { ...base, duration: 2, primary: 'YOUR {TEXT}', style: 'neon', color: '#fade0a', dy: 10 };
      case 'nametag': return { ...base, duration: 2.5, primary: 'HIS SON', color: '#2bf3ee', dy: -22 };
      case 'circle': return { ...base, duration: 1.4, primary: '', color: '#d2050a' };
      case 'arrow': return { ...base, duration: 1.4, primary: '', color: '#e01016', rotate: 0, dx: 18, dy: -6 };
      case 'spotlight': return { ...base, duration: 1, primary: '', animation: 'fade', sfx: '' };
      case 'flash': return { ...base, duration: 0.25, primary: '', color: '#ffffff', animation: 'fade' };
      case 'dip': return { ...base, duration: 0.25, primary: '', animation: 'fade' };
      case 'image': return { ...base, duration: 3, primary: '' };
      case 'blurbox': return { ...base, duration: 3, primary: '', animation: 'fade', ratio: 0.6, style: 'plain' };
      default: return { ...base, duration: 2.2, primary: '', sfx: 'thud' };   // heart
    }
  }
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
  // b-roll, the style's standing elements and anything placed by hand are kept; earlier AI placements are replaced
  const broll = spec.graphics.filter((g) => g.type === 'broll' || g.origin === 'style' || (isFree(g.type) && g.origin !== 'ai'));
  return {
    ...spec,
    hook: keep.hook && spec.hook.text ? spec.hook : { ...spec.hook, text: plan.hook || spec.hook.text, visible: true },
    words: spec.words.map((w) => ({ ...w, emphasis: emph.has(w.id), emoji: emoji.get(w.id) })),
    zooms: plan.zooms.filter((z) => at.has(z.word_id)).map((z) => ({ id: uid(), at: round3(Math.max(spec.in, at.get(z.word_id)! - 0.1)), duration: clamp(z.seconds, 0.6, 3), scale: 1.14 })),
    graphics: [...broll, ...plan.graphics.filter((g) => at.has(g.word_id)).map((g) => ({
      id: uid(), type: g.type, zone: g.zone, at: round3(at.get(g.word_id)!), duration: clamp(g.seconds, 1, 6),
      animation: g.animation, sfx: g.sfx, primary: g.primary, headline: g.headline, keywords: g.keywords, origin: 'ai' as const,
    }))].sort((a, b) => a.at - b.at),
  };
}

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

export function shuffleGraphics(spec: EditSpec): EditSpec {
  return {
    ...spec,
    graphics: spec.graphics.map((g) => {
      if (g.type === 'broll' || isFree(g.type)) return g;
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
  return recentre({ ...spec, width, height });
}

/** Crop positions depend on the picture's shape, so after it changes re-centre the shots whose faces are known. */
export function recentre(next: EditSpec): EditSpec {
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

/** The captions as an .srt file timed to the finished short, for uploading alongside the video. */
export function captionsSrt(spec: ShortSpec): string {
  const plan = buildPlan(spec);
  const total = totalFrames(plan);
  const stamp = (frame: number) => {
    const ms = Math.round((frame / spec.fps) * 1000);
    const two = (n: number) => String(n).padStart(2, '0');
    return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`;
  };
  const pages = pagesOf(spec.words, spec.captions.maxWords);
  const out: string[] = [];
  let last = 0;
  pages.forEach((pg, i) => {
    const next = pages[i + 1];
    const from = Math.max(last, outFrameOf(plan, pg.start, spec.fps));
    const to = Math.min(total, outFrameOf(plan, next ? Math.min(next.start, pg.end + 0.5) : pg.end + 0.5, spec.fps));
    if (to <= from) return;
    const text = pg.words.map((w) => w.text.trim()).join(' ');
    out.push(`${out.length + 1}\n${stamp(from)} --> ${stamp(to)}\n${spec.captions.uppercase ? text.toUpperCase() : text}\n`);
    last = to;
  });
  return out.join('\n');
}

/* ---------- freezes and speed ---------- */
export function addFreeze(spec: EditSpec, at: number, duration = 1): EditSpec {
  const t = round3(clamp(at, spec.in, spec.out));
  if ((spec.freezes ?? []).some((f) => Math.abs(f.at - t) < 0.05)) return spec;
  const f: Freeze = { id: uid(), at: t, duration };
  return { ...spec, freezes: [...(spec.freezes ?? []), f].sort((a, b) => a.at - b.at) };
}

export function addSpeed(spec: EditSpec, start: number, length: number, rate: number): EditSpec {
  const s0 = round3(clamp(start, spec.in, spec.out - 0.2));
  const e0 = round3(clamp(start + length, s0 + 0.2, spec.out));
  const others = (spec.speeds ?? []).filter((x) => x.end <= s0 || x.start >= e0);   // a new range replaces what it overlaps
  const sp: Speed = { id: uid(), start: s0, end: e0, rate };
  return { ...spec, speeds: [...others, sp].sort((a, b) => a.start - b.start) };
}

/* ---------- styles ---------- */
import type { DirectPlan, StyleProfile } from './types';

/** Where a point of the source picture (0..1) lands on the frame, as % offsets from the frame centre. */
export function sourceToFrame(spec: EditSpec, t: number, cx: number, cy: number): { dx: number; dy: number; scale: number } {
  const idx = spec.shots.reduce((acc, s, i) => (s.start <= t + 1e-6 ? i : acc), 0);
  const shot = spec.shots[idx];
  if (!shot || shot.layout !== 'single') return { dx: 0, dy: -5, scale: 1 };
  const panel = spec.frame?.mode === 'panel';
  const bw = panel ? (spec.width * spec.frame!.width) / 100 : spec.width;
  const bh = panel ? Math.min(spec.height, bw / spec.frame!.aspect) : spec.height;
  const boxLeft = (spec.width - bw) / 2;
  const boxTop = panel ? clamp((spec.height * spec.frame!.y) / 100 - bh / 2, 0, spec.height - bh) : 0;
  const k = Math.max(bw / spec.srcW, bh / spec.srcH);
  const dw = spec.srcW * k, dh = spec.srcH * k;
  const px = boxLeft - (dw - bw) * ((shot.x[0] ?? 50) / 100) + cx * dw;
  const py = boxTop - (dh - bh) * ((shot.y ?? 50) / 100) + cy * dh;
  return { dx: round3(clamp((px / spec.width - 0.5) * 100, -46, 46)), dy: round3(clamp((py / spec.height - 0.5) * 100, -46, 46)), scale: k };
}

function mainFace(spec: EditSpec, t: number) {
  const idx = spec.shots.reduce((acc, s, i) => (s.start <= t + 1e-6 ? i : acc), 0);
  return spec.shots[idx]?.faces?.[0];
}

const braces = (text: string) => text.replace(/\{([^}|]*)(?:\|#[0-9a-fA-F]{3,8})?\}/g, '$1');

/** Apply a style (built-in or learned): canvas, picture frame, captions, look, brand, and its standing elements. */
export function applyStyle(spec: EditSpec, profile: StyleProfile, seconds: number): EditSpec {
  const st = profile.style ?? {};
  let next: EditSpec = {
    ...spec,
    width: st.width ?? spec.width, height: st.height ?? spec.height, fps: st.fps ?? spec.fps,
    // A style owns the caption timing, the picture frame and the channel header, so whatever the previous style set
    // for them is cleared first; otherwise switching styles would leave the old one's box or header behind.
    captions: { ...spec.captions, lead: undefined, ...(st.captions ?? {}), translations: spec.captions.translations },
    look: { ...spec.look, brightness: 1, contrast: 1, saturation: 1, ...(st.look ?? {}) },
    brand: { ...spec.brand, ...(st.brand ?? {}) },
    frame: st.frame ? { ...st.frame } : undefined,
    header: st.header ? { ...st.header, ...(spec.header ?? {}), y: st.header.y } : undefined,
  };
  if (st.header && !spec.header && spec.brand.watermark) next.header = { ...next.header!, handle: spec.brand.watermark, name: spec.brand.watermark.replace(/^@/, ''), avatar: spec.brand.logo };
  const standing: Graphic[] = [];
  let hookShown = spec.hook.visible;
  for (const el of profile.elements ?? []) {
    const duration = el.duration === 'all' ? Math.max(1, seconds) : el.duration;
    const at = el.at === 'start' ? spec.in : el.at === 'end' ? Math.max(spec.in, spec.out - duration - 0.05) : clamp(spec.in + el.at, spec.in, spec.out);
    const isTitle = el.text === 'title';
    if (isTitle) hookShown = false;   // the standing title replaces the timed hook
    standing.push({
      ...newGraphic(el.type as GraphicType, at), duration, origin: 'style',
      primary: isTitle ? (spec.hook.text || 'YOUR {TITLE}') : el.text, color: el.color, style: el.style as Graphic['style'],
      dx: el.dx ?? 0, dy: el.dy ?? 0, scale: el.scale ?? 1, animation: (el.animation as Anim) ?? 'pop', sfx: '',
    });
  }
  next = { ...next, hook: { ...next.hook, visible: hookShown }, graphics: [...spec.graphics.filter((g) => g.origin !== 'style'), ...standing].sort((a, b) => a.at - b.at) };
  return withSegments(recentre(next));
}

const DY: Record<string, number> = { top: -38, upper: -22, middle: 0, lower: 18, bottom: 32 };

/** Apply a plan made by looking at the clip: story labels, callouts, freezes and speed changes. */
export function applyDirect(spec: EditSpec, plan: DirectPlan): EditSpec {
  const placed: Graphic[] = [];
  for (const e of plan.elements) {
    const type = e.type as GraphicType;
    const at = round3(clamp(spec.in + e.at_seconds, spec.in, spec.out - 0.1));
    const g: Graphic = { ...newGraphic(type, at), duration: e.seconds, origin: 'ai', animation: (e.animation as Anim) || 'pop' };
    if (e.text) g.primary = e.text;
    if (/^#[0-9a-fA-F]{6}$/.test(e.colour)) g.color = e.colour;
    if (type === 'label' && e.label_look) g.style = e.label_look as Graphic['style'];
    if (isFree(type) && !['flash', 'dip'].includes(type)) {
      const face = e.on_subject ? mainFace(spec, at) : undefined;
      if (face) {
        const p = sourceToFrame(spec, at, face.cx, face.cy);
        const faceH = ((face.w * spec.srcW * p.scale) / spec.height) * 100;   // face size as % of frame height
        g.dx = p.dx + (type === 'arrow' ? 16 : 0);
        g.dy = p.dy + (type === 'nametag' ? -faceH * 1.25 : type === 'arrow' ? -faceH * 0.5 : type === 'label' ? faceH * 1.3 : 0);
      } else {
        g.dx = 0;
        g.dy = type === 'label' || type === 'nametag' ? (DY[e.position] ?? 18) : -5;
      }
    }
    placed.push(g);
  }
  const titleEl = spec.graphics.find((g) => g.origin === 'style' && g.type === 'label' && g.duration > (spec.out - spec.in) * 0.6);
  const kept = spec.graphics.filter((g) => g.origin !== 'ai').map((g) => (g === titleEl && plan.title ? { ...g, primary: plan.title } : g));
  return withSegments({
    ...spec,
    hook: titleEl || !plan.title ? spec.hook : { ...spec.hook, text: braces(plan.title).replace(/\n/g, ' '), visible: true },
    graphics: [...kept, ...placed].sort((a, b) => a.at - b.at),
    freezes: plan.freezes.map((f) => ({ id: uid(), at: round3(clamp(spec.in + f.at_seconds, spec.in, spec.out)), duration: f.seconds })),
    speeds: plan.speeds.map((x) => ({ id: uid(), start: round3(clamp(spec.in + x.from_seconds, spec.in, spec.out)), end: round3(clamp(spec.in + x.to_seconds, spec.in, spec.out)), rate: x.rate }))
      .filter((x) => x.end - x.start > 0.2),
  });
}
