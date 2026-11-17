// Direct manipulation on the preview: click an element to select it, drag to move it, drag the corner to resize it.
// Elements are found by the `data-el` attribute the composition puts on them, so only what is on screen can be picked.
import { useLayoutEffect, useRef, useState } from 'react';

import { EditSpec, clamp } from './logic';

export type Picked = string | null;   // 'captions' | 'hook' | 'logo' | 'watermark' | 'graphic:<id>'
type Box = { x: number; y: number; w: number; h: number };

const LABEL: Record<string, string> = { captions: 'Captions', hook: 'Hook title', logo: 'Logo', watermark: 'Watermark', graphic: 'Graphic' };
const kindOf = (key: string) => key.split(':')[0];
const round1 = (v: number) => Math.round(v * 10) / 10;

/** The area the element's visible content covers, relative to the frame (its wrapper is often full width). */
function tightBox(el: Element, frame: DOMRect): Box | null {
  const leaves = el.childElementCount ? [...el.querySelectorAll('*')].filter((n) => !n.childElementCount) : [el];
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const n of leaves) {
    const q = n.getBoundingClientRect();
    if (q.width < 1 || q.height < 1) continue;
    l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
  }
  if (!isFinite(l)) return null;
  return { x: l - frame.left, y: t - frame.top, w: r - l, h: b - t };
}

