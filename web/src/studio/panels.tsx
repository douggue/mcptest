// The editor's side panels. Each receives the shared editor context.
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import { captionPages, shotIndexAt, srcTimeAt } from '../remotion/timing';
import { ASPECTS, Anim, Aspect, CaptionPreset, FONTS, Graphic, GraphicType, Layout, LookPreset, Zone } from '../remotion/types';
import { Button, Field, Seg, Slider, Toggle, fmtBytes, fmtDur, fmtTime, toast, toastError } from '../ui';
import type { Ctx } from './Editor';
import {
  ANIM_LABELS, AnalysedShot, GRAPHIC_LABELS, ZONE_LABELS, addCut, applyAnalysis, applyRemix, aspectOf, autoBroll, autoZooms,
  clamp, faceToX, newGraphic, outSeconds, paneCount, patchWord, removeFillers, removeShot, restoreWords, round3,
  setAspect, setLayout, shuffleGraphics, uid, withSegments,
} from './logic';
import { ExportRow, Template } from './types';

const Group = ({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) => (
  <div className="group">
    <h3><span>{title}</span><span className="row gap-s">{actions}</span></h3>
    {children}
  </div>
);

/* ================================================================ Framing & audio */
export function FramePanel({ ctx }: { ctx: Ctx }) {
  const { spec, update, t, project, clip, jobs, flush, seekSrc, assets } = ctx;
  const [follow, setFollow] = useState(false);
  const [splitTwo, setSplitTwo] = useState(false);
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
      update((s) => applyAnalysis(s, r.shots, { splitTwo, follow }));
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

  return (
    <>
      <Group title={`Opening hook (0:00 – ${fmtTime(spec.hook.duration, true)})`}
        actions={<Toggle checked={spec.hook.visible} onChange={(v) => update((s) => ({ ...s, hook: { ...s.hook, visible: v } }))} label="Visible" />}>
        <input type="text" placeholder="On-screen title for the first seconds" value={spec.hook.text}
          onChange={(e) => update((s) => ({ ...s, hook: { ...s.hook, text: e.target.value } }), 'hook')} />
        <Slider label="Stays for" min={1} max={6} step={0.1} value={spec.hook.duration} format={(v) => `${v.toFixed(1)}s`}
          onChange={(v) => update((s) => ({ ...s, hook: { ...s.hook, duration: v } }), 'hookdur')} />
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
          <Seg small value={shot.transition} onChange={(v) => patchShot({ transition: v })} options={[{ value: 'cut', label: 'Hard cut' }, { value: 'smooth', label: 'Smooth pan' }]} />
          <div className="row gap-s">
            <Button small icon="plus" onClick={() => update((s) => addCut(s, t))}>Cut at {fmtTime(ctx.frame / spec.fps, true)}</Button>
            <Button small variant="danger" icon="trash" disabled={idx === 0} aria-label="Remove this cut" title="Merge with the previous shot" onClick={() => update((s) => removeShot(s, idx))} />
          </div>
        </div>
        <div className="row"><Button small onClick={() => analyse(false)} disabled={jobs.busy} title="Keep your cuts; find faces again">Re-center on my cuts</Button></div>
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
      <Group title="Templates" actions={<Button small icon="plus" onClick={saveTemplate}>Save current</Button>}>
        {templates.length ? (
          <select value="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Apply a template">
            <option value="">Apply a saved style…</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : <span className="small muted">Save this clip's captions, look and brand to reuse on other clips.</span>}
      </Group>

      <Group title="Subtitles" actions={<Toggle checked={cap.visible} onChange={(v) => setCap({ visible: v })} label="Visible" />}>
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
        <div className="row wrap">
          <Toggle checked={cap.uppercase} onChange={(v) => setCap({ uppercase: v })} label="Uppercase" />
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
        </div>
      </Group>

      <Group title="Brand kit">
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
          <select value={spec.brand.logo} onChange={(e) => setBrand({ logo: e.target.value })}>
            <option value="">None</option>
            {assets.brand.map((a) => <option key={a.url} value={a.url}>{a.label}</option>)}
          </select>
        </Field>
        {spec.brand.logo && (
          <>
            <Seg small value={spec.brand.logoPos} onChange={(v) => setBrand({ logoPos: v })} options={[
              { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' },
              { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }]} />
            <Slider label="Logo size" min={5} max={40} value={spec.brand.logoSize} format={(v) => `${v}%`} onChange={(v) => setBrand({ logoSize: v }, 'logosize')} />
          </>
        )}
        <Field label="Watermark text">
          <input type="text" placeholder="@yourchannel" value={spec.brand.watermark} onChange={(e) => setBrand({ watermark: e.target.value }, 'wm')} />
        </Field>
        <span className="small muted">Defaults for new clips are set under Settings → Brand kit.</span>
      </Group>
    </>
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

/* ================================================================ Motion graphics */
export function MotionPanel({ ctx }: { ctx: Ctx }) {
  const { spec, update, t, jobs, flush, project, clip, assets, selected, select, plan } = ctx;
  const [density, setDensity] = useState(1);
  const [per30, setPer30] = useState(2);
  const g = spec.graphics.find((x) => x.id === selected) ?? null;
  const patch = (p: Partial<Graphic>, key = '') => g && update((s) => ({ ...s, graphics: s.graphics.map((x) => (x.id === g.id ? { ...x, ...p } : x)) }), key);
  const media = useMemo(() => assets.broll.filter((a) => a.type !== 'audio'), [assets.broll]);

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
            {(Object.keys(GRAPHIC_LABELS) as GraphicType[]).map((k) => <option key={k} value={k}>{GRAPHIC_LABELS[k]}</option>)}
          </select>
        </Field>
      </Group>

      {g && (
        <Group title="Selected graphic" actions={<Button small variant="danger" icon="trash" aria-label="Delete graphic" onClick={() => { update((s) => ({ ...s, graphics: s.graphics.filter((x) => x.id !== g.id) })); select(null); }} />}>
          <Field label="Type">
            <select value={g.type} onChange={(e) => patch({ type: e.target.value as GraphicType })}>
              {(Object.keys(GRAPHIC_LABELS) as GraphicType[]).map((k) => <option key={k} value={k}>{GRAPHIC_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="Placement">
            <Seg small value={g.zone} onChange={(v: Zone) => patch({ zone: v })} options={(Object.keys(ZONE_LABELS) as Zone[]).map((z) => ({ value: z, label: ZONE_LABELS[z] }))} />
          </Field>
          <div className="grid-3">
            <Field label="Start (s)">
              <input type="number" step={0.1} min={0} value={Number(outSeconds(spec, plan, g.at).toFixed(2))}
                onChange={(e) => patch({ at: round3(srcTimeAt(plan, Math.round(Number(e.target.value) * spec.fps), spec.fps)) }, 'gat')} />
            </Field>
            <Field label="Length (s)">
              <input type="number" step={0.1} min={0.4} max={15} value={g.duration} onChange={(e) => patch({ duration: clamp(Number(e.target.value) || 1, 0.4, 15) }, 'gdur')} />
            </Field>
            <Field label="Animation">
              <select value={g.animation} onChange={(e) => patch({ animation: e.target.value as Anim })}>
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
          {g.type !== 'broll' && (
            <div className="grid-2">
              <Field label={g.type === 'gauge' || g.type === 'counter' ? 'Value' : g.type === 'emoji' ? 'Emoji' : 'Main word'}>
                <input type="text" value={g.primary} placeholder="e.g. 3 MONTHS" onChange={(e) => patch({ primary: e.target.value }, 'gprim')} />
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
              {media.length === 0 ? <span className="small muted">Add images, GIFs or video under Library → B-roll.</span> : (
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
      const row = await jobs.run<ExportRow>(() => api.post(`${base}/render`, { quality }));
      toast(`Exported ${row.title}${row.copied_to ? ' and copied to your folder' : ''}`, 'good');
      load();
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
        <Button variant="primary" icon="download" onClick={render} disabled={jobs.busy}>Export MP4 ({fmtDur(ctx.seconds)})</Button>
        <span className="small muted">Rendering takes roughly two to five times the clip length on a laptop.</span>
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
