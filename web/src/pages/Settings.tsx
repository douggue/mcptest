import { useEffect, useState } from 'react';

import { api } from '../api';
import { FONTS } from '../remotion/types';
import { Asset, YouTubeChannel, YouTubeState } from '../studio/types';
import { Button, Field, Panel, Seg, Slider, Toggle, toast, toastError } from '../ui';

type Brand = { name: string; accent: string; secondary: string; font: string; logo: string; logoPos: string; logoSize: number; watermark: string };
type SettingsData = {
  ai_provider: 'anthropic' | 'gemini' | 'claude_code'; anthropic_api_key: string; anthropic_api_key_set: boolean; ai_model: string;
  gemini_api_key: string; gemini_api_key_set: boolean; gemini_model: string; claude_code_model: string; claude_code_effort: string; claude_code_path: string;
  gemini_cli_tasks: string[]; gemini_cli_model: string; gemini_cli_path: string; whisper_model: string; copy_folder: string; capcut_folder: string;
  pexels_api_key: string; pexels_api_key_set: boolean; tts_voice: string; brand: Brand;
  flow_enabled?: boolean; flow_mcp_path?: string; flow_out_dir?: string;
  youtube_client_id?: string; youtube_client_secret?: string; youtube_client_secret_set?: boolean; youtube_redirect_url?: string;
};
type FlowState = { enabled: boolean; available: boolean; why: string; server_edition: boolean; out_dir: string; out_dir_exists: boolean };

