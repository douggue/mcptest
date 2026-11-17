import { useRef } from 'react';

import { Piece, graphicFrames, outFrameOf } from '../remotion/timing';
import { fmtTime } from '../ui';
import { EditSpec, clamp } from './logic';

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];

/** Output-time timeline: ruler, camera shots, motion graphics (drag to move), zooms and the playhead. */
export function Timeline({ spec, plan, frames, frame, selected, onSeek, onSelect, onMove }: {
  spec: EditSpec; plan: Piece[]; frames: number; frame: number; selected: string | null;
  onSeek: (frame: number) => void; onSelect: (id: string | null) => void; onMove: (id: string, frame: number, done: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pct = (f: number) => `${(clamp(f, 0, frames) / frames) * 100}%`;
  const width = () => track.current!.getBoundingClientRect().width;
  const frameAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(clamp((clientX - r.left) / r.width, 0, 1) * (frames - 1));
  };

  function scrub(e: React.PointerEvent) {
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
    const w = width();
    let moved = false;
    const at = (ev: PointerEvent) => Math.round(clamp(from + ((ev.clientX - startX) / w) * frames, 0, frames - 1));
    const move = (ev: PointerEvent) => { if (Math.abs(ev.clientX - startX) > 3) { moved = true; onMove(id, at(ev), false); } };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) onMove(id, at(ev), true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const seconds = frames / spec.fps;
  const step = STEPS.find((s) => seconds / s <= 10) ?? 300;
  const ticks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step);

  return (
    <div className="timeline">
      <span className="tl-lab" />
      <div className="tl-ruler" ref={track} onPointerDown={scrub} title="Drag to scrub">
        {ticks.map((t) => (
          <span key={t} className="tl-tick" style={{ left: `${(t / seconds) * 100}%` }}>{fmtTime(t, step < 1)}</span>
        ))}
      </div>

      <span className="tl-lab">Video</span>
      <div className="tl-row video" onPointerDown={scrub}>
        {plan.map((p, i) => {
          const jump = i > 0 && !p.hold && !plan[i - 1].hold && Math.abs(plan[i - 1].srcEnd - p.srcStart) > 0.05;
          return (
            <div key={i} className={'tl-piece' + (p.shot % 2 ? ' alt' : '') + (jump ? ' jump' : '') + (p.hold ? ' hold' : '') + (p.rate !== 1 ? ' speed' : '')} style={{ left: pct(p.from), width: pct(p.frames) }}
              title={p.hold ? 'Frozen frame' : p.rate !== 1 ? `Playing at ${p.rate}×` : jump ? 'A pause or word was cut here' : undefined}>
              {p.hold ? 'Freeze' : p.rate !== 1 ? `${p.rate}×` : (i === 0 || plan[i - 1].shot !== p.shot) && `Shot ${p.shot + 1}`}
            </div>
          );
        })}
      </div>

      <span className="tl-lab">Motion</span>
      <div className="tl-row" onPointerDown={() => onSelect(null)}>
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

      <span className="tl-lab">Zooms</span>
      <div className="tl-row thin">
        {spec.zooms.map((z) => {
          const from = outFrameOf(plan, z.at, spec.fps);
          return <div key={z.id} className="tl-zoom" style={{ left: pct(from), width: pct(z.duration * spec.fps) }} />;
        })}
      </div>

      <div className="tl-overlay"><div className="tl-head" style={{ left: `${frames > 1 ? (frame / (frames - 1)) * 100 : 0}%` }} /></div>
    </div>
  );
}
