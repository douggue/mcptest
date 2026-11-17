// The editor's side panels. Each receives the shared editor context.
import { useEffect, useMemo, useRef, useState } from 'react';

import { api, upload } from '../api';
import { captionPages, graphicFrames, shotIndexAt, srcTimeAt } from '../remotion/timing';
import { sourcePoint } from '../remotion/Short';
import { ASPECTS, Anim, Aspect, CaptionPreset, DEFAULT_FRAME, FONTS, FrameMode, Graphic, GraphicType, LabelStyle, Layout, LookPreset, TRANSITIONS, Transition, Zone } from '../remotion/types';
import { Button, Field, Seg, Slider, Toggle, fmtBytes, fmtDur, fmtTime, toast, toastError } from '../ui';
import type { Ctx } from './Editor';
import {
  ANIM_LABELS, AnalysedShot, FREE_TYPES, GRAPHIC_LABELS, TEXTLESS, ZONE_LABELS, addCut, addFreeze, addSpeed, applyAnalysis, applyRemix, aspectOf, autoBroll, autoZooms,
  applyDirect, applyStyle, clamp, faceToX, isFree, newGraphic, outSeconds, paneCount, patchWord, removeFillers, removeShot, restoreWords, round3,
  EditSpec, captionsSrt, setAspect, setLayout, shuffleGraphics, uid, withSegments,
} from './logic';
import { GenerateImageButton } from './GenerateButton';
import { DirectPlan, ExportRow, StyleProfile, Template } from './types';

const Group = ({ title, actions, children, id }: { title: string; actions?: React.ReactNode; children: React.ReactNode; id?: string }) => (
  <div className="group" id={id}>
    <h3><span>{title}</span><span className="row gap-s">{actions}</span></h3>
    {children}
  </div>
);

