import { Player, PlayerRef } from '@remotion/player';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api';
import { Short } from '../remotion/Short';
import { outFrameOf, srcTimeAt } from '../remotion/timing';
import { Button, Icon, JobBar, fmtTime, toastError, useJobRunner } from '../ui';
import { Timeline } from './Timeline';
import { EditSpec, clamp, planOf, retime, round3, withSegments } from './logic';
import { FramePanel, MotionPanel, PostPanel, StylePanel, WordsPanel } from './panels';
import { Asset, Clip, Meta, Project } from './types';

type History = { past: EditSpec[]; present: EditSpec; future: EditSpec[]; key: string; at: number };
export type AssetKind = 'music' | 'broll' | 'sfx' | 'brand' | 'voice';

export type Ctx = {
  project: Project; clip: Clip; spec: EditSpec;
  /** Apply an edit. Pass a `key` for continuous controls (sliders, typing) so they undo as one step. */
  update: (fn: (s: EditSpec) => EditSpec, key?: string) => void;
  frame: number; t: number; plan: ReturnType<typeof planOf>['plan']; frames: number; seconds: number;
  seek: (frame: number) => void; seekSrc: (t: number) => void;
  flush: () => Promise<void>;
  jobs: ReturnType<typeof useJobRunner>;
  assets: Record<AssetKind, Asset[]>; reloadAssets: () => void;
  selected: string | null; select: (id: string | null) => void;
  meta: Meta; setMeta: (m: Meta) => void; title: string; setTitle: (t: string) => void;
  status: Clip['status']; setStatus: (s: Clip['status']) => void;
};

const TABS = [
  { id: 'frame', label: 'Framing', icon: 'crop' },
  { id: 'style', label: 'Style', icon: 'type' },
  { id: 'words', label: 'Words', icon: 'scissors' },
  { id: 'post', label: 'Export', icon: 'download' },
] as const;

