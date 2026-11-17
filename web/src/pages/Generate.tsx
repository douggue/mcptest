import './generate.css';
import FlowPanel from '../studio/FlowPanel';
import '../studio/studio.css';

import { useState } from 'react';

import { api } from '../api';
import { ASPECTS, GenOptions, ScriptForm, VoiceFields, useGenOptions } from '../studio/ScriptForm';
import { Button, Empty, Field, JobBar, Panel, Seg, fmtBytes, fmtDur, toast, toastError, useJobRunner } from '../ui';

type Row = { name: string; label: string; url: string; size: number; type: 'image' | 'video' | 'gif' | 'audio'; id: string; note?: string; duration?: number };
type Kind = 'image' | 'video' | 'tts';
type Tab = 'image' | 'video' | 'voice' | 'script' | 'flow';
const TABS: { value: Tab; label: string }[] = [
  { value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }, { value: 'voice', label: 'Voice' }, { value: 'script', label: 'From a script' },
  { value: 'flow', label: 'Google Flow' },
];
const SETTING: Record<Kind, 'gen_image_model' | 'gen_video_model' | 'gen_tts_model'> = { image: 'gen_image_model', video: 'gen_video_model', tts: 'gen_tts_model' };

/**
 * Model choice for one kind of generation. Free text, because Google renames and retires models often: the value
 * shown is a default that may need changing, and "Load list" asks Google what this key can really use.
 */
function ModelPicker({ kind, opts, setOpts }: { kind: Kind; opts: GenOptions; setOpts: (o: GenOptions) => void }) {
  const saved = opts.settings[SETTING[kind]];
  const [value, setValue] = useState(saved);
  const [loading, setLoading] = useState(false);
  const listId = `models-${kind}`;
  async function save(id: string) {
    id = id.trim();
    if (!id) { setValue(saved); return; }
    if (id === saved) return;
    try {
      const o = await api.put<GenOptions>('/api/generate/options', { [SETTING[kind]]: id });
      setOpts({ ...opts, settings: o.settings });
    } catch (e) { toastError(e); }
  }
  async function load() {
    setLoading(true);
    try {
      const o = await api.get<GenOptions>('/api/generate/options?live=true');
      setOpts(o);
      toast(`Found ${o.models[kind].length} ${kind === 'tts' ? 'voice' : kind} models${o.note ? '. ' + o.note : ''}`, 'good');
    } catch (e) { toastError(e); }
    setLoading(false);
  }
  return (
    <div className="field" role="group" aria-label="Model">
      <span className="field-label">Model</span>
      <div className="row">
        <input type="text" className="mono" list={listId} value={value} aria-label="Model" spellCheck={false}
          onChange={(e) => { setValue(e.target.value); if (opts.models[kind].some((m) => m.id === e.target.value)) save(e.target.value); }}
          onBlur={(e) => save(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <Button small onClick={load} busy={loading} disabled={!opts.key} title="Ask Google which models your key can use">Load list</Button>
      </div>
      <datalist id={listId}>{opts.models[kind].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
      <span className="field-hint">
        {opts.live ? 'Showing the models Google lists for your key.' : 'This is a default that may need changing: model names change often.'} If a model is refused, press Load list and pick another, or type its name.
      </span>
    </div>
  );
}

function Results({ rows, where }: { rows: Row[]; where: string }) {
  if (!rows.length) return <Empty icon="sparkle" title="Nothing generated yet">Results appear here and are saved to {where}.</Empty>;
  return (
    <div className="gen-results">
      {rows.map((r) => (
        <div key={r.url} className={'gen-item' + (r.type === 'audio' ? ' wide' : '')}>
          {r.type === 'video' ? <video src={r.url} controls preload="metadata" /> : r.type === 'audio' ? <audio src={r.url} controls preload="metadata" /> : <img src={r.url} alt={r.label} loading="lazy" />}
          <div className="ellipsis small" title={r.name}>{r.label}</div>
          <div className="row between small muted">
            <span className="mono">{r.duration ? fmtDur(r.duration) + ' · ' : ''}{fmtBytes(r.size)}</span>
            <a href={r.url} download>Download</a>
          </div>
          {r.note && <div className="small muted">{r.note}</div>}
        </div>
      ))}
    </div>
  );
}

function ImageTab({ opts, setOpts }: { opts: GenOptions; setOpts: (o: GenOptions) => void }) {
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [rows, setRows] = useState<Row[]>([]);
  const { job, run, busy } = useJobRunner();
  async function make() {
    try {
      const row = await run<Row>(() => api.post('/api/generate/image', { prompt: prompt.trim(), aspect }));
      setRows((r) => [row, ...r]);
    } catch (e) { toastError(e); }
  }
  return (
    <div className="gen-grid">
      <Panel title="New image">
        <Field label="Describe the picture" hint="Say what is in it, where, and the mood. Ask for no text in the image.">
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. a paper cup of coffee on a bedside table at night, warm lamp light, shallow focus" />
        </Field>
        <Field label="Shape" hint={aspect === '4:5' ? 'Image models have no 4:5, so this is made 3:4 and cropped when placed.' : undefined}>
          <Seg small value={aspect} onChange={setAspect} options={ASPECTS} />
        </Field>
        <ModelPicker kind="image" opts={opts} setOpts={setOpts} />
        <div className="notice">Each image is billed by Google to your AI Studio account.</div>
        <JobBar job={job} />
        <div className="row"><Button variant="primary" icon="sparkle" onClick={make} busy={busy} disabled={!prompt.trim() || !opts.key}>Generate image</Button></div>
      </Panel>
      <Panel title="Results" actions={<a className="btn small ghost" href="#/library">Library → B-roll</a>}>
        <Results rows={rows} where="Library → B-roll" />
      </Panel>
    </div>
  );
}

function VideoTab({ opts, setOpts }: { opts: GenOptions; setOpts: (o: GenOptions) => void }) {
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [seconds, setSeconds] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const { job, run, busy } = useJobRunner();
  async function make() {
    try {
      const row = await run<Row>(() => api.post('/api/generate/video', { prompt: prompt.trim(), aspect, seconds: seconds ? Number(seconds) : undefined, confirm: true }));
      setRows((r) => [row, ...r]);
    } catch (e) { toastError(e); }
    setAgreed(false);   // every clip is confirmed on its own
  }
  return (
    <div className="gen-grid">
      <Panel title="New clip">
        <Field label="Describe the clip" hint="One shot: the subject, what happens, the camera move and the look.">
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. slow push-in on steam rising from a coffee cup, morning window light" />
        </Field>
        <div className="grid-2">
          <Field label="Shape" hint="Video models make 9:16 or 16:9.">
            <Seg small value={aspect} onChange={setAspect} options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]} />
          </Field>
          <Field label="Length" hint="Clips are short, usually about eight seconds.">
            <select value={seconds} onChange={(e) => setSeconds(e.target.value)}>
              <option value="">Model default</option>
              {[4, 6, 8].map((s) => <option key={s} value={s}>{s} seconds</option>)}
            </select>
          </Field>
        </div>
        <ModelPicker kind="video" opts={opts} setOpts={setOpts} />
        <label className="confirm-row">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I understand this clip is billed by Google per use, costs much more than an image, and can take several minutes.</span>
        </label>
        <JobBar job={job} />
        <div className="row"><Button variant="primary" icon="sparkle" onClick={make} busy={busy} disabled={!prompt.trim() || !agreed || !opts.key}>Generate clip</Button></div>
      </Panel>
      <Panel title="Results" actions={<a className="btn small ghost" href="#/library">Library → B-roll</a>}>
        <Results rows={rows} where="Library → B-roll" />
      </Panel>
    </div>
  );
}

function VoiceTab({ opts, setOpts }: { opts: GenOptions; setOpts: (o: GenOptions) => void }) {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'edge'>('gemini');
  const [voice, setVoice] = useState(opts.settings.gen_tts_voice);
  const [style, setStyle] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const { job, run, busy } = useJobRunner();
  async function make() {
    try {
      const row = await run<Row>(() => api.post('/api/generate/speech', { text, provider, voice: voice.trim(), style: provider === 'gemini' ? style.trim() : '' }));
      setRows((r) => [row, ...r]);
      if (provider === 'gemini' && voice.trim() && voice.trim() !== opts.settings.gen_tts_voice) {
        api.put<GenOptions>('/api/generate/options', { gen_tts_voice: voice.trim() }).then((o) => setOpts({ ...o, models: opts.models, voices: opts.voices, live: opts.live })).catch(() => {});
      }
    } catch (e) { toastError(e); }
  }
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="gen-grid">
      <Panel title="New voiceover">
        <Field label="Narration" hint={words ? `${words} words, roughly ${fmtDur(words / 2.5)} spoken.` : 'Any length; long text is recorded in parts and joined.'}>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or paste what should be said…" />
        </Field>
        <VoiceFields opts={opts} provider={provider} setProvider={setProvider} voice={voice} setVoice={setVoice} />
        {provider === 'gemini' && (
          <>
            <Field label="How to say it (optional)">
              <input type="text" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. warm, unhurried documentary narrator" />
            </Field>
            <ModelPicker kind="tts" opts={opts} setOpts={setOpts} />
          </>
        )}
        <div className="notice">{provider === 'gemini' ? 'Google voices are billed per use to your AI Studio account.' : 'Free voices use Microsoft Edge\'s online service: no key, but they need internet.'}</div>
        <JobBar job={job} />
        <div className="row"><Button variant="primary" icon="speaker" onClick={make} busy={busy} disabled={!text.trim() || (provider === 'gemini' && !opts.key)}>Generate voiceover</Button></div>
      </Panel>
      <Panel title="Results" actions={<a className="btn small ghost" href="#/library">Library → Voiceovers</a>}>
        <Results rows={rows} where="Library → Voiceovers" />
      </Panel>
    </div>
  );
}