export default function Settings() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [logos, setLogos] = useState<Asset[]>([]);
  const [health, setHealth] = useState<{ ffmpeg: boolean; ai: boolean; ai_provider: string; ai_problem?: string; data: string; auth?: boolean } | null>(null);
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

  // the provider takes effect at once: choosing one and forgetting to press Save left the AI off
  async function chooseProvider(v: SettingsData['ai_provider']) {
    set({ ai_provider: v });
    try {
      await api.put('/api/settings', { ai_provider: v });
      const h = await api.get<NonNullable<typeof health>>('/api/health');
      setHealth(h);
      toast(h.ai ? `Now using ${h.ai_provider}` : 'Saved. ' + (h.ai_problem || ''), h.ai ? 'good' : 'info');
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

      <Panel title="AI" actions={health?.ai ? <span className="pill good">Using {health.ai_provider}</span> : <span className="pill muted">Not set up</span>}>
        <p className="muted">With a key, the AI picks the moments, scores them, plans graphics, writes hooks and post text, and translates captions. Without one, simpler built-in rules are used and translation is unavailable. Transcripts are sent to the provider you choose.</p>
        <Field label="Provider" hint="Claude API key and Gemini: if the chosen one has no key, the other is used when it has one. Claude subscription uses your Claude plan through Claude Code, no key needed.">
          <Seg value={s.ai_provider} onChange={chooseProvider} options={[
            { value: 'anthropic', label: 'Claude API key' }, { value: 'gemini', label: 'Gemini (Google)' },
            { value: 'claude_code', label: 'Claude subscription', title: 'Uses the Claude Code program on this computer, signed in with your own Claude plan: no API key' },
          ]} />
        </Field>
        {health && !health.ai && health.ai_problem && <div className="notice warn">{health.ai_problem}</div>}
        {s.ai_provider === 'claude_code' && <ClaudeCodeSettings s={s} set={set} />}
        <GeminiCliSettings s={s} set={set} />
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
        <Field label="CapCut projects folder" hint="Used by “Finish in CapCut”. In CapCut for Windows it is usually C:\Users\(you)\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft. On the same computer Cutroom finds it by itself; fill this in when Cutroom runs on a server.">
          <input type="text" className="mono" spellCheck={false} placeholder="C:\Users\you\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft" value={s.capcut_folder ?? ''} onChange={(e) => set({ capcut_folder: e.target.value })} />
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

      <YouTubeSettings s={s} set={set} onSaved={setS} />

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

/* ---------------------------------------------------------------- YouTube */

function YouTubeSettings({ s, set, onSaved }: {
  s: SettingsData; set: (patch: Partial<SettingsData>) => void; onSaved: (s: SettingsData) => void;
}) {
  const [yt, setYt] = useState<YouTubeState | null>(null);
  const [busy, setBusy] = useState('');
  const [hideLast, setHideLast] = useState(false);
  const load = () => api.get<YouTubeState>('/api/youtube/state').then(setYt).catch(() => {});
  useEffect(() => { load(); }, []);

  // the outcome of a sign-in that just came back from Google
  const recent = yt?.last && !hideLast && Date.now() / 1000 - yt.last.at < 120 ? yt.last : null;
  const hasClient = !!(s.youtube_client_id?.trim() && (s.youtube_client_secret || s.youtube_client_secret_set));

  async function connect(c?: YouTubeChannel) {
    setBusy(c ? `re-${c.id}` : 'connect');
    try {
      // save the client ID and secret first, so the sign-in uses what is on screen
      onSaved(await api.put<SettingsData>('/api/settings', s));
      const r = await api.post<{ url: string }>('/api/youtube/connect', c?.account_id ? { account_id: c.account_id } : {});
      window.location.href = r.url;   // Google's consent page; it sends the browser back to Settings
    } catch (e) {
      toastError(e);
      setBusy('');
    }
  }

  async function check(c: YouTubeChannel) {
    setBusy(`check-${c.id}`);
    try {
      await api.post(`/api/youtube/channels/${c.id}/check`);
      toast(`${c.title} is connected`, 'good');
    } catch (e) { toastError(e); }
    await load();
    setBusy('');
  }

  async function disconnect(c: YouTubeChannel) {
    if (!window.confirm(`Disconnect ${c.title}? Cutroom forgets its tokens and asks Google to revoke them. Posts already made stay in the Agency planner.`)) return;
    setBusy(`del-${c.id}`);
    try {
      await api.del(`/api/youtube/channels/${c.id}`);
      toast(`Disconnected ${c.title}`, 'good');
    } catch (e) { toastError(e); }
    await load();
    setBusy('');
  }

  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast('Copied', 'good'), () => toast('Could not copy; select the text instead', 'bad'));
  const n = yt?.channels.length ?? 0;
  const broken = yt?.channels.filter((c) => c.needs_reconnect).length ?? 0;
  const sourceHint = {
    saved: 'You typed this one below.',
    env: 'Taken from CUTROOM_PUBLIC_URL (or CUTROOM_DOMAIN).',
    request: 'The address you opened Cutroom at. If Google is to reach a different address, type it below.',
    desktop: 'Cutroom on this computer. If you start Cutroom on another port, this changes and Google needs the new one.',
  }[yt?.redirect_source ?? 'desktop'];

  return (
    <Panel title="YouTube" actions={broken ? <span className="pill bad">{broken} need{broken === 1 ? 's' : ''} reconnecting</span>
      : n ? <span className="pill good">{n} channel{n === 1 ? '' : 's'} connected</span> : <span className="pill muted">Not connected</span>}>
      <p className="muted">
        Post exported shorts straight to your own YouTube channels, now or at a scheduled time, and read their views, likes and
        comments back into the Agency planner. Cutroom uses your own Google Cloud OAuth client; there is no Cutroom account in between.
      </p>
      {recent && (
        <div className={'notice ' + (recent.ok ? '' : 'bad')} role="status">
          {recent.text} <Button small variant="ghost" onClick={() => setHideLast(true)}>Dismiss</Button>
        </div>
      )}
      <details className="small">
        <summary>How to set it up in Google Cloud (about ten minutes, once)</summary>
        <ol className="notes-list">
          <li>In the Google Cloud console, create a project (or pick one) and enable <b>YouTube Data API v3</b> under APIs and services → Library.</li>
          <li>Under OAuth consent screen (Google Auth platform), choose External, fill in the app name and your email, and add the scopes <span className="mono">youtube.upload</span> and <span className="mono">youtube.readonly</span>. Add your own Google account under Test users.</li>
          <li>Set the publishing status to <b>In production</b>. While it is Testing, Google ends the connection every 7 days. You do not need Google's verification for your own use; Google shows a “Google hasn't verified this app” warning, where you click Advanced → Go to (your app).</li>
          <li>Under Clients (Credentials), create an OAuth client ID of type <b>Web application</b> and add the redirect URL below under Authorized redirect URIs. (On this computer a Desktop app client also works.)</li>
          <li>Paste the client ID and secret here, save, and press Connect channel. To post to a brand channel, pick it when Google asks which account or channel to use. Connect each channel separately.</li>
        </ol>
      </details>
      <div className="notice warn">
        Google keeps every video uploaded through an app it has not verified (any app created after July 2020) private, until the app
        passes a YouTube API audit. A personal app normally stays unverified, so expect uploads to arrive as private: make them public
        in YouTube Studio, or apply for the audit in the Google Cloud console. Scheduled uploads are affected too: they may stay private
        at their publish time. Each Google Cloud project also gets 10,000 quota units a day and an upload costs about 1,600, so about six uploads a day.
      </div>
      <div className="grid-2">
        <Field label="OAuth client ID">
          <input type="text" className="mono" spellCheck={false} autoComplete="off" placeholder="1234-abc.apps.googleusercontent.com"
            value={s.youtube_client_id ?? ''} onChange={(e) => set({ youtube_client_id: e.target.value })} />
        </Field>
        <Field label="OAuth client secret" hint={s.youtube_client_secret_set ? 'A secret is set. Type a new one to replace it.' : 'Stored only in your data folder and never shown again.'}>
          <input type="password" autoComplete="off" placeholder={s.youtube_client_secret_set ? '••••••••  (set)' : 'GOCSPX-…'}
            value={s.youtube_client_secret ?? ''} onChange={(e) => set({ youtube_client_secret: e.target.value })} />
        </Field>
      </div>
      <div className="field" role="group" aria-label="Redirect URL">
        <span className="field-label">Redirect URL for Google</span>
        <div className="row">
          <input type="text" readOnly className="mono" value={yt?.redirect_url ?? ''} aria-label="Redirect URL" onFocus={(e) => e.target.select()} />
          <Button small icon="copy" onClick={() => yt && copy(yt.redirect_url)} disabled={!yt}>Copy</Button>
        </div>
        <span className="field-hint">Paste this exactly under Authorized redirect URIs on your OAuth client. {sourceHint}</span>
      </div>
      <details className="small">
        <summary>Use a different redirect URL</summary>
        <Field label="Redirect URL" hint="Only when Cutroom sits behind an address it cannot see, such as a second proxy. It must end in /api/youtube/callback and reach this Cutroom. Save to apply.">
          <input type="text" className="mono" spellCheck={false} placeholder="https://clips.example.com/api/youtube/callback"
            value={s.youtube_redirect_url ?? ''} onChange={(e) => set({ youtube_redirect_url: e.target.value })} />
        </Field>
      </details>
      {yt?.server_edition && <span className="small muted">Google sends you back here after you allow access. Stay signed in to Cutroom in this browser while you connect.</span>}
      {yt?.stand_in && <div className="notice">Google addresses are overridden by environment variables (a test stand-in is in use).</div>}

      <div className="row wrap">
        <Button variant="primary" icon="plus" busy={busy === 'connect'} disabled={!hasClient || !!busy} onClick={() => connect()}>Connect channel</Button>
        {!hasClient && <span className="small muted">Paste the client ID and secret first.</span>}
      </div>

      {n > 0 && (
        <div className="col gap-s">
          {yt!.channels.map((c) => (
            <div key={c.id} className="card col" style={{ padding: 10, gap: 8 }}>
              <div className="col" style={{ gap: 3, minWidth: 0 }}>
                <div className="row gap-s wrap">
                  <b>{c.title}</b>
                  {c.handle && <span className="small muted">{c.handle}</span>}
                  {c.needs_reconnect ? <span className="pill bad">Needs reconnecting</span>
                    : !c.can_upload ? <span className="pill accent">Statistics only</span> : <span className="pill good">Connected</span>}
                </div>
                <span className="small muted">
                  {c.account_handle ? <>Agency account: {c.account_handle}</> : 'Not linked to an Agency account yet'}
                  {c.connected ? ` · connected ${new Date(c.connected * 1000).toLocaleDateString()}` : ''}
                </span>
                {c.problem && <span className="small" style={{ color: c.needs_reconnect ? 'var(--bad)' : 'var(--accent)', whiteSpace: 'normal' }}>{c.problem}</span>}
              </div>
              <div className="row gap-s wrap">
                <Button small onClick={() => check(c)} busy={busy === `check-${c.id}`} disabled={!!busy || c.needs_reconnect}>Check</Button>
                <Button small variant={c.needs_reconnect ? 'primary' : 'default'} busy={busy === `re-${c.id}`} disabled={!!busy || !hasClient} onClick={() => connect(c)}>Reconnect</Button>
                <Button small variant="danger" busy={busy === `del-${c.id}`} disabled={!!busy} onClick={() => disconnect(c)}>Disconnect</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

type CC = { installed: boolean; version: string; logged_in: boolean; method: string; why: string; server_edition: boolean };
const CC_MODELS = [
  { id: 'opus', label: 'Opus (newest; default)' }, { id: 'sonnet', label: 'Sonnet (newest; faster)' },
  { id: 'haiku', label: 'Haiku (newest; fastest, lightest on your usage)' }, { id: 'fable', label: 'Fable (newest; if your plan includes it)' },
];

/** Claude through the Claude Code program on this computer, with the owner's own subscription. */
type GC = { installed: boolean; version: string; signed_in: boolean; kind: '' | 'agy' | 'gemini'; why: string; server_edition: boolean; tasks: Record<string, string> };

/** Gemini through the person's own Google plan (the Gemini CLI on this computer), for the tasks they choose. */
function GeminiCliSettings({ s, set }: { s: SettingsData; set: (p: Partial<SettingsData>) => void }) {
  const [gc, setGc] = useState<GC | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const check = () => api.get<GC>('/api/ai/gemini-cli').then(setGc).catch(() => setGc(null));
  useEffect(() => { check(); }, []);
  if (gc?.server_edition) return null;
  const tasks = s.gemini_cli_tasks ?? [];
  const toggle = (k: string, on: boolean) => {
    const next = on ? [...new Set([...tasks, k])] : tasks.filter((x) => x !== k);
    set({ gemini_cli_tasks: next });
    api.put('/api/settings', { gemini_cli_tasks: next }).catch(toastError);   // saved at once, like the provider choice
  };
  async function test() {
    setTesting(true);
    try {
      await api.put('/api/settings', { gemini_cli_model: s.gemini_cli_model, gemini_cli_path: s.gemini_cli_path });
      const r = await api.post<{ greeting: string; seconds: number }>('/api/ai/gemini-cli/test');
      toast(`Gemini answered in ${r.seconds}s: “${r.greeting}”`, 'good');
    } catch (e) { toastError(e); }
    setTesting(false);
  }
  async function loadModels() {
    try { setModels(await api.get<string[]>('/api/ai/gemini-cli/models')); } catch (e) { toastError(e); }
  }
  return (
    <div className="card col gap-s" style={{ padding: 12 }}>
      <div className="row between wrap">
        <b className="small">Gemini with your Google subscription (Antigravity CLI)</b>
        <span className="small">
          {!gc ? 'Checking for the Antigravity CLI…'
            : gc.installed && gc.kind === 'agy' ? <><span className="pill good">Found</span> Antigravity CLI {gc.version}. Click Test to check it is signed in.</>
              : <span style={{ color: 'var(--bad)' }}>{gc.why}</span>}
        </span>
      </div>
      <span className="small muted">Send these tasks to Gemini through the Antigravity CLI (agy) on this computer: your Google AI Pro or Ultra plan, no key. Everything else keeps using the provider above. It watches reference videos whole, with their sound, but slowly: about five minutes for a 30-second video.</span>
      <div className="row wrap gap-s">
        {Object.entries(gc?.tasks ?? { moments: 'Finding moments', references: 'Studying and reviewing style references' }).map(([k, label]) => (
          <label key={k} className="row gap-s small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={tasks.includes(k)} disabled={!gc?.installed} onChange={(e) => toggle(k, e.target.checked)} /> {label}
          </label>
        ))}
      </div>
      <div className="grid-2">
        <Field label="Model" hint="Empty lets it choose. Or type a model name your plan offers.">
          <div className="row gap-s">
            {models.length
              ? <select value={s.gemini_cli_model} onChange={(e) => set({ gemini_cli_model: e.target.value })}>
                  <option value="">Let the CLI choose</option>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              : <input type="text" className="mono" spellCheck={false} placeholder="automatic" value={s.gemini_cli_model} onChange={(e) => set({ gemini_cli_model: e.target.value.trim() })} />}
            {gc?.kind === 'gemini' && <Button small onClick={loadModels} disabled={!gc?.signed_in}>Load list</Button>}
          </div>
        </Field>
        <Field label="Where agy is (optional)" hint="Leave empty to find it automatically. Otherwise the full path to agy; in a terminal,  where agy  shows it.">
          <input type="text" className="mono" spellCheck={false} placeholder="found automatically" value={s.gemini_cli_path} onChange={(e) => set({ gemini_cli_path: e.target.value })} />
        </Field>
      </div>
      <div className="row gap-s">
        <Button small onClick={check}>Check again</Button>
        <Button small variant="primary" icon="sparkle" onClick={test} busy={testing} disabled={!gc?.installed}>Test</Button>
      </div>
      <span className="small muted">It runs in an empty folder holding only that request's instructions, frames and videos, and is told to change nothing. For your own use on your own computer; Google's limits for your plan apply.</span>
    </div>
  );
}

function ClaudeCodeSettings({ s, set }: { s: SettingsData; set: (p: Partial<SettingsData>) => void }) {
  const [cc, setCc] = useState<CC | null>(null);
  const [testing, setTesting] = useState(false);
  const check = () => api.get<CC>('/api/ai/claude-code').then(setCc).catch(() => setCc(null));
  useEffect(() => { check(); }, []);
  const custom = !CC_MODELS.some((m) => m.id === s.claude_code_model);
  async function test() {
    setTesting(true);
    try {
      await api.put('/api/settings', { ai_provider: 'claude_code', claude_code_model: s.claude_code_model, claude_code_effort: s.claude_code_effort, claude_code_path: s.claude_code_path });
      const r = await api.post<{ greeting: string; seconds: number }>('/api/ai/test');
      toast(`Claude answered in ${r.seconds}s: “${r.greeting}”`, 'good');
    } catch (e) { toastError(e); }
    setTesting(false);
  }
  return (
    <div className="card col gap-s" style={{ padding: 12 }}>
      <div className="row between wrap">
        <span className="small">
          {!cc ? 'Checking Claude Code…'
            : cc.installed && cc.logged_in ? <><span className="pill good">Ready</span> Claude Code {cc.version}, signed in{cc.method === 'claude.ai' ? ' with your Claude account' : ''}.</>
              : <span style={{ color: 'var(--bad)' }}>{cc.why}</span>}
        </span>
        <div className="row gap-s">
          <Button small onClick={check}>Check again</Button>
          <Button small variant="primary" icon="sparkle" onClick={test} busy={testing} disabled={!cc?.installed || !cc.logged_in}>Test</Button>
        </div>
      </div>
      <div className="grid-2">
        <Field label="Model" hint="Opus gives the best results; Haiku uses the least of your plan. Or type any model name.">
          <select value={custom ? '__custom' : s.claude_code_model} onChange={(e) => set({ claude_code_model: e.target.value === '__custom' ? '' : e.target.value })}>
            {CC_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            <option value="__custom">Another model (type its name)…</option>
          </select>
          {custom && <input type="text" className="mono" spellCheck={false} placeholder="e.g. claude-sonnet-5-5" value={s.claude_code_model} onChange={(e) => set({ claude_code_model: e.target.value.trim() })} style={{ marginTop: 6 }} />}
        </Field>
        <Field label="Effort" hint="How long Claude thinks. Automatic lets each feature choose (more for studying styles, less for hashtags).">
          <select value={s.claude_code_effort} onChange={(e) => set({ claude_code_effort: e.target.value })}>
            <option value="">Automatic</option><option value="low">Low (fastest)</option><option value="medium">Medium</option>
            <option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Maximum (slowest)</option>
          </select>
        </Field>
      </div>
      <Field label="Where Claude Code is (optional)" hint="Leave empty to find it automatically. Otherwise the full path to claude.exe.">
        <input type="text" className="mono" spellCheck={false} placeholder="C:\Users\you\.local\bin\claude.exe" value={s.claude_code_path} onChange={(e) => set({ claude_code_path: e.target.value })} />
      </Field>
      <span className="small muted">Every AI request runs through Claude Code with its tools switched off, and counts towards your Claude plan's usage limits like any Claude chat. Watching whole reference videos needs Gemini; with this choice, styles are studied from still frames.</span>
    </div>
  );
}
