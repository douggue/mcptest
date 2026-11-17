// "Generate from a script": topic or pasted script → narrated video of generated stills → a studio project.
// Used on the Generate page and in the New project dialog.
import { useEffect, useState } from 'react';

import { go } from '../App';
import { api } from '../api';
import { Button, Field, JobBar, Seg, Slider, toast, toastError, useJobRunner } from '../ui';

export type GenOptions = {
  key: boolean; ai: boolean; live: boolean; note: string;
  settings: { gen_image_model: string; gen_tts_model: string; gen_tts_voice: string; gen_music_model: string };
  edge_voice: string; models: Record<'image' | 'video' | 'tts' | 'music', { id: string; label: string }[]>;
  voices: string[]; edge_voices: string[]; aspects: Record<string, [number, number]>;
};

export const ASPECTS = [
  { value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }, { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' }, { value: '3:4', label: '3:4' },
];
const LENGTHS = [
  { value: 30, label: '30 seconds' }, { value: 45, label: '45 seconds' }, { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' }, { value: 300, label: '5 minutes' }, { value: 600, label: '10 minutes' },
];

export function useGenOptions() {
  const [opts, setOpts] = useState<GenOptions | null>(null);
  const reload = () => api.get<GenOptions>('/api/generate/options').then(setOpts).catch(toastError);
  useEffect(() => { reload(); }, []);
  return { opts, setOpts, reload };
}

/** Voice choice shared by the Voice tab and the script form. */
export function VoiceFields({ opts, provider, setProvider, voice, setVoice }: {
  opts: GenOptions; provider: 'gemini' | 'edge'; setProvider: (p: 'gemini' | 'edge') => void; voice: string; setVoice: (v: string) => void;
}) {
  const list = provider === 'gemini' ? opts.voices : opts.edge_voices;
  const listId = `voices-${provider}`;
  return (
    <div className="grid-2">
      <Field label="Voice service">
        <Seg small value={provider} onChange={(p) => { setProvider(p); setVoice(p === 'gemini' ? opts.settings.gen_tts_voice : opts.edge_voice); }} options={[
          { value: 'gemini', label: 'Google voices', title: 'Billed by Google per use; needs the Gemini key' },
          { value: 'edge', label: 'Free voices', title: 'Microsoft Edge online voices; no key, needs internet' },
        ]} />
      </Field>
      <Field label="Voice" hint={provider === 'gemini' ? 'Pick a suggestion or type any Google voice name.' : 'An edge-tts voice name.'}>
        <input type="text" list={listId} value={voice} onChange={(e) => setVoice(e.target.value)} />
      </Field>
      <datalist id={listId}>{list.map((v) => <option key={v} value={v} />)}</datalist>
    </div>
  );
}

export function ScriptForm({ opts, compact, onCancel }: { opts: GenOptions; compact?: boolean; onCancel?: () => void }) {
  const [mode, setMode] = useState<'topic' | 'script'>('topic');
  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [aspect, setAspect] = useState('9:16');
  const [seconds, setSeconds] = useState(45);
  const [provider, setProvider] = useState<'gemini' | 'edge'>('gemini');
  const [voice, setVoice] = useState(opts.settings.gen_tts_voice);
  const [style, setStyle] = useState('');
  const [maxImages, setMaxImages] = useState(8);
  const { job, run, busy } = useJobRunner();
  const needAi = mode === 'topic' && !opts.ai;
  const ready = opts.key && !needAi && (mode === 'topic' ? topic.trim().length > 2 : script.trim().length > 2);

  async function create() {
    try {
      const r = await run<{ project_id: string; clip_id: string; note: string }>(() => api.post('/api/generate/from-script', {
        topic: topic.trim(), script: mode === 'script' ? script : '', aspect, seconds: mode === 'topic' ? seconds : undefined,
        provider, voice: voice.trim(), image_style: style.trim(), max_images: maxImages,
      }));
      if (r.note) toast(r.note);
      go(`studio/${r.project_id}/${r.clip_id}`);
    } catch (e) { toastError(e); }
  }

  return (
    <div className="col gap-l">
      {!opts.key && <div className="notice warn">The pictures are generated with a Gemini API key. <a href="#/settings">Add one under Settings → AI</a>.</div>}
      <Seg value={mode} onChange={setMode} options={[{ value: 'topic', label: 'Write it for me' }, { value: 'script', label: 'Use my script' }]} />
      {needAi && <div className="notice warn">Writing a script needs an AI key (<a href="#/settings">Settings → AI</a>). You can paste your own script instead.</div>}
      <Field label={mode === 'topic' ? 'Topic' : 'Title (optional)'}>
        <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={mode === 'topic' ? 'e.g. why octopuses have three hearts' : 'Shown as the opening title'} />
      </Field>
      {mode === 'script' && (
        <Field label="Script" hint="Read out exactly as written. Each sentence or two becomes one scene.">
          <textarea rows={compact ? 5 : 8} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Paste the narration…" />
        </Field>
      )}
      <div className="grid-2">
        <Field label="Shape">
          <Seg small value={aspect} onChange={setAspect} options={ASPECTS} />
        </Field>
        {mode === 'topic' && (
          <Field label="Length">
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              {LENGTHS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
        )}
      </div>
      <VoiceFields opts={opts} provider={provider} setProvider={setProvider} voice={voice} setVoice={setVoice} />
      <Field label="Picture style (optional)">
        <input type="text" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="e.g. flat illustration, muted colours" />
      </Field>
      <Slider label="Pictures at most" min={1} max={40} value={maxImages} onChange={setMaxImages} format={(v) => `${v}`} />
      <div className="notice">
        Billed by Google per use: one request per picture (up to {maxImages}){provider === 'gemini' ? ', one voice request per scene' : ''}{mode === 'topic' ? ', and one request to write the script' : ''}.
        Captions are timed from the narration and can be adjusted in the editor.
      </div>
      <JobBar job={job} />
      <div className="row">
        <span className="spacer" />
        {onCancel && <Button onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button variant="primary" icon="sparkle" onClick={create} busy={busy} disabled={!ready}>Create video</Button>
      </div>
    </div>
  );
}
