import { useRef } from 'react';

import { Piece, graphicFrames, outFrameOf } from '../remotion/timing';
import { EditSpec, clamp } from './logic';

/** Output-time timeline: camera shots, motion graphics (drag to move), zooms and the playhead. */
export function Timeline({ spec, plan, frames, frame, selected, onSeek, onSelect, onMove }: {
  spec: EditSpec; plan: Piece[]; frames: number; frame: number; selected: string | null;
  onSeek: (frame: number) => void; onSelect: (id: string | null) => void; onMove: (id: string, frame: number, done: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = (f: number) => `${(clamp(f, 0, frames) / frames) * 100}%`;
  const frameAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.round(clamp((clientX - r.left - 10) / (r.width - 20), 0, 1) * (frames - 1));
  };

  function scrub(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSeek(frameAt(e.clientX));
    const move = (ev: PointerEvent) => onSeek(frameAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function dragChip(e: React.PointerEvent, id: string, from: number) {
    e.stopPropagation();
    onSelect(id);
    const startX = e.clientX;
    const width = ref.current!.getBoundingClientRect().width - 20;
    let moved = false;
    const at = (ev: PointerEvent) => Math.round(clamp(from + ((ev.clientX - startX) / width) * frames, 0, frames - 1));
    const move = (ev: PointerEvent) => { if (Math.abs(ev.clientX - startX) > 3) { moved = true; onMove(id, at(ev), false); } };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) onMove(id, at(ev), true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className="timeline" ref={ref}>
      <div className="tl-row video" onPointerDown={scrub} title="Drag to scrub">
        {plan.map((p, i) => {
          const jump = i > 0 && Math.abs(plan[i - 1].srcEnd - p.srcStart) > 0.05;
          return (
            <div key={i} className={'tl-piece ' + (p.shot % 2 ? 'b' : 'a')} style={{ left: pct(p.from), width: pct(p.frames), borderLeft: jump ? '2px solid #ff4d4d' : undefined }}
              title={jump ? 'A pause or word was cut here' : undefined}>
              {(i === 0 || plan[i - 1].shot !== p.shot) && `S${p.shot + 1}`}
            </div>
          );
        })}
      </div>
      <div className="tl-row" onPointerDown={() => onSelect(null)}>
        {!spec.graphics.length && <span className="tl-label">Motion</span>}
        {spec.graphics.map((g) => {
          const { from, frames: len } = graphicFrames(plan, g, spec.fps);
          return (
            <div key={g.id} className={`tl-chip ${g.type === 'broll' ? 'broll' : ''} ${selected === g.id ? 'on' : ''}`}
              style={{ left: pct(from), width: pct(len) }} onPointerDown={(e) => dragChip(e, g.id, from)} title="Drag to move">
              {g.type === 'broll' ? 'B-roll' : g.primary || g.keywords[0] || g.type}
            </div>
          );
        })}
      </div>
      <div className="tl-row" style={{ height: 14 }}>
        {!spec.zooms.length && <span className="tl-label" style={{ top: 0 }}>Zooms</span>}
        {spec.zooms.map((z) => {
          const from = outFrameOf(plan, z.at, spec.fps);
          return <div key={z.id} className="tl-zoom" style={{ left: pct(from), width: pct(z.duration * spec.fps), top: 2 }} />;
        })}
      </div>
      <div className="tl-head" style={{ left: `calc(10px + (100% - 20px) * ${frames > 1 ? frame / (frames - 1) : 0})` }} />
    </div>
  );
}
