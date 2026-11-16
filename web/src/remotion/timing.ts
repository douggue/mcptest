// Pure timing maths shared by the composition and the editor.
import { Graphic, Segment, ShortSpec, Shot, Word, Zoom } from './types';

/** One uninterrupted run of source video inside the short. */
export type Piece = { srcStart: number; srcEnd: number; from: number; frames: number; shot: number };

export function keptSegments(spec: Pick<ShortSpec, 'segments' | 'in' | 'out'>): Segment[] {
  const segs = (spec.segments?.length ? spec.segments : [{ start: spec.in, end: spec.out }])
    .map((s) => ({ start: Math.max(spec.in, s.start), end: Math.min(spec.out, s.end) }))
    .filter((s) => s.end - s.start > 0.02)
    .sort((a, b) => a.start - b.start);
  return segs.length ? segs : [{ start: spec.in, end: Math.max(spec.out, spec.in + 0.1) }];
}

export function shotIndexAt(shots: Shot[], t: number): number {
  let idx = 0;
  for (let i = 0; i < shots.length; i++) if (shots[i].start <= t + 1e-6) idx = i;
  return idx;
}

/** Split the kept segments wherever the pane layout changes, and place them on the output frame grid. */
export function buildPlan(spec: Pick<ShortSpec, 'segments' | 'in' | 'out' | 'shots' | 'fps'>): Piece[] {
  const { fps } = spec;
  const shots = spec.shots?.length ? spec.shots : [{ start: spec.in, layout: 'single', x: [50], transition: 'cut' } as Shot];
  const raw: { s: number; e: number; shot: number }[] = [];
  for (const seg of keptSegments(spec)) {
    let cursor = seg.start;
    let cur = shotIndexAt(shots, cursor);
    for (let i = cur + 1; i < shots.length && shots[i].start < seg.end; i++) {
      if (shots[i].layout !== shots[cur].layout || shots[i].x.length !== shots[cur].x.length) {
        raw.push({ s: cursor, e: shots[i].start, shot: cur });
        cursor = shots[i].start;
        cur = i;
      }
    }
    raw.push({ s: cursor, e: seg.end, shot: cur });
  }
  const plan: Piece[] = [];
  let outSeconds = 0;
  let from = 0;
  for (const r of raw) {
    const srcStart = Math.round(r.s * fps) / fps;
    outSeconds += r.e - r.s;
    const end = Math.round(outSeconds * fps);
    const frames = end - from;
    if (frames <= 0) continue;
    plan.push({ srcStart, srcEnd: srcStart + frames / fps, from, frames, shot: r.shot });
    from = end;
  }
  return plan;
}

export const totalFrames = (plan: Piece[]) => (plan.length ? plan[plan.length - 1].from + plan[plan.length - 1].frames : 1);

export function pieceAt(plan: Piece[], frame: number): Piece {
  for (let i = plan.length - 1; i >= 0; i--) if (frame >= plan[i].from) return plan[i];
  return plan[0];
}

/** Source time shown at an output frame. */
export function srcTimeAt(plan: Piece[], frame: number, fps: number): number {
  const p = pieceAt(plan, frame);
  return p.srcStart + Math.min(p.frames, Math.max(0, frame - p.from)) / fps;
}

/** Output frame at which a source time appears (the next kept frame if that moment was cut). */
export function outFrameOf(plan: Piece[], t: number, fps: number): number {
  for (const p of plan) {
    if (t < p.srcStart) return p.from;
    if (t < p.srcEnd) return p.from + Math.round((t - p.srcStart) * fps);
  }
  return totalFrames(plan);
}

const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

/** Crop positions (0..100 per pane) at a source time, including tracking and smooth transitions. */
export function paneXAt(shots: Shot[], t: number): number[] {
  if (!shots.length) return [50];
  const i = shotIndexAt(shots, t);
  const shot = shots[i];
  const xs = [...shot.x];
  if (shot.track && shot.track.length) {
    const k = shot.track;
    if (t <= k[0].t) xs[0] = k[0].x;
    else if (t >= k[k.length - 1].t) xs[0] = k[k.length - 1].x;
    else {
      for (let j = 0; j < k.length - 1; j++) {
        if (t >= k[j].t && t <= k[j + 1].t) {
          const p = (t - k[j].t) / Math.max(1e-6, k[j + 1].t - k[j].t);
          xs[0] = k[j].x + (k[j + 1].x - k[j].x) * p;
          break;
        }
      }
    }
  }
  if (shot.transition === 'smooth' && i > 0 && shots[i - 1].layout === shot.layout) {
    const p = ease((t - shot.start) / 0.45);
    if (p < 1) {
      const prev = shots[i - 1].x;
      return xs.map((x, n) => (prev[n] ?? x) + (x - (prev[n] ?? x)) * p);
    }
  }
  return xs;
}

/** Punch-in scale at a source time (1 = none). */
export function zoomAt(zooms: Zoom[], t: number): number {
  let scale = 1;
  for (const z of zooms) {
    if (t < z.at || t > z.at + z.duration) continue;
    const ramp = Math.min(0.18, z.duration / 3);
    const p = Math.min(ease((t - z.at) / ramp), ease((z.at + z.duration - t) / ramp));
    scale = Math.max(scale, 1 + (z.scale - 1) * p);
  }
  return scale;
}

export type Page = { words: Word[]; start: number; end: number };

/** Group spoken words into short caption lines. */
export function captionPages(words: Word[], maxWords: number): Page[] {
  const pages: Page[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) pages.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  const live = words.filter((w) => !w.removed && w.text.trim());
  for (let i = 0; i < live.length; i++) {
    const w = live[i];
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 0.7) flush();
    cur.push(w);
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    const endsSentence = /[.!?]["')]?$/.test(w.text);
    const softBreak = /[,;:]$/.test(w.text) && cur.length >= Math.max(2, maxWords - 1);
    if (cur.length >= maxWords || chars >= 26 || endsSentence || softBreak) flush();
  }
  flush();
  return pages;
}

/** Per output frame, 0..1 "someone is speaking" — used to duck music under speech. */
export function speechEnvelope(plan: Piece[], words: Word[], fps: number): number[] {
  const n = totalFrames(plan);
  const raw = new Array<number>(n).fill(0);
  for (const w of words) {
    if (w.removed) continue;
    const a = Math.max(0, outFrameOf(plan, w.start - 0.15, fps));
    const b = Math.min(n, outFrameOf(plan, w.end + 0.25, fps));
    for (let f = a; f < b; f++) raw[f] = 1;
  }
  const r = Math.max(1, Math.round(fps * 0.2));
  const out = new Array<number>(n).fill(0);
  let sum = 0;
  for (let f = 0; f < n + r; f++) {
    if (f < n) sum += raw[f];
    if (f - 2 * r - 1 >= 0) sum -= raw[f - 2 * r - 1];
    const c = f - r;
    if (c >= 0 && c < n) out[c] = Math.min(1, sum / (2 * r + 1));
  }
  return out;
}

export const graphicFrames = (plan: Piece[], g: Graphic, fps: number) => ({
  from: outFrameOf(plan, g.at, fps),
  frames: Math.max(1, Math.round(g.duration * fps)),
});
