import { StyleSteps } from './StyleSteps';
import { Player, PlayerRef } from '@remotion/player';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api';
import { Short } from '../remotion/Short';
import { outFrameOf, srcTimeAt } from '../remotion/timing';
import { Button, Icon, JobBar, SimpleSwitch, fmtTime, toastError, useJobRunner } from '../ui';
import { AskBar } from './AskBar';
import { Picked, StageOverlay } from './StageOverlay';
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
  profileId: string; setProfileId: (id: string) => void;
};

const TOOLS = [
  { id: 'frame', label: 'Framing', icon: 'crop', title: 'Framing and audio' },
  { id: 'style', label: 'Style', icon: 'type', title: 'Captions and look' },
  { id: 'words', label: 'Words', icon: 'scissors', title: 'Transcript' },
  { id: 'motion', label: 'Motion', icon: 'bolt', title: 'Motion graphics' },
  { id: 'post', label: 'Export', icon: 'download', title: 'Post text and export' },
] as const;
type ToolId = (typeof TOOLS)[number]['id'];

export function Editor({ project, clip, onBack }: { project: Project; clip: Clip; onBack: () => void }) {
  const [hist, setHist] = useState<History>(() => ({ past: [], present: withSegments(clip.spec), future: [], key: '', at: 0 }));
  const spec = hist.present;
  const [tab, setTab] = useState<ToolId>('frame');
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(null);   // element selected on the preview
  const [meta, setMeta] = useState<Meta>(clip.meta);
  const [title, setTitle] = useState(clip.title);
  const [status, setStatus] = useState<Clip['status']>(clip.status);
  const [profileId, setProfileId] = useState(clip.profile_id ?? '');
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
  const latest = useRef({ spec, meta, title, status, profile_id: profileId });
  latest.current = { spec, meta, title, status, profile_id: profileId };
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
  }, [spec, meta, title, status, profileId, save]);
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
      else if (e.key === 'Escape') setPicked(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && picked?.startsWith('graphic:')) {
        const id = picked.slice(8);
        update((s) => ({ ...s, graphics: s.graphics.filter((g) => g.id !== id) }));
        setPicked(null); setSelected(null);
      }
      else if (e.key === 'ArrowLeft') seek(frame - (e.shiftKey ? spec.fps : 1));
      else if (e.key === 'ArrowRight') seek(frame + (e.shiftKey ? spec.fps : 1));
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // Changing the frame rate renumbers every frame; keep the playhead at the same moment.
  const lastFps = useRef(spec.fps);
  useEffect(() => {
    if (lastFps.current === spec.fps) return;
    const ratio = spec.fps / lastFps.current;
    lastFps.current = spec.fps;
    const target = Math.round(frame * ratio);
    const id = setTimeout(() => seek(target), 0);   // after the player has taken the new rate
    return () => clearTimeout(id);
  }, [spec.fps]); // eslint-disable-line react-hooks/exhaustive-deps

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
    selected, select: (id) => { setSelected(id); if (id) setTab('motion'); }, meta, setMeta, title, setTitle, status, setStatus, profileId, setProfileId,
  };

  const tool = TOOLS.find((x) => x.id === tab)!;

  function openFor(key: string, focus: boolean) {
    const kind = key.split(':')[0];
    if (kind === 'graphic') { setSelected(key.slice(8)); setTab('motion'); }
    else setTab(kind === 'hook' ? 'frame' : kind === 'captions' && focus ? 'words' : 'style');
    const field = kind === 'hook' ? 'hook-text' : kind === 'watermark' ? 'watermark-text' : kind === 'graphic' ? 'graphic-text' : '';
    setTimeout(() => {
      const el = document.getElementById(kind === 'logo' ? 'brand-kit' : kind === 'captions' ? 'subtitles' : field || 'x');
      if (focus && field) (document.getElementById(field) as HTMLInputElement | null)?.focus();
      else el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
  }

  return (
    <div className="editor">
      <header className="editor-top">
        <Button variant="ghost" small icon="back" onClick={onBack} aria-label="Back to clips" title="Back to clips" />
        <div className="editor-title">
          <h2 className="ellipsis" title={title}>{title}</h2>
          <span className="save-state">{saved ? <><Icon name="check" size={12} /> Saved</> : 'Saving…'}</span>
        </div>
        <AskBar projectId={project.id} clipId={clip.id} spec={spec} update={update} jobs={jobs} undo={undo} />
        <span className="pill mono" title="Change the shape and frame rate under Export">{spec.width}×{spec.height} · {spec.fps} fps</span>
        <Button variant="ghost" small icon="undo" onClick={undo} disabled={!hist.past.length} aria-label="Undo" title="Undo (Ctrl+Z)" />
        <Button variant="ghost" small icon="redo" onClick={redo} disabled={!hist.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" />
        <Button variant="primary" small icon="download" onClick={() => setTab('post')}>Export</Button>
      </header>
      <div className="editor-body">
        <nav className="tool-rail" role="tablist" aria-label="Editor tools">
          {TOOLS.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)} title={x.title}>
              <Icon name={x.icon} size={18} />
              <span>{x.label}</span>
            </button>
          ))}
        </nav>

        <aside className="tool-panel">
          <div className="tool-panel-head row between"><h3>{tool.title}</h3><SimpleSwitch /></div>
          <div className="tool-panel-body">
            <JobBar job={jobs.job} />
            <StyleSteps ctx={ctx} tab={tab} openTool={(id) => setTab(id as ToolId)} />
            {tab === 'frame' && <FramePanel ctx={ctx} />}
            {tab === 'style' && <StylePanel ctx={ctx} />}
            {tab === 'words' && <WordsPanel ctx={ctx} />}
            {tab === 'motion' && <MotionPanel ctx={ctx} />}
            {tab === 'post' && <PostPanel ctx={ctx} />}
          </div>
        </aside>

        <section className="editor-center">
          <div className="stage" ref={stageRef}>
            <div className="stage-frame" style={{ width: stage.w, height: stage.h }}>
              <Player ref={player} component={Short} inputProps={{ spec }} durationInFrames={frames} fps={spec.fps}
                compositionWidth={spec.width} compositionHeight={spec.height} style={{ width: stage.w, height: stage.h }}
                controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} acknowledgeRemotionLicense />
              <StageOverlay spec={spec} update={update} width={stage.w} height={stage.h} playing={playing} onToggle={toggle}
                picked={picked} onPick={(key) => { setPicked(key); if (key?.startsWith('graphic:')) setSelected(key.slice(8)); }} onOpen={openFor} />
            </div>
          </div>
          <div className="deck">
            <div className="transport">
              <span className="time"><b>{fmtTime(frame / spec.fps, true)}</b> / {fmtTime(seconds, true)}</span>
              <div className="transport-keys">
                <Button variant="ghost" small icon="back" aria-label="Previous shot" title="Previous shot" onClick={() => seek([...shotStarts].reverse().find((f) => f < frame - 2) ?? 0)} />
                <Button variant="ghost" small onClick={() => seek(frame - 1)} aria-label="Back one frame" title="Back one frame (←)">−1f</Button>
                <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)"><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
                <Button variant="ghost" small onClick={() => seek(frame + 1)} aria-label="Forward one frame" title="Forward one frame (→)">+1f</Button>
                <Button variant="ghost" small icon="next" aria-label="Next shot" title="Next shot" onClick={() => seek(shotStarts.find((f) => f > frame + 2) ?? frames - 1)} />
              </div>
              <div className="trim" title={`This clip uses ${fmtTime(spec.in, true)} – ${fmtTime(spec.out, true)} of the source video`}>
                <span className="small muted">Start</span>
                <Button small onClick={() => nudge(-1, 0)} title="Start one second earlier">−1s</Button>
                <Button small onClick={() => nudge(1, 0)} title="Start one second later">+1s</Button>
                <span className="small muted">End</span>
                <Button small onClick={() => nudge(0, -1)} title="End one second earlier">−1s</Button>
                <Button small onClick={() => nudge(0, 1)} title="End one second later">+1s</Button>
              </div>
            </div>
            <Timeline spec={spec} plan={plan} frames={frames} frame={frame} selected={selected} onSeek={seek}
              onSelect={(id) => { setSelected(id); if (id) setTab('motion'); }}
              onMove={(id, f, done) => update((s) => ({ ...s, graphics: s.graphics.map((g) => (g.id === id ? { ...g, at: round3(srcTimeAt(plan, f, s.fps)) } : g)) }), done ? '' : 'drag' + id)} />
          </div>
        </section>
      </div>
    </div>
  );
}