/* ================================================================ Framing & audio */
export function FramePanel({ ctx }: { ctx: Ctx }) {
  const { spec, update, t, project, clip, jobs, flush, seekSrc, assets } = ctx;
  const [follow, setFollow] = useState(false);
  const [splitTwo, setSplitTwo] = useState(false);
  const [fitWide, setFitWide] = useState(true);
  const [hooks, setHooks] = useState<string[]>([]);
  const [script, setScript] = useState('');
  const idx = shotIndexAt(spec.shots, t);
  const shot = spec.shots[idx];
  const base = `/api/projects/${project.id}/clips/${clip.id}`;

  const patchShot = (patch: Partial<typeof shot>, key = '') =>
    update((s) => ({ ...s, shots: s.shots.map((x, i) => (i === idx ? { ...x, ...patch } : x)) }), key);

  async function analyse(detectCuts: boolean) {
    try {
      await flush();
      const r = await jobs.run<{ engine: string; shots: AnalysedShot[] }>(() =>
        api.post(`${base}/analyse`, { detect_cuts: detectCuts, track: follow, cuts: spec.shots.slice(1).map((s) => s.start) }));
      const found = r.shots.filter((s) => s.faces.length).length;
      update((s) => applyAnalysis(s, r.shots, { splitTwo, follow, fitWide, keepLayouts: !detectCuts }));
      toast(`${r.shots.length} shot${r.shots.length === 1 ? '' : 's'}; speaker found in ${found}`, found ? 'good' : 'info');
    } catch (e) { toastError(e); }
  }

  async function hookIdeas() {
    try {
      await flush();
      const r = await jobs.run<{ hooks: string[]; note: string }>(() => api.post(`${base}/hooks`));
      setHooks(r.hooks);
      if (r.note) toast(r.note);
    } catch (e) { toastError(e); }
  }

  async function cleanAudio() {
    try {
      await flush();
      const r = await jobs.run<{ cleanSrc: string; cleanOffset: number }>(() => api.post(`${base}/clean-audio`));
      update((s) => ({ ...s, audio: { ...s.audio, ...r } }));
      toast('Voice cleaned: noise reduced and loudness evened out', 'good');
    } catch (e) { toastError(e); }
  }

  async function speak() {
    try {
      const r = await jobs.run<{ url: string }>(() => api.post('/api/tts', { text: script }));
      ctx.reloadAssets();
      update((s) => ({ ...s, audio: { ...s.audio, voiceover: { src: r.url, volume: 1, at: 0, muteOriginal: false } } }));
    } catch (e) { toastError(e); }
  }

  const music = spec.audio.music;
  const vo = spec.audio.voiceover;
  const fm = spec.frame ?? DEFAULT_FRAME;
  const setFrame = (patch: Partial<FrameMode>, key = '') => update((s) => ({ ...s, frame: { ...(s.frame ?? DEFAULT_FRAME), ...patch } }), key);

  return (
    <>
      <Group title={`Opening hook (0:00 – ${fmtTime(spec.hook.duration, true)})`}
        actions={<Toggle checked={spec.hook.visible} onChange={(v) => update((s) => ({ ...s, hook: { ...s.hook, visible: v } }))} label="Visible" />}>
        <input id="hook-text" type="text" placeholder="On-screen title for the first seconds" value={spec.hook.text}
          onChange={(e) => update((s) => ({ ...s, hook: { ...s.hook, text: e.target.value } }), 'hook')} />
        <Slider label="Stays for" min={1} max={6} step={0.1} value={spec.hook.duration} format={(v) => `${v.toFixed(1)}s`}
          onChange={(v) => update((s) => ({ ...s, hook: { ...s.hook, duration: v } }), 'hookdur')} />
        <Slider label="Size" min={0.4} max={2.5} step={0.05} value={spec.hook.scale ?? 1} format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update((s) => ({ ...s, hook: { ...s.hook, scale: v } }), 'hookscale')} />
        <div className="row"><Button small icon="sparkle" onClick={hookIdeas} disabled={jobs.busy}>Suggest hooks</Button></div>
        {hooks.length > 0 && (
          <div className="chips">
            {hooks.map((h) => <button key={h} className="chip" onClick={() => update((s) => ({ ...s, hook: { ...s.hook, text: h, visible: true } }))}>{h}</button>)}
          </div>
        )}
      </Group>

      <Group title="Camera" actions={<Button small variant="primary" icon="wand" onClick={() => analyse(true)} disabled={jobs.busy}>Center speaker</Button>}>
        <div className="row wrap">
          <Toggle checked={follow} onChange={setFollow} label="Follow movement" />
          <Toggle checked={splitTwo} onChange={setSplitTwo} label="Split when two faces" />
          <Toggle checked={fitWide} onChange={setFitWide} label="Whole frame when people don't fit" />
        </div>
        <div className="chips">
          {spec.shots.map((s, i) => (
            <button key={i} className={'chip' + (i === idx ? ' on' : '')} onClick={() => seekSrc(s.start + 0.02)}>
              <small>#{i + 1} · {fmtTime(outSeconds(spec, ctx.plan, s.start), true)}</small>
              {s.layout === 'single' ? `${Math.round(s.x[0])}%${s.track ? ' · follow' : ''}` : s.layout}
            </button>
          ))}
        </div>
        <div className="small muted">Shot #{idx + 1} of {spec.shots.length} is at the playhead.</div>
        <Seg small value={shot.layout} onChange={(v: Layout) => update((s) => setLayout(s, idx, v))} options={[
          { value: 'single', label: 'Single' }, { value: 'split', label: 'Split (2)' }, { value: 'trio', label: 'Trio (3)' },
          { value: 'fit', label: 'Fit + blur', title: 'Show the whole frame over a blurred copy' },
        ]} />
        {shot.layout !== 'fit' && shot.x.map((x, n) => (
          <div key={n} className="col gap-s">
            <Slider label={paneCount(shot.layout) > 1 ? `Pane ${n + 1} position` : 'Position'} min={0} max={100} step={0.5} value={x}
              format={(v) => `${Math.round(v)}%`}
              onChange={(v) => patchShot({ x: shot.x.map((o, k) => (k === n ? v : o)), track: n === 0 ? undefined : shot.track }, 'x' + n)} />
            <div className="row gap-s wrap">
              {[['Left', 0], ['Center', 50], ['Right', 100]].map(([label, v]) => (
                <Button key={label} small onClick={() => patchShot({ x: shot.x.map((o, k) => (k === n ? (v as number) : o)), track: n === 0 ? undefined : shot.track })}>{label}</Button>
              ))}
              {(shot.faces ?? []).map((f, k) => (
                <Button key={k} small icon="users" title="Center on this detected face"
                  onClick={() => patchShot({ x: shot.x.map((o, m) => (m === n ? faceToX(f.cx, spec, shot.layout) : o)), track: n === 0 ? undefined : shot.track })}>Face {k + 1}</Button>
              ))}
            </div>
          </div>
        ))}
        {shot.layout !== 'fit' && (
          <Slider label="Height" min={0} max={100} value={shot.y ?? 50} format={(v) => `${Math.round(v)}%`} onChange={(v) => patchShot({ y: v }, 'y')} />
        )}
        <div className="row between wrap">
          <Field label={idx === 0 ? 'Transition (the first shot has none)' : `How shot #${idx + 1} arrives`} grow>
            <select value={shot.transition} disabled={idx === 0} aria-label="Transition" onChange={(e) => patchShot({ transition: e.target.value as Transition })}>
              {TRANSITIONS.map((x) => <option key={x.value} value={x.value} title={x.hint}>{x.label}</option>)}
            </select>
          </Field>
          <div className="row gap-s" style={{ alignSelf: 'flex-end' }}>
            <Button small icon="plus" onClick={() => update((s) => addCut(s, t))}>Cut at {fmtTime(ctx.frame / spec.fps, true)}</Button>
            <Button small variant="danger" icon="trash" disabled={idx === 0} aria-label="Remove this cut" title="Merge with the previous shot" onClick={() => update((s) => removeShot(s, idx))} />
          </div>
        </div>
        {idx > 0 && shot.transition !== 'cut' && shot.transition !== 'smooth' && (
          <Slider label="Transition length" min={0.15} max={1.2} step={0.05} value={shot.tdur ?? 0.4} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => patchShot({ tdur: v }, 'tdur')} />
        )}
        <div className="small muted">{TRANSITIONS.find((x) => x.value === shot.transition)?.hint}. Transitions play where a shot starts; use “Cut at” to add one anywhere.</div>
        <div className="row wrap">
          {spec.shots.length > 1 && idx > 0 && (
            <Button small icon="copy" title="Give every shot this transition and length"
              onClick={() => update((s) => ({ ...s, shots: s.shots.map((x, i) => (i === 0 ? x : { ...x, transition: shot.transition, tdur: shot.tdur })) }))}>Use on every shot</Button>
          )}
          <Button small onClick={() => analyse(false)} disabled={jobs.busy} title="Keep your cuts; find faces again">Re-center on my cuts</Button>
        </div>
      </Group>

      <Group title="Picture frame">
        <Seg small value={fm.mode} onChange={(v) => setFrame({ mode: v })} options={[{ value: 'full', label: 'Fills the frame' }, { value: 'panel', label: 'In a box' }]} />
        {fm.mode === 'panel' && (
          <>
            <div className="grid-2">
              <Field label="Corners">
                <select value={fm.shape} onChange={(e) => setFrame({ shape: e.target.value as FrameMode['shape'], corner: undefined })}>
                  <option value="square">Square</option><option value="rounded">Rounded</option><option value="squircle">Squircle (phone-icon corners)</option>
                </select>
              </Field>
              <Field label="Behind it">
                <select value={fm.bg} onChange={(e) => setFrame({ bg: e.target.value as FrameMode['bg'] })}>
                  <option value="blur">Blurred video</option><option value="black">Black</option>
                </select>
              </Field>
            </div>
            {fm.shape !== 'square' && (
              <Slider label="Corner size" min={0} max={50} step={0.5} value={fm.corner ?? (fm.shape === 'squircle' ? 20.6 : 6)}
                format={(v) => `${v.toFixed(1)}%`} onChange={(v) => setFrame({ corner: v }, 'corner')} />
            )}
            <Slider label="Box width" min={50} max={100} value={fm.width} format={(v) => `${Math.round(v)}%`} onChange={(v) => setFrame({ width: v }, 'fw')} />
            <Slider label="Box shape" min={0.6} max={1.8} step={0.01} value={fm.aspect} format={(v) => (Math.abs(v - 1) < 0.02 ? 'Square' : v < 1 ? 'Tall' : 'Wide')} onChange={(v) => setFrame({ aspect: v }, 'fa')} />
            <Slider label="Box height on screen" min={20} max={80} value={fm.y} format={(v) => `${Math.round(v)}%`} onChange={(v) => setFrame({ y: v }, 'fy')} />
          </>
        )}
      </Group>

      <Group title="Speed and freezes">
        <div className="row wrap">
          <Button small icon="pause" onClick={() => update((s) => addFreeze(s, t, 1))} title="Hold the picture at the playhead">Freeze here</Button>
          <Button small icon="next" onClick={() => update((s) => addSpeed(s, t, 2, 2.5))} title="Speed up the next two seconds">Fast-forward from here</Button>
          <Button small onClick={() => update((s) => addSpeed(s, t, 1.5, 0.6))} title="Slow the next second and a half">Slow motion</Button>
        </div>
        {(spec.freezes ?? []).map((f) => (
          <div key={f.id} className="asset-row">
            <button className="chip" onClick={() => seekSrc(f.at)}><small>Freeze</small>{fmtTime(outSeconds(spec, ctx.plan, f.at), true)}</button>
            <div className="grow"><Slider min={0.3} max={4} step={0.1} value={f.duration} format={(v) => `${v.toFixed(1)}s`} label="Holds for"
              onChange={(v) => update((s) => ({ ...s, freezes: (s.freezes ?? []).map((x) => (x.id === f.id ? { ...x, duration: v } : x)) }), 'fz' + f.id)} /></div>
            <Button small variant="ghost" icon="trash" aria-label="Remove freeze" onClick={() => update((s) => ({ ...s, freezes: (s.freezes ?? []).filter((x) => x.id !== f.id) }))} />
          </div>
        ))}
        {(spec.speeds ?? []).map((sp) => (
          <div key={sp.id} className="asset-row">
            <button className="chip" onClick={() => seekSrc(sp.start)}><small>{sp.rate >= 1 ? 'Fast' : 'Slow'} · {(sp.end - sp.start).toFixed(1)}s of video</small>{fmtTime(outSeconds(spec, ctx.plan, sp.start), true)}</button>
            <div className="grow"><Slider min={0.4} max={4} step={0.1} value={sp.rate} format={(v) => `${v.toFixed(1)}×`} label="Speed"
              onChange={(v) => update((s) => ({ ...s, speeds: (s.speeds ?? []).map((x) => (x.id === sp.id ? { ...x, rate: v } : x)) }), 'sp' + sp.id)} /></div>
            <Button small variant="ghost" icon="trash" aria-label="Remove speed change" onClick={() => update((s) => ({ ...s, speeds: (s.speeds ?? []).filter((x) => x.id !== sp.id) }))} />
          </div>
        ))}
        {!(spec.freezes?.length || spec.speeds?.length) && <span className="small muted">Hold a moment for a callout, skip through dead time, or slow a reveal.</span>}
      </Group>

      <Group title={`Zooms (${spec.zooms.length})`} actions={<>
        <Button small icon="wand" onClick={() => update((s) => autoZooms(s))}>Auto</Button>
        <Button small icon="plus" aria-label="Add zoom at playhead" title="Add at playhead" onClick={() => update((s) => ({ ...s, zooms: [...s.zooms, { id: uid(), at: round3(t), duration: 1.4, scale: 1.14 }].sort((a, b) => a.at - b.at) }))} />
        <Button small variant="ghost" icon="trash" aria-label="Clear zooms" title="Clear all" disabled={!spec.zooms.length} onClick={() => update((s) => ({ ...s, zooms: [] }))} />
      </>}>
        {spec.zooms.length === 0 ? <span className="small muted">Quick punch-ins on emphasised words keep a static shot moving.</span> : (
          <Slider label="Strength (all zooms)" min={1.04} max={1.4} step={0.01} value={spec.zooms[0].scale} format={(v) => `${Math.round((v - 1) * 100)}%`}
            onChange={(v) => update((s) => ({ ...s, zooms: s.zooms.map((z) => ({ ...z, scale: v })) }), 'zoomscale')} />
        )}
      </Group>

      <Group title="Audio mixer">
        <Slider label="Speaker voice" min={0} max={1} step={0.01} value={spec.audio.voice} format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, voice: v } }), 'voice')} />
        <Slider label="Motion sound effects" min={0} max={1} step={0.01} value={spec.audio.fx} format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, fx: v } }), 'fx')} />
        <div className="row between">
          <span className="small">{spec.audio.cleanSrc ? 'Using cleaned voice track' : 'Original audio'}</span>
          {spec.audio.cleanSrc
            ? <Button small onClick={() => update((s) => ({ ...s, audio: { ...s.audio, cleanSrc: undefined, cleanOffset: undefined } }))}>Use original</Button>
            : <Button small icon="wand" onClick={cleanAudio} disabled={jobs.busy}>Clean up voice</Button>}
        </div>
        <Field label="Music">
          <select value={music?.src ?? ''} onChange={(e) => update((s) => ({ ...s, audio: { ...s.audio, music: e.target.value ? { src: e.target.value, volume: music?.volume ?? 0.18, duck: music?.duck ?? true, start: 0 } : null } }))}>
            <option value="">None</option>
            {assets.music.map((a) => <option key={a.url} value={a.url}>{a.label}</option>)}
          </select>
        </Field>
        {!assets.music.length && <span className="small muted">Add tracks under Library → Music.</span>}
        {music && (
          <>
            <Slider label="Music volume" min={0} max={1} step={0.01} value={music.volume} format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, music: { ...music, volume: v } } }), 'music')} />
            <Toggle checked={music.duck} onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, music: { ...music, duck: v } } }))} label="Lower music while someone speaks" />
          </>
        )}
        <Field label="Voiceover">
          <select value={vo?.src ?? ''} onChange={(e) => update((s) => ({ ...s, audio: { ...s.audio, voiceover: e.target.value ? { src: e.target.value, volume: vo?.volume ?? 1, at: vo?.at ?? 0, muteOriginal: vo?.muteOriginal ?? false } : null } }))}>
            <option value="">None</option>
            {assets.voice.map((a) => <option key={a.url} value={a.url}>{a.label}</option>)}
          </select>
        </Field>
        {vo && (
          <>
            <Slider label="Voiceover volume" min={0} max={1} step={0.01} value={vo.volume} format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, voiceover: { ...vo, volume: v } } }), 'vo')} />
            <Slider label="Starts at" min={0} max={Math.max(1, ctx.seconds)} step={0.1} value={vo.at} format={(v) => `${v.toFixed(1)}s`}
              onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, voiceover: { ...vo, at: v } } }), 'voat')} />
            <Toggle checked={vo.muteOriginal} onChange={(v) => update((s) => ({ ...s, audio: { ...s.audio, voiceover: { ...vo, muteOriginal: v } } }))} label="Mute the original voice" />
          </>
        )}
        <Field label="Generate a voiceover from a script" hint="Uses an online voice service; needs internet.">
          <textarea rows={2} placeholder="Type the narration…" value={script} onChange={(e) => setScript(e.target.value)} />
        </Field>
        <div className="row"><Button small icon="speaker" onClick={speak} disabled={!script.trim() || jobs.busy}>Generate</Button></div>
      </Group>
    </>
  );
}

