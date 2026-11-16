import { useEffect, useState } from 'react';

import { api } from '../api';
import { FONTS } from '../remotion/types';
import { Asset } from '../studio/types';
import { Button, Field, Panel, Seg, Slider, toast, toastError } from '../ui';

type Brand = { name: string; accent: string; secondary: string; font: string; logo: string; logoPos: string; logoSize: number; watermark: string };
type SettingsData = {
  ai_provider: 'anthropic' | 'gemini'; anthropic_api_key: string; anthropic_api_key_set: boolean; ai_model: string;
  gemini_api_key: string; gemini_api_key_set: boolean; gemini_model: string; whisper_model: string; copy_folder: string;
  pexels_api_key: string; pexels_api_key_set: boolean; tts_voice: string; brand: Brand;
};

export default function Settings() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [logos, setLogos] = useState<Asset[]>([]);
  const [health, setHealth] = useState<{ ffmpeg: boolean; ai: boolean; ai_provider: string; data: string } | null>(null);
  const [geminiModels, setGeminiModels] = useState<{ id: string; label: string }[]>([
    { id: 'gemini-flash-latest', label: 'Gemini Flash (latest; default, works on the free tier)' },
    { id: 'gemini-pro-latest', label: 'Gemini Pro (latest; strongest)' },
    { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (latest; cheapest)' },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SettingsData>('/api/settings').then(setS).catch(toastError);
    api.get<Asset[]>('/api/assets/brand').then(setLogos).catch(() => {});
    api.get('/api/health').then(setHealth).catch(() => {});
  }, []);
  if (!s) return <div className="page"><h1>Settings</h1></div>;

  const set = (patch: Partial<SettingsData>) => setS({ ...s, ...patch });
  const setBrand = (patch: Partial<Brand>) => setS({ ...s, brand: { ...s.brand, ...patch } });

  async function loadGeminiModels() {
    try {
      const rows = await api.get<{ id: string; label: string }[]>('/api/ai/models?provider=gemini');
      setGeminiModels(rows);
      toast(`Found ${rows.length} Gemini models for your key`, 'good');
    } catch (e) { toastError(e); }
  }

  async function save() {
    setSaving(true);
    try {
      setS(await api.put<SettingsData>('/api/settings', s));
      api.get('/api/health').then(setHealth).catch(() => {});
      toast('Settings saved', 'good');
    } catch (e) { toastError(e); }
    setSaving(false);
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Everything is stored on this computer{health ? <> in <span className="mono">{health.data}</span></> : null}.</p>
        </div>
        <Button variant="primary" icon="check" onClick={save} busy={saving}>Save settings</Button>
      </div>

      {health && !health.ffmpeg && <div className="notice bad">ffmpeg was not found. Install it and restart Cutroom; nothing can be cut or rendered without it.</div>}

      <Panel title="AI" actions={health?.ai ? <span className="pill good">Using {health.ai_provider}</span> : <span className="pill muted">No key set</span>}>
        <p className="muted">With a key, the AI picks the moments, scores them, plans graphics, writes hooks and post text, and translates captions. Without one, simpler built-in rules are used and translation is unavailable. Transcripts are sent to the provider you choose.</p>
        <Field label="Provider" hint="If the chosen provider has no key, the other one is used when it has one.">
          <Seg value={s.ai_provider} onChange={(v) => set({ ai_provider: v })} options={[{ value: 'anthropic', label: 'Claude (Anthropic)' }, { value: 'gemini', label: 'Gemini (Google)' }]} />
        </Field>
        <div className="grid-2">
          <Field label="Anthropic API key" hint={s.anthropic_api_key_set ? 'A key is set. Type a new one to replace it.' : 'Stored only in your data folder. You can also set ANTHROPIC_API_KEY before starting.'}>
            <input type="password" autoComplete="off" placeholder={s.anthropic_api_key_set ? '••••••••  (set)' : 'sk-ant-…'} value={s.anthropic_api_key} onChange={(e) => set({ anthropic_api_key: e.target.value })} />
          </Field>
          <Field label="Claude model" hint="The default gives the best picks; smaller models cost less per video.">
            <select value={s.ai_model} onChange={(e) => set({ ai_model: e.target.value })}>
              <option value="claude-opus-5-5">Claude Opus 5.5 (default)</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
              <option value="claude-fable-5-2">Claude Fable 5.2</option>
            </select>
          </Field>
        </div>
        <div className="grid-2">
          <Field label="Gemini API key" hint={s.gemini_api_key_set ? 'A key is set. Type a new one to replace it.' : 'Free to create in Google AI Studio. You can also set GEMINI_API_KEY before starting.'}>
            <input type="password" autoComplete="off" placeholder={s.gemini_api_key_set ? '••••••••  (set)' : 'AIza…'} value={s.gemini_api_key} onChange={(e) => set({ gemini_api_key: e.target.value })} />
          </Field>
          <div className="field" role="group" aria-label="Gemini model">
            <span className="field-label">Gemini model</span>
            <div className="row">
              <select value={s.gemini_model} onChange={(e) => set({ gemini_model: e.target.value })} aria-label="Gemini model">
                {!geminiModels.some((m) => m.id === s.gemini_model) && <option value={s.gemini_model}>{s.gemini_model}</option>}
                {geminiModels.map((m) => <option key={m.id} value={m.id}>{m.label === m.id ? m.id : `${m.label} — ${m.id}`}</option>)}
              </select>
              <Button small onClick={loadGeminiModels} disabled={!s.gemini_api_key_set} title="Ask Google which models your key can use">Load list</Button>
            </div>
            <span className="field-hint">“Latest” follows Google's current model. Save the key first, then load the full list.</span>
          </div>
        </div>
      </Panel>

      <Panel title="Transcription and voice">
        <div className="grid-2">
          <Field label="Whisper model" hint="Runs on this computer. Small is a good balance; medium and large need a strong machine.">
            <select value={s.whisper_model} onChange={(e) => set({ whisper_model: e.target.value })}>
              {['tiny', 'base', 'small', 'medium', 'large-v3'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Voiceover voice" hint="An edge-tts voice name, e.g. en-US-GuyNeural or en-GB-SoniaNeural.">
            <input type="text" value={s.tts_voice} onChange={(e) => set({ tts_voice: e.target.value })} />
          </Field>
        </div>
      </Panel>

      <Panel title="Saving and stock footage">
        <Field label="Also copy finished files to this folder" hint="Point this at your Google Drive (or Dropbox, OneDrive) desktop folder and every clip and export syncs to the cloud. Leave empty to skip.">
          <input type="text" placeholder="e.g. G:\My Drive\Clips  or  ~/Google Drive/Clips" value={s.copy_folder} onChange={(e) => set({ copy_folder: e.target.value })} />
        </Field>
        <Field label="Pexels API key (optional)" hint={s.pexels_api_key_set ? 'A key is set. Type a new one to replace it.' : 'Free at pexels.com/api; enables stock b-roll search in the Library.'}>
          <input type="password" autoComplete="off" placeholder={s.pexels_api_key_set ? '••••••••  (set)' : ''} value={s.pexels_api_key} onChange={(e) => set({ pexels_api_key: e.target.value })} />
        </Field>
      </Panel>

      <Panel title="Brand kit">
        <p className="muted">Defaults for every new clip. Each clip can still be changed in the editor, and templates can carry a different brand per channel or client.</p>
        <div className="grid-3">
          <Field label="Title font">
            <select value={s.brand.font} onChange={(e) => setBrand({ font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
          </Field>
          <Field label="Accent colour"><input type="color" value={s.brand.accent} onChange={(e) => setBrand({ accent: e.target.value })} /></Field>
          <Field label="Text colour"><input type="color" value={s.brand.secondary} onChange={(e) => setBrand({ secondary: e.target.value })} /></Field>
        </div>
        <div className="grid-2">
          <Field label="Logo" hint="Upload logos under Library → Brand images.">
            <select value={s.brand.logo} onChange={(e) => setBrand({ logo: e.target.value })}>
              <option value="">None</option>
              {logos.map((a) => <option key={a.url} value={a.url}>{a.label}</option>)}
            </select>
          </Field>
          <Field label="Watermark text"><input type="text" placeholder="@yourchannel" value={s.brand.watermark} onChange={(e) => setBrand({ watermark: e.target.value })} /></Field>
        </div>
        {s.brand.logo && (
          <div className="grid-2">
            <Field label="Logo corner">
              <Seg small value={s.brand.logoPos} onChange={(v) => setBrand({ logoPos: v })} options={[
                { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' },
                { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' }]} />
            </Field>
            <Slider label="Logo size" min={5} max={40} value={s.brand.logoSize} format={(v) => `${v}%`} onChange={(v) => setBrand({ logoSize: v })} />
          </div>
        )}
      </Panel>
    </div>
  );
}