export function Editor({ project, clip, onBack }: { project: Project; clip: Clip; onBack: () => void }) {
  const [hist, setHist] = useState<History>(() => ({ past: [], present: withSegments(clip.spec), future: [], key: '', at: 0 }));
  const spec = hist.present;
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('frame');
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta>(clip.meta);
  const [title, setTitle] = useState(clip.title);
  const [status, setStatus] = useState<Clip['status']>(clip.status);
  const [saved, setSaved] = useState(true);
  const [assets, setAssets] = useState<Record<AssetKind, Asset[]>>({ music: [], broll: [], sfx: [], brand: [], voice: [] });
  const [stage, setStage] = useState({ w: 270, h: 480 });
  const player = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const jobs = useJobRunner();

  const { plan, frames, seconds } = useMemo(() => planOf(spec), [spec.segments, spec.shots, spec.in, spec.out, spec.fps]);
  const t = srcTimeAt(plan, frame, spec.fps);

  const update = useCallback((fn: (s: EditSpec) => EditSpec, key = '') => {
    setHist((h) => {
      const next = fn(h.present);
      if (next === h.present) return h;
      const now = Date.now();
      const merge = key && key === h.key && now - h.at < 900;
      return { past: merge ? h.past : [...h.past.slice(-80), h.present], present: next, future: [], key, at: now };
    });
  }, []);
  const undo = () => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], key: '', at: 0 } : h));
  const redo = () => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), key: '', at: 0 } : h));

  /* ---- autosave ---- */
  const latest = useRef({ spec, meta, title, status });
  latest.current = { spec, meta, title, status };
  const dirty = useRef(false);
  const first = useRef(true);
  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await api.put(`/api/projects/${project.id}/clips/${clip.id}`, latest.current);
      if (!dirty.current) setSaved(true);
    } catch (e) { dirty.current = true; toastError(e); }
  }, [project.id, clip.id]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    dirty.current = true;
    setSaved(false);
    const id = setTimeout(save, 700);
    return () => clearTimeout(id);
  }, [spec, meta, title, status, save]);
  useEffect(() => () => { save(); }, [save]);
  useEffect(() => {
    // closing the tab inside the autosave delay must not lose the last edit
    const onHide = () => {
      if (!dirty.current) return;
      dirty.current = false;
      fetch(`/api/projects/${project.id}/clips/${clip.id}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(latest.current) }).catch(() => {});
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [project.id, clip.id]);

  /* ---- assets ---- */
  const reloadAssets = useCallback(() => {
    (['music', 'broll', 'sfx', 'brand', 'voice'] as AssetKind[]).forEach((kind) =>
      api.get<Asset[]>(`/api/assets/${kind}`).then((rows) => setAssets((a) => ({ ...a, [kind]: rows }))).catch(() => {}));
  }, []);
  useEffect(reloadAssets, [reloadAssets]);

  /* ---- player ---- */
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('ended', onPause);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('ended', onPause);
    };
  }, []);
  const seek = useCallback((f: number) => { const g = clamp(Math.round(f), 0, frames - 1); player.current?.seekTo(g); setFrame(g); }, [frames]);
  const seekSrc = useCallback((time: number) => seek(outFrameOf(plan, time, spec.fps)), [plan, spec.fps, seek]);
  const toggle = () => { const p = player.current; if (!p) return; if (frame >= frames - 1) p.seekTo(0); p.toggle(); };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min(r.width / spec.width, r.height / spec.height);
      setStage({ w: Math.max(60, Math.floor(spec.width * s)), h: Math.max(60, Math.floor(spec.height * s)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spec.width, spec.height]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') seek(frame - (e.shiftKey ? spec.fps : 1));
      else if (e.key === 'ArrowRight') seek(frame + (e.shiftKey ? spec.fps : 1));
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const allWords = project.transcript?.words ?? [];
  const nudge = (dIn: number, dOut: number) => update((s) => {
    const tin = clamp(round3(s.in + dIn), 0, s.out + dOut - 1);
    const tout = clamp(round3(s.out + dOut), tin + 1, project.source.duration);
    return retime(s, allWords, tin, tout);
  });

  const shotStarts = useMemo(() => spec.shots.map((s) => outFrameOf(plan, s.start, spec.fps)), [spec.shots, plan, spec.fps]);

  const ctx: Ctx = {
    project, clip, spec, update, frame, t, plan, frames, seconds, seek, seekSrc,
    flush: async () => { dirty.current = true; await save(); }, jobs, assets, reloadAssets,
    selected, select: setSelected, meta, setMeta, title, setTitle, status, setStatus,
  };

  return (
    <div className="editor">
      <div className="editor-top">
        <Button variant="ghost" small icon="back" onClick={onBack}>Clips</Button>
        <h2 className="ellipsis" title={title}>{title}</h2>
        <span className="pill muted">{saved ? 'Saved' : 'Saving…'}</span>
        <span className="spacer" />
        <Button variant="ghost" small icon="undo" onClick={undo} disabled={!hist.past.length} aria-label="Undo" title="Undo (Ctrl+Z)" />
        <Button variant="ghost" small icon="redo" onClick={redo} disabled={!hist.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" />
        <span className="pill accent mono">{spec.width}×{spec.height} · {spec.fps} fps</span>
        <Button variant="primary" small icon="download" onClick={() => setTab('post')}>Export</Button>
      </div>
      <div className="editor-body">
        <aside className="editor-side left">
          <div className="tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>
                <Icon name={x.icon} size={14} />{x.label}
              </button>
            ))}
          </div>
          <JobBar job={jobs.job} />
          {tab === 'frame' && <FramePanel ctx={ctx} />}
          {tab === 'style' && <StylePanel ctx={ctx} />}
          {tab === 'words' && <WordsPanel ctx={ctx} />}
          {tab === 'post' && <PostPanel ctx={ctx} />}
        </aside>

        <section className="editor-center">
          <div className="stage" ref={stageRef}>
            <div className="stage-frame" style={{ width: stage.w, height: stage.h }} onClick={toggle}>
              <Player ref={player} component={Short} inputProps={{ spec }} durationInFrames={frames} fps={spec.fps}
                compositionWidth={spec.width} compositionHeight={spec.height} style={{ width: stage.w, height: stage.h }}
                controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} acknowledgeRemotionLicense />
            </div>
          </div>
          <div className="transport">
            <Button small icon="back" aria-label="Previous shot" title="Previous shot" onClick={() => seek([...shotStarts].reverse().find((f) => f < frame - 2) ?? 0)} />
            <Button small onClick={() => seek(frame - 1)} aria-label="Back one frame" title="Back one frame (←)">−1f</Button>
            <Button variant="primary" small icon={playing ? 'pause' : 'play'} onClick={toggle}>{playing ? 'Pause' : 'Play'}</Button>
            <Button small onClick={() => seek(frame + 1)} aria-label="Forward one frame" title="Forward one frame (→)">+1f</Button>
            <Button small icon="next" aria-label="Next shot" title="Next shot" onClick={() => seek(shotStarts.find((f) => f > frame + 2) ?? frames - 1)} />
            <span className="time"><b>{fmtTime(frame / spec.fps, true)}</b> / {fmtTime(seconds, true)}</span>
          </div>
          <div className="transport trim">
            <span className="small muted">Clip range in source <span className="mono">{fmtTime(spec.in, true)} – {fmtTime(spec.out, true)}</span></span>
            <span className="spacer" />
            <span className="small muted">Start</span>
            <Button small onClick={() => nudge(-1, 0)} title="Start one second earlier">−1s</Button>
            <Button small onClick={() => nudge(1, 0)} title="Start one second later">+1s</Button>
            <span className="small muted">End</span>
            <Button small onClick={() => nudge(0, -1)} title="End one second earlier">−1s</Button>
            <Button small onClick={() => nudge(0, 1)} title="End one second later">+1s</Button>
          </div>
          <Timeline spec={spec} plan={plan} frames={frames} frame={frame} selected={selected} onSeek={seek} onSelect={setSelected}
            onMove={(id, f, done) => update((s) => ({ ...s, graphics: s.graphics.map((g) => (g.id === id ? { ...g, at: round3(srcTimeAt(plan, f, s.fps)) } : g)) }), done ? '' : 'drag' + id)} />
        </section>

        <aside className="editor-side right">
          <MotionPanel ctx={ctx} />
        </aside>
      </div>
    </div>
  );
}