/* ================================================================ Captions, look, brand */
const PRESETS: { id: CaptionPreset; label: string }[] = [
  { id: 'boldpop', label: 'Bold pop' }, { id: 'karaoke', label: 'Karaoke' }, { id: 'tape', label: 'Label tape' },
  { id: 'clean', label: 'Clean' }, { id: 'neon', label: 'Neon glow' }, { id: 'typeon', label: 'Type-on' },
  { id: 'shadow', label: 'Soft shadow' }, { id: 'box', label: 'Black box' }, { id: 'glow', label: 'Colour haze' },
];
const LOOKS: { id: LookPreset; label: string }[] = [
  { id: 'none', label: 'Original' }, { id: 'punchy', label: 'Punchy' }, { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' }, { id: 'cinematic', label: 'Cinematic' }, { id: 'vintage', label: 'Vintage' },
];

export function StylePanel({ ctx }: { ctx: Ctx }) {
  const { spec, update, jobs, flush, project, clip, assets } = ctx;
  const cap = spec.captions;
  const [language, setLanguage] = useState('Spanish');
  const [templates, setTemplates] = useState<Template[]>([]);
  const setCap = (patch: Partial<typeof cap>, key = '') => update((s) => ({ ...s, captions: { ...s.captions, ...patch } }), key);
  const setLook = (patch: Partial<typeof spec.look>) => update((s) => ({ ...s, look: { ...s.look, ...patch } }));
  const setBrand = (patch: Partial<typeof spec.brand>, key = '') => update((s) => ({ ...s, brand: { ...s.brand, ...patch } }), key);
  const loadTemplates = () => api.get<Template[]>('/api/templates').then(setTemplates).catch(() => {});
  const setHeader = (patch: Partial<NonNullable<typeof spec.header>>, key = '') => update((s) => (s.header ? { ...s, header: { ...s.header, ...patch } } : s), key);
  const logoRef = useRef<HTMLInputElement>(null);
  const moved = spec.captions.x !== undefined || spec.hook.x !== undefined || spec.hook.y !== undefined || spec.brand.logoX !== undefined
    || spec.brand.watermarkX !== undefined || spec.brand.watermarkY !== undefined;
  const resetPositions = () => update((s) => ({
    ...s, captions: { ...s.captions, x: undefined }, hook: { ...s.hook, x: undefined, y: undefined },
    brand: { ...s.brand, logoX: undefined, logoY: undefined, watermarkX: undefined, watermarkY: undefined },
  }));

  async function uploadLogo(file: File) {
    try {
      const form = new FormData();
      form.append('file', file);
      const row = await upload<{ url: string }>('/api/assets/brand', form);
      ctx.reloadAssets();
      setBrand({ logo: row.url });
      toast('Logo added; drag it on the video to place it', 'good');
    } catch (e) { toastError(e); }
  }
  useEffect(() => { loadTemplates(); }, []);

  async function translate() {
    try {
      await flush();
      const lines = captionPages(spec.words, Math.max(cap.maxWords, 5)).map((p) => ({ start: p.start, end: p.end + 0.3, text: p.words.map((w) => w.text).join(' ') }));
      const r = await jobs.run<{ lines: { start: number; end: number; text: string }[] }>(() =>
        api.post(`/api/projects/${project.id}/clips/${clip.id}/translate`, { language, lines }));
      setCap({ translations: r.lines, mode: cap.mode === 'original' ? 'bilingual' : cap.mode });
      toast(`Captions translated to ${language}`, 'good');
    } catch (e) { toastError(e); }
  }

  async function saveTemplate() {
    const name = prompt('Name this template (for example the channel or client it is for):');
    if (!name?.trim()) return;
    try {
      await api.post('/api/templates', { name: name.trim(), spec });
      toast('Template saved', 'good');
      loadTemplates();
    } catch (e) { toastError(e); }
  }

  function applyTemplate(id: string) {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    update((s) => ({
      ...s, ...tpl.spec,
      captions: { ...s.captions, ...(tpl.spec.captions ?? {}), translations: s.captions.translations },
      look: { ...s.look, ...(tpl.spec.look ?? {}) }, brand: { ...s.brand, ...(tpl.spec.brand ?? {}) },
    } as typeof s));
    toast(`Applied "${tpl.name}"`, 'good');
  }

  return (
    <>
      <StyleChooser ctx={ctx} />
      <div className="notice" style={{ marginTop: 14 }}>Click the captions, hook title, logo or watermark on the video to select it. Drag to move it, or drag its corner to resize.</div>
      <Group title="Templates" actions={<Button small icon="plus" onClick={saveTemplate}>Save current</Button>}>
        {templates.length ? (
          <select value="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Apply a template">
            <option value="">Apply a saved style…</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : <span className="small muted">Save this clip's captions, look and brand to reuse on other clips.</span>}
      </Group>

      <Group id="subtitles" title="Subtitles" actions={<Toggle checked={cap.visible} onChange={(v) => setCap({ visible: v })} label="Visible" />}>
        <div className="preset-grid">
          {PRESETS.map((p) => <button key={p.id} className={'preset' + (cap.preset === p.id ? ' on' : '')} onClick={() => setCap({ preset: p.id })}>{p.label}</button>)}
        </div>
        <div className="grid-2">
          <Field label="Font">
            <select value={cap.font} onChange={(e) => setCap({ font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
          </Field>
          <Field label="Colours">
            <div className="row">
              <input type="color" value={cap.color} onChange={(e) => setCap({ color: e.target.value }, 'capc')} aria-label="Text colour" title="Text" />
              <input type="color" value={cap.highlight} onChange={(e) => setCap({ highlight: e.target.value }, 'caph')} aria-label="Highlight colour" title="Highlight" />
            </div>
          </Field>
        </div>
        <Slider label="Size" min={44} max={140} value={cap.size} onChange={(v) => setCap({ size: v }, 'capsize')} />
        <Slider label="Vertical position" min={12} max={92} value={cap.position} format={(v) => `${Math.round(v)}%`} onChange={(v) => setCap({ position: v }, 'cappos')} />
        <Slider label="Words per line" min={1} max={7} value={cap.maxWords} onChange={(v) => setCap({ maxWords: v }, 'capwords')} />
        <Slider label="Appears early by" min={0} max={0.3} step={0.01} value={cap.lead ?? 0.04} format={(v) => `${Math.round(v * 1000)} ms`} onChange={(v) => setCap({ lead: v }, 'caplead')} />
        <div className="row wrap">
          <Toggle checked={cap.uppercase} onChange={(v) => setCap({ uppercase: v })} label="Uppercase" />
          <Toggle checked={!!cap.noPunct} onChange={(v) => setCap({ noPunct: v })} label="No full stops or commas" />
          <Toggle checked={cap.emoji} onChange={(v) => setCap({ emoji: v })} label="Emojis" />
        </div>
      </Group>

      <Group title="Translation">
        <div className="row">
          <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language" aria-label="Target language" />
          <Button small icon="sparkle" onClick={translate} disabled={jobs.busy || !language.trim()}>Translate</Button>
        </div>
        {cap.translations.length > 0 ? (
          <Seg small value={cap.mode} onChange={(v) => setCap({ mode: v })} options={[
            { value: 'original', label: 'Original' }, { value: 'translated', label: 'Translated' }, { value: 'bilingual', label: 'Both' }]} />
        ) : <span className="small muted">Needs an AI key. After translating you can show the translation alone or under the original.</span>}
      </Group>

      <Group title="Look">
        <div className="preset-grid">
          {LOOKS.map((l) => <button key={l.id} className={'preset' + (spec.look.preset === l.id ? ' on' : '')} onClick={() => setLook({ preset: l.id })}>{l.label}</button>)}
        </div>
        <div className="row wrap">
          <Toggle checked={spec.look.bw} onChange={(v) => setLook({ bw: v })} label="Black & white" />
          <Toggle checked={spec.look.vignette} onChange={(v) => setLook({ vignette: v })} label="Vignette" />
          <Toggle checked={spec.look.progressBar} onChange={(v) => setLook({ progressBar: v })} label="Progress bar" />
          <Toggle checked={!!spec.look.flip} onChange={(v) => setLook({ flip: v })} label="Mirror" />
        </div>
        <Slider label="Brightness" min={0.7} max={1.4} step={0.01} value={spec.look.brightness ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, brightness: v } }), 'lb')} />
        <Slider label="Contrast" min={0.7} max={1.4} step={0.01} value={spec.look.contrast ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, contrast: v } }), 'lc')} />
        <Slider label="Saturation" min={0} max={1.8} step={0.01} value={spec.look.saturation ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, saturation: v } }), 'ls')} />
        <Slider label="Film grain" min={0} max={1} step={0.05} value={spec.look.grain ?? 0} format={(v) => (v ? `${Math.round(v * 100)}%` : 'Off')} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, grain: v || undefined } }), 'lg')} />
        <Slider label="Cinema bars" min={0} max={18} step={1} value={spec.look.bars ?? 0} format={(v) => (v ? `${v}% top and bottom` : 'Off')} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, bars: v || undefined } }), 'lbars')} />
        <Slider label="Slow push-in" min={0} max={0.25} step={0.01} value={spec.look.drift ?? 0} format={(v) => (v ? `${Math.round(v * 100)}% over each shot` : 'Off')} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, drift: v || undefined } }), 'ldrift')} />
        <div className="grid-2">
          <Slider label="Fade in at the start" min={0} max={2} step={0.1} value={spec.look.fadeIn ?? 0} format={(v) => (v ? `${v.toFixed(1)}s` : 'Off')} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, fadeIn: v || undefined } }), 'lfi')} />
          <Slider label="Fade out at the end" min={0} max={2} step={0.1} value={spec.look.fadeOut ?? 0} format={(v) => (v ? `${v.toFixed(1)}s` : 'Off')} onChange={(v) => update((s) => ({ ...s, look: { ...s.look, fadeOut: v || undefined } }), 'lfo')} />
        </div>
      </Group>

      <Group id="brand-kit" title="Brand kit" actions={moved ? <Button small onClick={resetPositions} title="Put the captions, hook, logo and watermark back in their default places">Reset positions</Button> : null}>
        <div className="grid-2">
          <Field label="Title font">
            <select value={spec.brand.font} onChange={(e) => setBrand({ font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
          </Field>
          <Field label="Colours">
            <div className="row">
              <input type="color" value={spec.brand.accent} onChange={(e) => setBrand({ accent: e.target.value }, 'bra')} aria-label="Accent colour" title="Accent" />
              <input type="color" value={spec.brand.secondary} onChange={(e) => setBrand({ secondary: e.target.value }, 'brs')} aria-label="Text colour" title="Text" />
            </div>
          </Field>
        </div>
        <Field label="Logo">
          <div className="row">
            <select value={spec.brand.logo} onChange={(e) => setBrand({ logo: e.target.value })} aria-label="Logo">
              <option value="">None</option>
              {assets.brand.map((a) => <option key={a.url} value={a.url}>{a.label}</option>)}
            </select>
            <Button small icon="upload" onClick={() => logoRef.current?.click()}>Upload</Button>
            <input ref={logoRef} type="file" accept=".png,.jpg,.jpeg,.webp,.svg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
          </div>
        </Field>
        {spec.brand.logo && (
          <>
            <Field label="Corner">
              <Seg small value={spec.brand.logoX === undefined ? spec.brand.logoPos : ('' as any)} onChange={(v) => setBrand({ logoPos: v, logoX: undefined, logoY: undefined })} options={[
                { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' },
                { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }]} />
            </Field>
            <Slider label="Logo size" min={3} max={60} value={spec.brand.logoSize} format={(v) => `${Math.round(v)}%`} onChange={(v) => setBrand({ logoSize: v }, 'logosize')} />
            <Slider label="Logo opacity" min={0.1} max={1} step={0.05} value={spec.brand.logoOpacity ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setBrand({ logoOpacity: v }, 'logoop')} />
          </>
        )}
        <Field label="Watermark text">
          <input id="watermark-text" type="text" placeholder="@yourchannel" value={spec.brand.watermark} onChange={(e) => setBrand({ watermark: e.target.value }, 'wm')} />
        </Field>
        {spec.brand.watermark && (
          <>
            <Slider label="Watermark size" min={14} max={120} value={spec.brand.watermarkSize ?? 28} onChange={(v) => setBrand({ watermarkSize: v }, 'wmsize')} />
            <Slider label="Watermark opacity" min={0.1} max={1} step={0.05} value={spec.brand.watermarkOpacity ?? 0.62} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setBrand({ watermarkOpacity: v }, 'wmop')} />
          </>
        )}
        <span className="small muted">Defaults for new clips are set under Settings → Brand kit.</span>
      </Group>

      <Group title="Channel header" actions={<Toggle checked={!!spec.header} onChange={(v) => update((s) => ({ ...s, header: v ? { name: s.brand.watermark.replace(/^@/, '') || 'Your channel', handle: s.brand.watermark || '@yourchannel', avatar: s.brand.logo, verified: false, y: 11 } : undefined }))} label="Show" />}>
        {spec.header ? (
          <>
            <div className="grid-2">
              <Field label="Name"><input type="text" value={spec.header.name} onChange={(e) => setHeader({ name: e.target.value }, 'hn')} /></Field>
              <Field label="Handle"><input type="text" value={spec.header.handle} onChange={(e) => setHeader({ handle: e.target.value }, 'hh')} /></Field>
            </div>
            <Field label="Picture">
              <select value={spec.header.avatar} onChange={(e) => setHeader({ avatar: e.target.value })}>
                <option value="">None</option>
                {assets.brand.map((a) => <option key={a.url} value={a.url}>{a.label}</option>)}
              </select>
            </Field>
            <Slider label="Height on screen" min={4} max={40} value={spec.header.y} format={(v) => `${Math.round(v)}%`} onChange={(v) => setHeader({ y: v }, 'hy')} />
            <Toggle checked={spec.header.verified} onChange={(v) => setHeader({ verified: v })} label="Show a tick badge" />
          </>
        ) : <span className="small muted">A profile picture, name and handle above the video, for the boxed layouts.</span>}
      </Group>
    </>
  );
}

/* ================================================================ Styles: apply, plan, teach */
type Change = { path: string[]; label: string; from: string; to: string; value: unknown };

function StyleChooser({ ctx }: { ctx: Ctx }) {
  const { spec, update, jobs, flush, project, clip, profileId, setProfileId, seconds, setMeta, meta } = ctx;
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [note, setNote] = useState('');
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [planNotes, setPlanNotes] = useState<string[]>([]);
  const load = () => api.get<StyleProfile[]>('/api/profiles').then(setStyles).catch(() => {});
  useEffect(() => { load(); }, []);
  const style = styles.find((x) => x.id === profileId);
  const base = `/api/projects/${project.id}/clips/${clip.id}`;

  function choose(id: string) {
    setProfileId(id);
    setChanges(null);
    const st = styles.find((x) => x.id === id);
    if (!st) return;
    update((s) => applyStyle(s, st, seconds));
    toast(`Applied "${st.name}"`, 'good');
  }

  async function plan() {
    if (!style) return;
    try {
      await flush();
      if (style.planner === 'story') {
        const r = await jobs.run<DirectPlan>(() => api.post(`${base}/direct`));
        update((s) => applyDirect(s, r));
        setPlanNotes(r.notes);
        if (r.post_title) setMeta({ title: r.post_title, description: r.description || meta.description, hashtags: r.hashtags.length ? r.hashtags : meta.hashtags });
        toast(`Placed ${r.elements.length} elements${r.freezes.length ? `, ${r.freezes.length} freezes` : ''}; check their positions on the video`, 'good');
      } else {
        const r = await jobs.run<any>(() => api.post(`${base}/remix`, { density: 1 }));
        update((s) => applyRemix(s, r, { hook: true }));
        toast(r.note || `Added ${r.graphics.length} graphics and ${r.zooms.length} zooms`, r.note ? 'info' : 'good');
      }
    } catch (e) { toastError(e); }
  }

  async function duplicate() {
    if (!style) return;
    const name = prompt('Name your copy of this style:', `My ${style.name.toLowerCase()}`);
    if (!name?.trim()) return;
    try {
      const mine = await api.post<StyleProfile>('/api/profiles', { name: name.trim(), from: style.id });
      await load();
      setProfileId(mine.id);
      toast('Copied. Corrections you teach will now be remembered.', 'good');
    } catch (e) { toastError(e); }
  }

  async function teach() {
    if (!style || !note.trim()) return;
    try {
      const updated = await api.post<StyleProfile>(`/api/profiles/${style.id}/feedback`, { note });
      const added = updated.rules[updated.rules.length - 1];
      setNote('');
      load();
      toast(`New rule: ${added.text}`, 'good');
    } catch (e) { toastError(e); }
  }

  async function compare() {
    if (!style) return;
    try {
      const diff = await api.post<Change[]>(`/api/profiles/${style.id}/differences`, { spec });
      setChanges(diff);
      setPicked(new Set(diff.map((d) => d.path.join('.'))));
      if (!diff.length) toast('This clip already matches the style', 'info');
    } catch (e) { toastError(e); }
  }

  async function accept() {
    if (!style || !changes) return;
    try {
      await api.post(`/api/profiles/${style.id}/accept`, { changes: changes.filter((c) => picked.has(c.path.join('.'))) });
      setChanges(null);
      load();
      toast('Saved as this style\'s new defaults', 'good');
    } catch (e) { toastError(e); }
  }

  const mine = styles.filter((x) => !x.builtin);
  const builtin = styles.filter((x) => x.builtin);
  return (
    <Group id="style" title="Style" actions={style ? <Button small variant="primary" icon="sparkle" onClick={plan} disabled={jobs.busy} title={style.planner === 'story' ? 'The AI looks at the clip and places labels, callouts, freezes and speed changes' : 'The AI plans graphics, zooms and emphasis from the transcript'}>Plan the edit</Button> : null}>
      <select value={profileId} onChange={(e) => choose(e.target.value)} aria-label="Style">
        <option value="">No style</option>
        {mine.length > 0 && <optgroup label="Your styles">{mine.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
        <optgroup label="Built-in">{builtin.map((x) => <option key={x.id} value={x.id}>{x.name}{x.draft ? ' (draft)' : ''}</option>)}</optgroup>
      </select>
      {style ? <span className="small muted">{style.summary || style.brief}</span>
        : <span className="small muted">A style sets the shape, captions, colours and standing elements, and gives the AI its rules. Make your own from reference videos under Library → Styles.</span>}
      {planNotes.length > 0 && <div className="notice warn"><b>Check by eye:</b> {planNotes.join(' ')}</div>}
      {style?.builtin && (
        <div className="row between">
          <span className="small muted">Built-in styles are fixed.</span>
          <Button small icon="copy" onClick={duplicate}>Copy to teach it</Button>
        </div>
      )}
      {style && !style.builtin && (
        <>
          <Field label="Teach this style" hint="Say what it got wrong or what you always want. It becomes a rule the AI follows on every future video in this style.">
            <textarea rows={2} value={note} placeholder="e.g. never put a label over someone's face" onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="row wrap">
            <Button small icon="plus" onClick={teach} disabled={!note.trim()}>Add as a rule</Button>
            <Button small onClick={compare} title="Compare this clip's captions, colours and positions with the style">Save my changes to the style</Button>
            <span className="small muted">{style.rules.filter((r) => r.on).length} rules</span>
          </div>
          {changes && changes.length > 0 && (
            <div className="card">
              <span className="small muted">You changed these in this clip. Tick the ones that should become the style's defaults.</span>
              {changes.map((c) => {
                const key = c.path.join('.');
                return (
                  <label key={key} className="row small" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked.has(key)} onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(key) : n.delete(key); return n; })} />
                    <span className="grow">{c.label}</span>
                    <span className="mono muted">{c.from} → {c.to}</span>
                  </label>
                );
              })}
              <div className="row"><Button small variant="primary" onClick={accept} disabled={!picked.size}>Update the style</Button><Button small variant="ghost" onClick={() => setChanges(null)}>Cancel</Button></div>
            </div>
          )}
        </>
      )}
    </Group>
  );
}