export default function Generate() {
  const [tab, setTab] = useState<Tab>('image');
  const { opts, setOpts } = useGenOptions();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Generate</h1>
          <p>Make images, clips and voiceovers with Google's models, or a whole narrated video from a script. Everything is saved to your Library.</p>
        </div>
      </div>
      {opts && !opts.key && (
        <div className="notice warn">Images, clips and Google voices need a Gemini API key. <a href="#/settings">Add one under Settings → AI</a>. The free voices on the Voice tab work without it.</div>
      )}
      <div className="tabs-line" role="tablist">
        {TABS.map((x) => <button key={x.value} role="tab" aria-selected={tab === x.value} className={tab === x.value ? 'on' : ''} onClick={() => setTab(x.value)}>{x.label}</button>)}
      </div>
      {!opts ? <Empty icon="sparkle" title="Loading…" /> : (
        <>
          {tab === 'image' && <ImageTab opts={opts} setOpts={setOpts} />}
          {tab === 'video' && <VideoTab opts={opts} setOpts={setOpts} />}
          {tab === 'voice' && <VoiceTab opts={opts} setOpts={setOpts} />}
          {tab === 'script' && (
            <Panel title="Video from a script" className="narrow-panel">
              <p className="muted">Cutroom writes or takes a script, records the narration, generates a picture for each scene, and joins them into a video. It opens in the editor with captions, ready for music, graphics and export.</p>
              <ScriptForm opts={opts} />
            </Panel>
          )}
          {tab === 'flow' && <FlowPanel />}
        </>
      )}
    </div>
  );
}