export function StageOverlay({ spec, update, width, height, playing, onToggle, picked, onPick, onOpen }: {
  spec: EditSpec; update: (fn: (s: EditSpec) => EditSpec, key?: string) => void; width: number; height: number;
  playing: boolean; onToggle: () => void; picked: Picked; onPick: (key: Picked) => void; onOpen: (key: string, focus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [hover, setHover] = useState<Box | null>(null);
  const [guide, setGuide] = useState(false);
  const dragging = useRef(false);

  const frameEl = () => ref.current!.parentElement!;
  const find = (key: string) => frameEl().querySelector(`[data-el="${key}"]`);

  function hit(clientX: number, clientY: number): { key: string; box: Box } | null {
    const fr = frameEl().getBoundingClientRect();
    const px = clientX - fr.left, py = clientY - fr.top;
    let best: { key: string; box: Box } | null = null;
    for (const el of frameEl().querySelectorAll('[data-el]')) {
      const b = tightBox(el, fr);
      if (!b) continue;
      const m = 6;   // a little slack so thin text is easy to grab
      if (px < b.x - m || px > b.x + b.w + m || py < b.y - m || py > b.y + b.h + m) continue;
      if (!best || b.w * b.h < best.box.w * best.box.h) best = { key: el.getAttribute('data-el')!, box: b };
    }
    return best;
  }

  // keep the selection outline on the element as the frame, the spec or the preview size changes
  useLayoutEffect(() => {
    if (!picked || !ref.current) { if (box) setBox(null); return; }
    const el = find(picked);
    const next = el ? tightBox(el, frameEl().getBoundingClientRect()) : null;
    if (JSON.stringify(next) !== JSON.stringify(box)) setBox(next);
  });

  function apply(key: string, start: Start, dxp: number, dyp: number, ratio: number | null, live: boolean) {
    const k = live ? 'el-' + key : '';
    const kind = kindOf(key);
    const snap = (v: number) => (Math.abs(v - 50) < 1.2 ? 50 : v);
    if (ratio !== null) {
      if (kind === 'captions') update((s) => ({ ...s, captions: { ...s.captions, size: Math.round(clamp(start.size * ratio, 30, 220)) } }), k);
      else if (kind === 'hook') update((s) => ({ ...s, hook: { ...s.hook, scale: Math.round(clamp(start.size * ratio, 0.4, 3) * 100) / 100 } }), k);
      else if (kind === 'logo') update((s) => ({ ...s, brand: { ...s.brand, logoSize: round1(clamp(start.size * ratio, 3, 80)) } }), k);
      else if (kind === 'watermark') update((s) => ({ ...s, brand: { ...s.brand, watermarkSize: Math.round(clamp(start.size * ratio, 12, 160)) } }), k);
      else update((s) => ({ ...s, graphics: s.graphics.map((g) => (`graphic:${g.id}` === key ? { ...g, scale: Math.round(clamp(start.size * ratio, 0.3, 3) * 100) / 100 } : g)) }), k);
      return;
    }
    const x = snap(clamp(start.x + dxp, 4, 96));
    setGuide(live && x === 50 && kind !== 'graphic');
    if (kind === 'captions') update((s) => ({ ...s, captions: { ...s.captions, x: round1(x), position: round1(clamp(start.y + dyp, 4, 96)) } }), k);
    else if (kind === 'hook') update((s) => ({ ...s, hook: { ...s.hook, x: round1(x), y: round1(clamp(start.y + dyp, 0, 92)) } }), k);
    else if (kind === 'logo') update((s) => ({ ...s, brand: { ...s.brand, logoX: round1(x), logoY: round1(clamp(start.y + dyp, 2, 98)) } }), k);
    else if (kind === 'watermark') update((s) => ({ ...s, brand: { ...s.brand, watermarkX: round1(x), watermarkY: round1(clamp(start.y + dyp, 2, 99)) } }), k);
    else {
      const dx = Math.abs(start.x + dxp) < 1.2 ? 0 : start.x + dxp;   // snap back to the zone's own centre
      setGuide(live && dx === 0);
      update((s) => ({ ...s, graphics: s.graphics.map((g) => (`graphic:${g.id}` === key ? { ...g, dx: round1(clamp(dx, -90, 90)), dy: round1(clamp(start.y + dyp, -90, 90)) } : g)) }), k);
    }
  }

  type Start = { x: number; y: number; size: number };
  function startOf(key: string, b: Box): Start {
    const kind = kindOf(key);
    const cx = ((b.x + b.w / 2) / width) * 100, cy = ((b.y + b.h / 2) / height) * 100;
    if (kind === 'captions') return { x: spec.captions.x ?? 50, y: spec.captions.position, size: spec.captions.size };
    if (kind === 'hook') return { x: spec.hook.x ?? 50, y: spec.hook.y ?? 11, size: spec.hook.scale ?? 1 };
    if (kind === 'logo') return { x: spec.brand.logoX ?? cx, y: spec.brand.logoY ?? cy, size: spec.brand.logoSize };
    if (kind === 'watermark') return { x: spec.brand.watermarkX ?? 50, y: spec.brand.watermarkY ?? 97.6, size: spec.brand.watermarkSize ?? 28 };
    const g = spec.graphics.find((q) => `graphic:${q.id}` === key);
    return { x: g?.dx ?? 0, y: g?.dy ?? 0, size: g?.scale ?? 1 };
  }

  function drag(e: React.PointerEvent, key: string, b: Box, resize: boolean) {
    e.preventDefault();
    e.stopPropagation();
    const start = startOf(key, b);
    const sx = e.clientX, sy = e.clientY;
    const fr = frameEl().getBoundingClientRect();
    const cx = fr.left + b.x + b.w / 2, cy = fr.top + b.y + b.h / 2;
    const d0 = Math.max(8, Math.hypot(sx - cx, sy - cy));
    let moved = false;
    const calc = (ev: PointerEvent, live: boolean) => {
      if (resize) apply(key, start, 0, 0, Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0, live);
      else apply(key, start, ((ev.clientX - sx) / width) * 100, ((ev.clientY - sy) / height) * 100, null, live);
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true; dragging.current = true; setHover(null);
      calc(ev, true);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuide(false);
      if (moved) calc(ev, false);
      else if (!resize) onOpen(key, false);
      setTimeout(() => { dragging.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function down(e: React.PointerEvent) {
    if (playing) { onToggle(); return; }
    // the selected element keeps the pointer while it is inside its box, even when something smaller overlaps it
    const fr = frameEl().getBoundingClientRect();
    const px = e.clientX - fr.left, py = e.clientY - fr.top;
    if (picked && box && px >= box.x - 4 && px <= box.x + box.w + 4 && py >= box.y - 4 && py <= box.y + box.h + 4) {
      drag(e, picked, box, false);
      return;
    }
    const h = hit(e.clientX, e.clientY);
    if (!h) { if (picked) onPick(null); else onToggle(); return; }
    onPick(h.key);
    drag(e, h.key, h.box, false);
  }

  const style = (b: Box) => ({ left: b.x - 4, top: b.y - 4, width: b.w + 8, height: b.h + 8 });

  return (
    <div ref={ref} className="stage-overlay" onPointerDown={down}
      onPointerMove={(e) => { if (playing || dragging.current) return; const h = hit(e.clientX, e.clientY); setHover(h && h.key !== picked ? h.box : null); }}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(e) => { const h = hit(e.clientX, e.clientY); if (h) onOpen(h.key, true); }}
      style={{ cursor: hover ? 'pointer' : picked && box ? 'move' : 'default' }}>
      {guide && <i className="guide-v" />}
      {hover && !playing && <div className="el-box hover" style={style(hover)} />}
      {picked && box && !playing && (
        <div className="el-box" style={style(box)}>
          <span className="el-tag">{LABEL[kindOf(picked)]}</span>
          <i className="el-handle" title="Drag to resize" onPointerDown={(e) => drag(e, picked, box, true)} />
        </div>
      )}
    </div>
  );
}