/* ================================================================ Transcript editing */
export function WordsPanel({ ctx }: { ctx: Ctx }) {
  const { spec, update, t, seekSrc } = ctx;
  const [sel, setSel] = useState<number | null>(null);
  const word = spec.words.find((w) => w.id === sel) ?? null;
  const silence = spec.edit?.silence ?? 0;
  const removed = spec.words.filter((w) => w.removed).length;
  const saved = spec.out - spec.in - ctx.seconds;

  return (
    <>
      <Group title="Tighten">
        <Toggle checked={silence > 0} onChange={(v) => update((s) => withSegments({ ...s, edit: { silence: v ? 0.5 : 0 } }))} label="Remove silences" />
        {silence > 0 && (
          <Slider label="Cut pauses longer than" min={0.2} max={1.5} step={0.05} value={silence} format={(v) => `${v.toFixed(2)}s`}
            onChange={(v) => update((s) => withSegments({ ...s, edit: { silence: v } }), 'silence')} />
        )}
        <div className="row wrap">
          <Button small icon="scissors" onClick={() => { let n = 0; update((s) => { const r = removeFillers(s); n = r.count; return r.spec; }); setTimeout(() => toast(n ? `Removed ${n} filler word${n === 1 ? '' : 's'}` : 'No filler words found', n ? 'good' : 'info')); }}>Remove filler words</Button>
          <Button small onClick={() => update((s) => restoreWords(s))} disabled={!removed && !silence}>Restore everything</Button>
        </div>
        <div className="small muted">{saved > 0.05 ? `${saved.toFixed(1)}s trimmed · ` : ''}{fmtDur(ctx.seconds)} long · {removed} word{removed === 1 ? '' : 's'} removed</div>
      </Group>

      <Group title="Transcript">
        <span className="small muted">Click a word to jump to it and edit it. Removing a word cuts it from the video.</span>
        {word && (
          <div className="card">
            <div className="row">
              <input type="text" value={word.text} aria-label="Word text" onChange={(e) => update((s) => patchWord(s, word.id, { text: e.target.value }), 'wtext' + word.id)} />
              <input type="text" value={word.emoji ?? ''} placeholder="😀" aria-label="Emoji" style={{ width: 56 }}
                onChange={(e) => update((s) => patchWord(s, word.id, { emoji: e.target.value || undefined }), 'wemoji' + word.id)} />
            </div>
            <div className="row wrap">
              <Button small variant={word.removed ? 'default' : 'danger'} icon={word.removed ? 'undo' : 'trash'}
                onClick={() => update((s) => patchWord(s, word.id, { removed: !word.removed }))}>{word.removed ? 'Restore' : 'Remove'}</Button>
              <Toggle checked={!!word.emphasis} onChange={(v) => update((s) => patchWord(s, word.id, { emphasis: v }))} label="Emphasise" />
              <span className="spacer" />
              <span className="small mono muted">{fmtTime(word.start - spec.in, true)}</span>
            </div>
          </div>
        )}
        <div className="words">
          {spec.words.length === 0 && <span className="small muted">No transcript for this range. Transcribe the project to get captions and text editing.</span>}
          {spec.words.map((w, i) => {
            const prev = spec.words[i - 1];
            const gap = prev ? w.start - prev.end : 0;
            const now = t >= w.start - 0.02 && t < w.end + 0.05;
            return (
              <span key={w.id} style={{ display: 'contents' }}>
                {gap > 0.7 && <span className="word gap" title={`${gap.toFixed(1)}s pause`}>·{gap.toFixed(1)}s·</span>}
                <button className={`word${w.removed ? ' removed' : ''}${w.emphasis ? ' emph' : ''}${now ? ' now' : ''}${sel === w.id ? ' sel' : ''}`}
                  onClick={() => { setSel(w.id); if (!w.removed) seekSrc(w.start + 0.01); }}>
                  {w.emoji ? w.emoji + ' ' : ''}{w.text}
                </button>
              </span>
            );
          })}
        </div>
      </Group>
    </>
  );
}

