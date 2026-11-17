import { useEffect, useState } from 'react';

import { api } from '../api';
import { FONTS } from '../remotion/types';
import { Asset } from '../studio/types';
import { Button, Field, Panel, Seg, Slider, Toggle, toast, toastError } from '../ui';

type Brand = { name: string; accent: string; secondary: string; font: string; logo: string; logoPos: string; logoSize: number; watermark: string };
type SettingsData = {
  ai_provider: 'anthropic' | 'gemini'; anthropic_api_key: string; anthropic_api_key_set: boolean; ai_model: string;
  gemini_api_key: string; gemini_api_key_set: boolean; gemini_model: string; whisper_model: string; copy_folder: string;
  pexels_api_key: string; pexels_api_key_set: boolean; tts_voice: string; brand: Brand;
  flow_enabled?: boolean; flow_mcp_path?: string; flow_out_dir?: string;
};
type FlowState = { enabled: boolean; available: boolean; why: string; server_edition: boolean; out_dir: string; out_dir_exists: boolean };

export default function Settings() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [logos, setLogos] = useState<Asset[]>([]);
  const [health, setHealth] = useState<{ ffmpeg: boolean; ai: boolean; ai_provider: string; data: string; auth?: boolean } | null>(null);
  const [geminiModels, setGeminiModels] = useState<{ id: string; label: string }[]>([
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (default; fast, works on the free tier)' },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon (stronger; paid)' },
    { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon (strongest; paid)' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (cheapest)' },
  ]);
  const [saving, setSaving] = useState(false);
  const [flow, setFlow] = useState<FlowState | null>(null);

  useEffect(() => {
    api.get<SettingsData>('/api/settings').then(setS).catch(toastError);
    api.get<Asset[]>('/api/assets/brand').then(setLogos).catch(() => {});
    api.get('/api/health').then(setHealth).catch(() => {});
    api.get<FlowState>('/api/flow/state').then(setFlow).catch(() => {});
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
      api.get<FlowState>('/api/flow/state').then(setFlow).catch(() => {});
      toast('Settings saved', 'good');
    } catch (e) { toastError(e); }
    setSaving(false);
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Everything is stored on this computer{health ? <> in <span className="mono">{health.data}</span></> : null}.</p>
        </div>
        <div className="row">
          {health?.auth && <Button onClick={async () => { await api.post('/api/logout').catch(() => {}); window.location.reload(); }}>Sign out</Button>}
          <Button variant="primary" icon="check" onClick={save} busy={saving}>Save settings</Button>
        </div>
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

      <Panel title="Google Flow (flow-mcp)" actions={flow?.server_edition ? <span className="pill muted">Desktop only</span>
        : flow?.available ? <span className="pill good">Ready</span> : s.flow_enabled ? <span className="pill accent">Needs setup</span> : <span className="pill muted">Off</span>}>
        <p className="muted">An optional connector for generating stills, clips and narration with Google Flow, using your own Flow credits. It relies on flow-mcp, a separate program you install yourself, which works by controlling a Chrome window signed in to your Google account.</p>
        <div className="notice warn">flow-mcp automates Flow's website. Its own documentation says this may be against Google's terms of service and can stop working whenever Google changes the site. Use it on your own account, at your own risk. Cutroom only passes your requests to flow-mcp, at flow-mcp's own pace.</div>
        {flow?.server_edition ? (
          <div className="notice">Not available on the server edition: flow-mcp needs a visible Chrome window on your own computer. Use the Generate page's API options here instead.</div>
        ) : (
          <>
            <Toggle checked={!!s.flow_enabled} onChange={(v) => set({ flow_enabled: v })} label="Turn on the Flow connector" />
            {s.flow_enabled && (
              <>
                <Field label="flow-mcp folder" hint="The folder you cloned flow-mcp into, the one that contains dist/index.js after 'npm run build'. Installing it is described in the flow-mcp README (github.com/GTAI-1/flow-mcp): clone, npm install, npm run build, then npm run login to sign in once.">
                  <input type="text" placeholder="e.g. C:\Users\you\flow-mcp  or  ~/flow-mcp" value={s.flow_mcp_path ?? ''} onChange={(e) => set({ flow_mcp_path: e.target.value })} />
                </Field>
                <Field label="Flow output folder" hint="Where flow-mcp saves what it makes. Leave empty for its default, the flow-mcp-out folder in your home folder. Cutroom can import new files from here even when flow-mcp is not running.">
                  <input type="text" placeholder="Default: flow-mcp-out in your home folder" value={s.flow_out_dir ?? ''} onChange={(e) => set({ flow_out_dir: e.target.value })} />
                </Field>
                {flow && flow.enabled && !flow.available && flow.why && <div className="notice">{flow.why}</div>}
                <span className="small muted">Save, then open Generate → Flow. It needs Chrome, a display that stays awake, and the Flow window left open.</span>
              </>
            )}
          </>
        )}
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