/** The words spoken around a moment, as a starting prompt for a generated picture. */
function nearbyText(spec: Ctx['spec'], at: number): string {
  return spec.words.filter((w) => !w.removed && w.start >= at - 2 && w.start <= at + 4).map((w) => w.text).join(' ');
}

/* ================================================================ Motion graphics */
export function MotionPanel({ ctx }: { ctx: Ctx }) {
  const { spec, update, t, jobs, flush, project, clip, assets, selected, select, plan } = ctx;
  const [density, setDensity] = useState(1);
  const [per30, setPer30] = useState(2);
  const g = spec.graphics.find((x) => x.id === selected) ?? null;
  const patch = (p: Partial<Graphic>, key = '') => g && update((s) => ({ ...s, graphics: s.graphics.map((x) => (x.id === g.id ? { ...x, ...p } : x)) }), key);
  const media = useMemo(() => assets.broll.filter((a) => a.type !== 'audio'), [assets.broll]);
  const [fitNote, setFitNote] = useState('');
  useEffect(() => setFitNote(''), [selected]);

  /** Fit the selected spotlight to the person or object under it: traced on the server from the source frame. */
  async function fitSpot(find: boolean) {
    if (!g) return;
    // the oval's box on the canvas, turned into 0..1 of the source picture (the mapping is a scale and an offset)
    const [ax, ay] = sourcePoint(spec, g.at, 0, 0), [bx, by] = sourcePoint(spec, g.at, 1, 1);
    const rx = spec.width * 0.0972 * (g.scale ?? 1), ry = rx * (g.ratio ?? 0.881);
    const cx = spec.width / 2 + ((g.dx ?? 0) / 100) * spec.width, cy = spec.height / 2 + ((g.dy ?? 0) / 100) * spec.height;
    const toSrc = (px: number, py: number): [number, number] => [(px - ax) / (bx - ax), (py - ay) / (by - ay)];
    const [x0, y0] = toSrc(cx - rx * 1.15, cy - ry * 1.15), [x1, y1] = toSrc(cx + rx * 1.15, cy + ry * 1.15);
    const box = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)].map((v) => clamp(v, 0, 1));
    try {
      await flush();
      const r = await jobs.run<{ keys: { t: number; pts: [number, number][] }[]; found: string; how: string }>(() =>
        api.post(`/api/projects/${project.id}/clips/${clip.id}/subject`, { t: g.at, box, find }));
      patch({ outline: r.keys, dx: 0, dy: 0, scale: 1 });
      setFitNote(r.found === 'none' ? 'No person found near the spot, so it traced whatever is under the spot.'
        : r.how === 'colour' ? 'No person under the spot, so it outlined the object by its colour.' : '');
    } catch (e) { toastError(e); }
  }

  async function remix() {
    try {
      await flush();
      const r = await jobs.run<any>(() => api.post(`/api/projects/${project.id}/clips/${clip.id}/remix`, { density }));
      update((s) => applyRemix(s, r, { hook: true }));
      toast(r.note || `Added ${r.graphics.length} graphics, ${r.zooms.length} zooms and caption emphasis`, r.note ? 'info' : 'good');
    } catch (e) { toastError(e); }
  }

  function add(type: GraphicType) {
    const ng = newGraphic(type, t);
    update((s) => ({ ...s, graphics: [...s.graphics, ng].sort((a, b) => a.at - b.at) }));
    select(ng.id);
  }

  function testSfx(name: string) {
    if (!name) return;
    const a = new Audio(`${spec.sfxBase}${name}.wav`);
    a.volume = clamp(spec.audio.fx, 0.05, 1);
    a.play().catch(() => {});
  }

  return (
    <>
      <Group title={`Motion (${spec.graphics.length})`} actions={<>
        <Button small icon="shuffle" onClick={() => update((s) => shuffleGraphics(s))} disabled={!spec.graphics.length} title="Randomise placement, animation and sound">Shuffle</Button>
        <Button small variant="danger" icon="trash" aria-label="Clear motion graphics" title="Clear all" disabled={!spec.graphics.length} onClick={() => { update((s) => ({ ...s, graphics: [] })); select(null); }} />
      </>}>
        <Slider label="How busy" min={0.3} max={2} step={0.1} value={density} format={(v) => (v < 0.7 ? 'Sparse' : v > 1.4 ? 'Busy' : 'Balanced')} onChange={setDensity} />
        <div className="row"><Button variant="primary" small icon="sparkle" onClick={remix} disabled={jobs.busy || !spec.words.length}>AI remix</Button>
          <span className="small muted">Plans graphics, zooms, emphasis and emojis.</span></div>
        <div className="chips">
          {spec.graphics.map((x) => (
            <button key={x.id} className={'chip' + (x.id === selected ? ' on' : '')} onClick={() => { select(x.id); ctx.seekSrc(x.at + 0.3); }}>
              <small>{fmtTime(outSeconds(spec, plan, x.at), true)} · {ZONE_LABELS[x.zone]}</small>
              <span className="ellipsis" style={{ maxWidth: 130 }}>{x.type === 'broll' ? 'B-roll' : x.primary || x.keywords[0] || GRAPHIC_LABELS[x.type]}</span>
            </button>
          ))}
        </div>
        <Field label="Add at playhead">
          <select value="" onChange={(e) => e.target.value && add(e.target.value as GraphicType)} aria-label="Add a motion graphic">
            <option value="">Choose a type…</option>
            <optgroup label="Place anywhere">
              {FREE_TYPES.map((k) => <option key={k} value={k}>{GRAPHIC_LABELS[k]}</option>)}
            </optgroup>
            <optgroup label="Animated cards">
              {(Object.keys(GRAPHIC_LABELS) as GraphicType[]).filter((k) => !isFree(k)).map((k) => <option key={k} value={k}>{GRAPHIC_LABELS[k]}</option>)}
            </optgroup>
          </select>
        </Field>
      </Group>

      {g && (
        <Group title="Selected graphic" actions={<>
          <Button small icon="copy" title="Make a copy just after this one" onClick={() => { const copy = { ...g, id: uid(), at: round3(Math.min(spec.out - 0.2, g.at + g.duration)), dx: (g.dx ?? 0) + 3, dy: (g.dy ?? 0) + 3 }; update((s) => ({ ...s, graphics: [...s.graphics, copy].sort((a, b) => a.at - b.at) })); select(copy.id); }}>Duplicate</Button>
          <Button small variant="danger" icon="trash" aria-label="Delete graphic" onClick={() => { update((s) => ({ ...s, graphics: s.graphics.filter((x) => x.id !== g.id) })); select(null); }} />
        </>}>
          <Field label="Type">
            <select value={g.type} onChange={(e) => patch({ type: e.target.value as GraphicType })}>
              {(Object.keys(GRAPHIC_LABELS) as GraphicType[]).map((k) => <option key={k} value={k}>{GRAPHIC_LABELS[k]}</option>)}
            </select>
          </Field>
          {isFree(g.type) ? (
            !['flash', 'dip'].includes(g.type) && <span className="small muted">Drag it on the video to place it; drag its corner to resize.</span>
          ) : (
            <Field label="Placement">
              <Seg small value={g.zone} onChange={(v: Zone) => patch({ zone: v })} options={(Object.keys(ZONE_LABELS) as Zone[]).filter((z) => z !== 'free').map((z) => ({ value: z, label: ZONE_LABELS[z] }))} />
            </Field>
          )}
          {['label', 'nametag', 'circle', 'arrow', 'flash'].includes(g.type) && (
            <div className="row wrap">
              <Field label="Colour"><input type="color" value={g.color ?? '#ffffff'} onChange={(e) => patch({ color: e.target.value }, 'gcol')} /></Field>
              {g.type === 'label' && (
                <Field label="Look" grow>
                  <select value={g.style ?? 'neon'} onChange={(e) => patch({ style: e.target.value as LabelStyle })}>
                    <option value="neon">Neon</option><option value="quoted">In quotes</option><option value="plain">White with shadow</option>
                    <option value="box">Black box</option><option value="outline">Outline only</option><option value="flat">Flat title (pure colours)</option>
                  </select>
                </Field>
              )}
              {g.type === 'arrow' && <div className="grow"><Slider label="Direction" min={-180} max={180} step={5} value={g.rotate ?? 0} format={(v) => `${v}°`} onChange={(v) => patch({ rotate: v }, 'grot')} /></div>}
              {g.type === 'flash' && <div className="grow"><Slider label="Strength" min={0.2} max={1} step={0.05} value={g.scale ?? 0.9} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ scale: v }, 'gstr')} /></div>}
            </div>
          )}
          <div className="grid-3">
            <Field label="Start (s)">
              <input type="number" step={0.1} min={0} value={Number(outSeconds(spec, plan, g.at).toFixed(2))}
                onChange={(e) => patch({ at: round3(srcTimeAt(plan, Math.round(Number(e.target.value) * spec.fps), spec.fps)) }, 'gat')} />
            </Field>
            <Field label="Length (s)">
              <input type="number" step={0.1} min={0.4} max={15} value={g.duration} onChange={(e) => patch({ duration: clamp(Number(e.target.value) || 1, 0.4, 15) }, 'gdur')} />
            </Field>
            <Field label="Animation">
              <select value={g.animation} disabled={['flash', 'dip', 'spotlight', 'heart'].includes(g.type)} onChange={(e) => patch({ animation: e.target.value as Anim })}>
                {(Object.keys(ANIM_LABELS) as Anim[]).map((a) => <option key={a} value={a}>{ANIM_LABELS[a]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Entry sound">
            <div className="row">
              <select value={g.sfx} onChange={(e) => { patch({ sfx: e.target.value }); testSfx(e.target.value); }}>
                <option value="">None</option>
                {assets.sfx.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <Button small icon="speaker" onClick={() => testSfx(g.sfx)} disabled={!g.sfx}>Test</Button>
            </div>
          </Field>
          {g.type !== 'broll' && g.type !== 'flash' && (g.dx || g.dy || (g.scale ?? 1) !== 1) && (
            <div className="row between">
              <span className="small muted">Moved or resized on the video</span>
              <Button small onClick={() => patch({ dx: undefined, dy: undefined, scale: undefined })}>Reset</Button>
            </div>
          )}
          {g.type === 'label' && (
            <>
              <Field label="Text" hint="Put words in {curly brackets} to colour them; the rest stays white. A new line starts a new row.">
                <textarea id="graphic-text" rows={2} value={g.primary} onChange={(e) => patch({ primary: e.target.value }, 'gprim')} />
              </Field>
              {g.style === 'box' && <Field label="Speaker tag (optional)"><input type="text" value={g.tag ?? ''} placeholder="Cyclist:" onChange={(e) => patch({ tag: e.target.value || undefined }, 'gtag')} /></Field>}
            </>
          )}
          {g.type === 'nametag' && <Field label="Text"><input id="graphic-text" type="text" value={g.primary} onChange={(e) => patch({ primary: e.target.value }, 'gprim')} /></Field>}
          {g.type === 'spotlight' && (
            <>
              <Field label="Shape of the light">
                <Seg small value={g.outline?.length ? 'subject' : 'oval'} onChange={(v) => (v === 'oval' ? patch({ outline: undefined }) : fitSpot(false))}
                  options={[{ value: 'oval', label: 'Oval' }, { value: 'subject', label: 'Fit a person or object' }]} />
              </Field>
              <div className="row wrap">
                <Button small icon="users" onClick={() => fitSpot(true)} disabled={jobs.busy} title="Finds the person nearest the spot and lights their outline">Find the person</Button>
                <Button small icon="wand" onClick={() => fitSpot(false)} disabled={jobs.busy} title="Traces the person or object inside the oval">Trace what's under the spot</Button>
              </div>
              <span className="small muted">
                {g.outline?.length
                  ? (fitNote || 'Only the body is lit, as it is in this frame. Put the spotlight on a freeze so it stays on them. To fit again, choose Oval, move it and trace again.')
                  : 'Put the spotlight on a freeze, drag the oval over the person (or object) and press a button.'}
              </span>
              <Slider label={g.outline?.length ? 'Margin around it' : 'Size'} min={0.3} max={4} step={0.05} value={g.scale ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ scale: v }, 'gscale')} />
              {!g.outline?.length && <Slider label="Shape" min={0.4} max={2.5} step={0.02} value={g.ratio ?? 0.881} format={(v) => (v < 0.95 ? 'Wide' : v > 1.05 ? 'Tall' : 'Round')} onChange={(v) => patch({ ratio: v }, 'gratio')} />}
              <Slider label="Darkness around it" min={0.1} max={0.95} step={0.01} value={g.dim ?? 0.68} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ dim: v }, 'gdim')} />
              <Slider label="Edge softness" min={0.02} max={1.2} step={0.02} value={g.soft ?? 0.3} format={(v) => (v < 0.1 ? 'Sharp' : v > 0.7 ? 'Very soft' : `${Math.round(v * 100)}%`)} onChange={(v) => patch({ soft: v }, 'gsoft')} />
              <div className="row"><Button small onClick={() => patch({ scale: undefined, ratio: undefined, dim: undefined, soft: undefined })}>Back to the reference look</Button></div>
            </>
          )}
          {g.type === 'blurbox' && (
            <>
              <Field label="Cover with">
                <Seg small value={g.style === 'box' ? 'box' : 'plain'} onChange={(v) => patch({ style: v as LabelStyle })} options={[{ value: 'plain', label: 'Blur' }, { value: 'box', label: 'Black box' }]} />
              </Field>
              <Slider label="Shape" min={0.2} max={2.5} step={0.05} value={g.ratio ?? 0.6} format={(v) => (v < 0.9 ? 'Wide' : v > 1.1 ? 'Tall' : 'Square')} onChange={(v) => patch({ ratio: v }, 'gratio')} />
              <span className="small muted">The box stays where you put it. If the face or plate moves, add another box later in the clip.</span>
            </>
          )}
          {g.type === 'image' && (
            assets.brand.length + media.filter((a) => a.type !== 'video').length === 0 ? <span className="small muted">Add images under Library → Logos or Library → B-roll first.</span> : (
              <div className="media-grid">
                {[...assets.brand, ...media.filter((a) => a.type !== 'video')].map((a) => (
                  <button key={a.url} className={'media-pick' + (g.src === a.url ? ' on' : '')} onClick={() => patch({ src: a.url, mediaType: 'image' })} title={a.name}>
                    <img src={a.url} alt="" loading="lazy" /><span>{a.label}</span>
                  </button>
                ))}
              </div>
            )
          )}
          {g.type === 'heart' && <Field label="Line under the heart (optional)"><input type="text" value={g.headline} onChange={(e) => patch({ headline: e.target.value }, 'ghead')} /></Field>}
          {!TEXTLESS.includes(g.type) && !isFree(g.type) && (
            <div className="grid-2">
              <Field label={g.type === 'gauge' || g.type === 'counter' ? 'Value' : g.type === 'emoji' ? 'Emoji' : 'Main word'}>
                <input id="graphic-text" type="text" value={g.primary} placeholder="e.g. 3 MONTHS" onChange={(e) => patch({ primary: e.target.value }, 'gprim')} />
              </Field>
              <Field label="Headline"><input type="text" value={g.headline} placeholder="Short supporting line" onChange={(e) => patch({ headline: e.target.value }, 'ghead')} /></Field>
            </div>
          )}
          {(g.type === 'cascade' || g.type === 'steps') && (
            <Field label="Items (comma separated)">
              <input type="text" value={g.keywords.join(', ')} onChange={(e) => patch({ keywords: e.target.value.split(',').map((k) => k.trim()).filter((k, i, all) => k || i === all.length - 1) }, 'gkeys')} />
            </Field>
          )}
          {g.type === 'broll' && (
            <>
              <Field label="Caption chip (optional)"><input type="text" value={g.headline} onChange={(e) => patch({ headline: e.target.value }, 'ghead')} /></Field>
              <div className="row">
                <GenerateImageButton prompt={nearbyText(spec, g.at)} aspect={aspectOf(spec)} onDone={(a) => { ctx.reloadAssets(); patch({ src: a.url, mediaType: a.type as Graphic['mediaType'] }); }} />
                <span className="small muted">Makes a picture for this moment with Google's image model.</span>
              </div>
              {media.length === 0 ? <span className="small muted">Or add images, GIFs or video under Library → B-roll.</span> : (
                <div className="media-grid">
                  {media.map((a) => (
                    <button key={a.url} className={'media-pick' + (g.src === a.url ? ' on' : '')} onClick={() => patch({ src: a.url, mediaType: a.type as Graphic['mediaType'] })} title={a.name}>
                      {a.type === 'video' ? <video src={a.url} muted preload="metadata" /> : <img src={a.url} alt="" loading="lazy" />}
                      <span>{a.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Group>
      )}

      <Group title="Auto b-roll">
        <Slider label="How often" min={0.5} max={6} step={0.5} value={per30} format={(v) => `${v} per 30s`} onChange={setPer30} />
        <div className="row">
          <Button small icon="image" disabled={!media.length} onClick={() => { let n = 0; update((s) => { const r = autoBroll(s, media as any, per30); n = r.added; return r.spec; }); setTimeout(() => toast(n ? `Placed ${n} b-roll clip${n === 1 ? '' : 's'}` : 'No library file names match words in this clip', n ? 'good' : 'info')); }}>Place from library</Button>
        </div>
        <span className="small muted">Matches the names of your library files to spoken words (a file called “coffee.jpg” appears when “coffee” is said).</span>
      </Group>
    </>
  );
}

/* ================================================================ Post text + export */
export function PostPanel({ ctx }: { ctx: Ctx }) {
  const { spec, update, jobs, flush, project, clip, meta, setMeta, title, setTitle, status, setStatus } = ctx;
  const [quality, setQuality] = useState<'1080' | '720'>('1080');
  const [upscale, setUpscale] = useState(false);
  const [splitting, setSplitting] = useState(false);
  async function splitHere() {
    setSplitting(true);
    try {
      await flush();
      const r = await api.post<{ first: { spec: EditSpec }; second: { title: string } }>(`/api/projects/${project.id}/clips/${clip.id}/split`, { t: ctx.t });
      update(() => r.first.spec as EditSpec);
      toast(`Split. The rest is now the clip "${r.second.title}".`, 'good');
    } catch (e) { toastError(e); }
    setSplitting(false);
  }
  type UpState = { available: boolean; gpu: boolean; cpus: number; provider: string; model_downloaded: boolean };
  const [up, setUp] = useState<UpState | null>(null);
  useEffect(() => { api.get<UpState>('/api/upscale/state').then(setUp).catch(() => {}); }, []);
  const lowRes = Math.min(spec.srcW, spec.srcH) < 1080;
  // measured: about 1.2 s a frame for 720p on four CPU cores; a graphics card is many times faster
  const upMinutes = Math.max(1, Math.round((ctx.seconds * spec.fps * (up?.gpu ? 0.15 : 1.2 * 4 / Math.max(1, up?.cpus ?? 4))) / 60));
  const [exportsList, setExports] = useState<ExportRow[]>([]);
  const base = `/api/projects/${project.id}/clips/${clip.id}`;
  const load = () => api.get<ExportRow[]>('/api/exports').then((rows) => setExports(rows.filter((r) => r.clip_id === clip.id))).catch(() => {});
  useEffect(() => { load(); }, [clip.id]);

  async function write() {
    try {
      await flush();
      const r = await jobs.run<{ title: string; description: string; hashtags: string[]; note: string }>(() => api.post(`${base}/meta`));
      setMeta({ title: r.title, description: r.description, hashtags: r.hashtags });
      if (r.note) toast(r.note);
    } catch (e) { toastError(e); }
  }

  async function render() {
    try {
      await flush();
      const row = await jobs.run<ExportRow>(() => api.post(`${base}/render`, { quality, upscale }));
      toast(`Exported ${row.title}${row.copied_to ? ' and copied to your folder' : ''}`, 'good');
      load();
    } catch (e) { toastError(e); }
  }

  // CapCut project: the same timeline as an editable CapCut draft
  type CapcutState = { available: boolean; folder: string; saved: string; direct: boolean; server_edition: boolean };
  type CapcutResult = { where: 'capcut' | 'zip'; name: string; folder: string; file: string; size: number; notes: string[]; tracks: Record<string, number>; seconds: number };
  const [capcut, setCapcut] = useState<CapcutState | null>(null);
  const [capcutResult, setCapcutResult] = useState<CapcutResult | null>(null);
  useEffect(() => { api.get<CapcutState>('/api/capcut/state').then(setCapcut).catch(() => {}); setCapcutResult(null); }, [clip.id]);
  async function toCapcut() {
    try {
      await flush();
      const r = await jobs.run<CapcutResult>(() => api.post('/api/capcut/export', { project_id: project.id, clip_id: clip.id }));
      setCapcutResult(r);
      toast(r.where === 'capcut' ? `Saved to CapCut as "${r.name}"` : 'CapCut project ready to download', 'good');
    } catch (e) { toastError(e); }
  }

  const caption = [meta.title, meta.description, meta.hashtags.join(' ')].filter(Boolean).join('\n\n');

  return (
    <>
      <Group title="Clip">
        <Field label="Name"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Review status">
          <Seg small value={status} onChange={setStatus} options={[{ value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Approved' }, { value: 'posted', label: 'Posted' }]} />
        </Field>
        <div className="row wrap">
          <Button small icon="scissors" disabled={splitting || ctx.t < spec.in + 0.5 || ctx.t > spec.out - 0.5} onClick={splitHere}
            title="This clip keeps the part before the playhead; the rest becomes a new clip right after it">Split into two at {fmtTime(ctx.frame / spec.fps, true)}</Button>
        </div>
      </Group>

      <Group title="Post text" actions={<Button small icon="sparkle" onClick={write} disabled={jobs.busy}>Write it</Button>}>
        <Field label="Title"><input type="text" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
        <Field label="Description"><textarea rows={3} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
        <Field label="Hashtags"><input type="text" value={meta.hashtags.join(' ')} onChange={(e) => setMeta({ ...meta, hashtags: e.target.value.split(/\s+/).filter(Boolean) })} /></Field>
        <div className="row"><Button small icon="copy" onClick={() => navigator.clipboard.writeText(caption).then(() => toast('Copied', 'good'), () => toast('Could not copy', 'bad'))}>Copy all</Button></div>
      </Group>

      <Group title="Export">
        <Field label="Shape">
          <Seg small value={aspectOf(spec)} onChange={(v: Aspect) => update((s) => setAspect(s, v))} options={(Object.keys(ASPECTS) as Aspect[]).map((a) => ({ value: a, label: a }))} />
        </Field>
        <div className="grid-2">
          <Field label="Frame rate">
            <Seg small value={spec.fps} onChange={(v) => update((s) => withSegments({ ...s, fps: v }))} options={[{ value: 30, label: '30 fps' }, { value: 60, label: '60 fps' }]} />
          </Field>
          <Field label="Resolution">
            <Seg small value={quality} onChange={setQuality} options={[{ value: '1080', label: '1080p' }, { value: '720', label: '720p' }]} />
          </Field>
        </div>
        <div className="col gap-s">
          <Toggle checked={upscale} onChange={setUpscale} label={`AI upscale the footage${lowRes ? ' (recommended: the source is ' + Math.min(spec.srcW, spec.srcH) + 'p)' : ''}`} />
          {upscale && (up?.available === false
            ? <span className="small" style={{ color: 'var(--bad)' }}>Needs two packages: <span className="mono">pip install onnx onnxruntime</span>, then restart Cutroom.</span>
            : <span className="small muted">Sharpens low-resolution footage (CCTV, dashcam, old phones) with Real-ESRGAN before the short is made. Slow: roughly {upMinutes} min for this clip on {up?.gpu ? `the graphics card (${up.provider})` : `${up?.cpus ?? 4} processor cores`}.{up && !up.model_downloaded ? ' The first time also downloads a 5 MB model.' : ''}</span>)}
        </div>
        <Button variant="primary" icon="download" onClick={render} disabled={jobs.busy}>Export MP4 ({fmtDur(ctx.seconds)})</Button>
        <Button small icon="download" title="Subtitle file timed to the finished short, for YouTube and other sites that accept one"
          onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([captionsSrt(spec)], { type: 'application/x-subrip' })); a.download = `${(title || 'captions').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.srt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }}>Download captions (.srt)</Button>
        <span className="small muted">Rendering takes roughly two to five times the clip length on a laptop.</span>
      </Group>

      <Group title="Finish in CapCut">
        <span className="small muted">
          Sends this edit to CapCut as a project you can keep editing there: every cut, the framing, captions, titles, music and voice on their own tracks.
          {capcut?.direct ? ' It is saved straight into CapCut on this computer.' : ' You get a zip to unpack into CapCut\'s projects folder.'}
        </span>
        <Button icon="scissors" onClick={toCapcut} disabled={jobs.busy || !capcut?.available}>{capcut?.direct ? 'Send to CapCut' : 'Make CapCut project'}</Button>
        {capcut && !capcut.available && <div className="notice warn">CapCut export is not installed. Run <span className="mono">pip install pycapcut==0.0.4</span> and restart Cutroom.</div>}
        {capcut && capcut.available && !capcut.direct && !capcut.saved && (
          <div className="notice">Tip: save your CapCut projects folder under <a href="#/settings">Settings → Saving</a> so the media links are exact. Without it, CapCut may ask you to relink the media once.</div>
        )}
        {capcutResult && (
          <div className="card col gap-s" style={{ padding: 10 }}>
            {capcutResult.where === 'capcut'
              ? <div className="small"><b>Saved.</b> Open (or restart) CapCut and look for “{capcutResult.name}” under Projects.</div>
              : <div className="col gap-s small">
                  <a className="btn small primary" href={capcutResult.file} download>Download {capcutResult.name}.zip ({fmtBytes(capcutResult.size)})</a>
                  <span>Unzip it into {capcutResult.folder ? <span className="mono">{capcutResult.folder}</span> : 'CapCut\'s projects folder'} so the folder “{capcutResult.name}” sits next to your other projects, then restart CapCut.</span>
                </div>}
            <div className="small muted mono">{Object.entries(capcutResult.tracks).filter(([k]) => k !== 'length').map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
            {capcutResult.notes.length > 0 && <details className="small"><summary>What changes in CapCut ({capcutResult.notes.length})</summary><ul className="notes-list">{capcutResult.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>}
          </div>
        )}
      </Group>

      <Group title={`Exports of this clip (${exportsList.length})`}>
        {exportsList.length === 0 ? <span className="small muted">Nothing exported yet.</span> : exportsList.map((r) => (
          <div key={r.id} className="asset-row">
            {r.cover ? <img className="asset-thumb" src={r.cover} alt="" /> : <div className="asset-thumb" />}
            <div className="grow">
              <div className="ellipsis small">{r.title}</div>
              <div className="small muted mono">{r.width}×{r.height} · {Math.round(r.fps)} fps · {fmtBytes(r.size)}</div>
            </div>
            <a className="btn small" href={r.file} download>Download</a>
          </div>
        ))}
      </Group>
    </>
  );
}
