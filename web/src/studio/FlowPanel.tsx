// Optional Google Flow connector (flow-mcp), desktop edition only. Self-contained: mount it anywhere.
import { useEffect, useState } from 'react';

import { go } from '../App';
import { api } from '../api';
import { Button, Empty, Field, JobBar, Panel, Seg, Toggle, fmtBytes, toast, toastError, useJobRunner } from '../ui';

type FlowState = {
  enabled: boolean; available: boolean; why: string; can_import: boolean; server_edition: boolean;
  tools: string[]; path: string; out_dir: string; out_dir_exists: boolean;
};
type Session = {
  signed_in: boolean; in_project: boolean; ready: boolean; plan: string; credits: number | null; hint: string;
  output_root: string; queued: number; tools: string[]; voices: string[];
};
type Item = { name: string; label: string; url: string; size: number; type: 'image' | 'video' | 'gif' | 'audio'; kind: string };
type Failed = { scene: string; status: string; error: string };
type Result = { items: Item[]; failed: Failed[]; credits?: number; mode?: string; skipped?: number; busy?: number; folder?: string };

const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

export default function FlowPanel() {
  const [state, setState] = useState<FlowState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [stills, setStills] = useState('');
  const [stillAspect, setStillAspect] = useState('9:16');
  const [exact, setExact] = useState(false);
  const [scenes, setScenes] = useState('');
  const [clipAspect, setClipAspect] = useState('9:16');
  const [seconds, setSeconds] = useState('8');
  const [cap, setCap] = useState(20);
  const [confirm, setConfirm] = useState(false);
  const [script, setScript] = useState('');
  const [voice, setVoice] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [failed, setFailed] = useState<Failed[]>([]);
  const { job, run, busy } = useJobRunner();

  const load = () => api.get<FlowState>('/api/flow/state').then(setState).catch(toastError);
  useEffect(() => { load(); }, []);

  function show(r: Result, what: string) {
    setItems((cur) => [...r.items, ...cur]);
    setFailed(r.failed ?? []);
    load();   // the output folder may exist now, and the tool list is known after the first connection
    const n = r.items.length;
    if (n) toast(`${n} ${what}${n === 1 ? '' : 's'} added to your Library`, 'good');
    else if (!(r.failed ?? []).length) toast(`Nothing new to add`, 'info');
    if ((r.failed ?? []).length) toast(`${r.failed.length} did not finish; see the list below`, 'bad');
  }

  async function check() {
    setSessionError('');
    try {
      setSession(await run<Session>(() => api.post('/api/flow/status')));
      load();
    } catch (e) {
      setSession(null);
      setSessionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function makeStills() {
    try {
      show(await run<Result>(() => api.post('/api/flow/images', { prompts: lines(stills), aspect: stillAspect, exact })), 'still');
    } catch (e) { toastError(e); }
  }

  async function makeClips() {
    try {
      const r = await run<Result>(() => api.post('/api/flow/clips', { scenes: lines(scenes), aspect: clipAspect, seconds: seconds ? Number(seconds) : null, max_credits: cap, confirm: true }));
      show(r, 'clip');
      if (r.credits) toast(`Flow reported ${r.credits} credits spent`, 'info');
      setConfirm(false);
    } catch (e) { toastError(e); }
  }

  async function narrate() {
    try {
      show(await run<Result>(() => api.post('/api/flow/narrate', { text: script, voice: voice || undefined })), 'narration');
    } catch (e) { toastError(e); }
  }

  async function importFolder() {
    try {
      const r = await run<Result>(() => api.post('/api/flow/import'));
      show(r, 'file');
      if (r.busy) toast(`${r.busy} file${r.busy === 1 ? ' is' : 's are'} still being written; import again in a moment`, 'info');
    } catch (e) { toastError(e); }
  }

  if (!state) return <Empty icon="sparkle" title="Loading…" />;

  if (state.server_edition) {
    return (
      <Panel title="Google Flow">
        <Empty icon="alert" title="Not available on the server edition">
          The Flow connector controls a Chrome window on your own computer, so it only works in the desktop edition. Use the other tabs on this page here.
        </Empty>
      </Panel>
    );
  }
  if (!state.enabled) {
    return (
      <Panel title="Google Flow">
        <Empty icon="sparkle" title="The Flow connector is off">
          It can make stills, clips and narration with Google Flow through flow-mcp, a separate program you install. It is optional and off by default, because automating Flow may be against Google's terms.
        </Empty>
        <div className="row" style={{ justifyContent: 'center', marginTop: -30, paddingBottom: 26 }}>
          <Button variant="primary" icon="gear" onClick={() => go('settings')}>Open Settings</Button>
        </div>
      </Panel>
    );
  }

  const ready = state.available;
  const clipCount = lines(scenes).length;
  const stillCount = lines(stills).length;
  const hasBatch = !state.tools.length || state.tools.includes('flow_agent_images');
  const canNarrate = !state.tools.length || state.tools.includes('flow_narrate');

  return (
    <div className="col gap-l">
      <div className="notice warn">
        This works by letting flow-mcp control Flow's website in a Chrome window signed in as you. flow-mcp's documentation says that may be against Google's terms of service; it is your account and your risk. Requests run one at a time at flow-mcp's own pace.
      </div>
      {!ready && <div className="notice bad">{state.why} <a href="#/settings">Open Settings</a></div>}
      <JobBar job={job} />

      <Panel title="Flow session" actions={<Button small icon="search" onClick={check} disabled={!ready || busy}>Check session</Button>}>
        {session ? (
          <>
            <div className="row wrap gap-l">
              <div className="stat"><b>{session.ready ? 'Ready' : session.signed_in ? 'No project open' : 'Signed out'}</b><span>Flow window</span></div>
              <div className="stat"><b>{session.plan || '—'}</b><span>Plan</span></div>
              <div className="stat"><b>{session.credits ?? '—'}</b><span>Credits left</span></div>
              <div className="stat"><b>{session.queued}</b><span>In flow-mcp's queue</span></div>
            </div>
            {session.hint && <div className="notice">{session.hint}</div>}
          </>
        ) : sessionError ? (
          <div className="notice bad">{sessionError}</div>
        ) : (
          <span className="muted">Check that the Flow Chrome window is signed in and has a project open. flow-mcp needs that window left open, on a display that stays awake.</span>
        )}
        {state.tools.length > 0 && <span className="small faint">This flow-mcp offers {state.tools.length} tools{hasBatch ? ', including fast image batches' : '; it has no fast image batch, so stills are made one by one'}.</span>}
      </Panel>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Panel title="Stills">
          <span className="muted">Free in Flow. One description per line, up to 50.</span>
          <Field label="Descriptions">
            <textarea rows={5} value={stills} onChange={(e) => setStills(e.target.value)} placeholder={'A steaming cup of coffee on a bedside table at night\nA phone alarm showing 3:00 AM'} />
          </Field>
          <Field label="Shape">
            <Seg small value={stillAspect} onChange={setStillAspect} options={['9:16', '3:4', '1:1', '4:3', '16:9'].map((a) => ({ value: a, label: a }))} />
          </Field>
          <Toggle checked={exact || !hasBatch} onChange={setExact} label="One by one, with my exact wording (slower)" />
          <span className="small faint">{exact || !hasBatch ? 'Each still is its own paced request, about a minute apart.' : 'Sent as one batch that Flow renders in parallel; Flow may reword the descriptions.'}</span>
          <div className="row">
            <Button variant="primary" icon="image" onClick={makeStills} disabled={!ready || busy || !stillCount || stillCount > 50}>Make {stillCount || ''} still{stillCount === 1 ? '' : 's'}</Button>
          </div>
        </Panel>

        <Panel title="Clips">
          <span className="muted">Spends Flow credits. One scene per line, up to 20. A scene is skipped, spending nothing, when Flow quotes more than your cap.</span>
          <Field label="Scenes">
            <textarea rows={5} value={scenes} onChange={(e) => { setScenes(e.target.value); setConfirm(false); }} placeholder="A slow push-in on a coffee machine in a dark kitchen, warm light" />
          </Field>
          <div className="grid-3">
            <Field label="Shape">
              <Seg small value={clipAspect} onChange={setClipAspect} options={[{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }]} />
            </Field>
            <Field label="Length" hint="Some Flow models use a fixed length.">
              <select value={seconds} onChange={(e) => setSeconds(e.target.value)}>
                <option value="">Flow's default</option>
                {[4, 6, 8, 10].map((n) => <option key={n} value={n}>{n} seconds</option>)}
              </select>
            </Field>
            <Field label="Credit cap per clip">
              <input type="number" min={1} max={200} value={cap} onChange={(e) => { setCap(Number(e.target.value)); setConfirm(false); }} />
            </Field>
          </div>
          <Toggle checked={confirm} onChange={setConfirm}
            label={`I understand this can spend up to ${clipCount * (cap || 0)} Flow credits (${clipCount} clip${clipCount === 1 ? '' : 's'} × ${cap || 0})`} />
          <div className="row">
            <Button variant="primary" icon="film" onClick={makeClips} disabled={!ready || busy || !clipCount || clipCount > 20 || !confirm || !(cap >= 1 && cap <= 200)}>Make {clipCount || ''} clip{clipCount === 1 ? '' : 's'}</Button>
          </div>
        </Panel>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Panel title="Narration">
          <span className="muted">Free. Recorded on this computer by flow-mcp's built-in voice; the first take downloads its voice model once.</span>
          {!canNarrate && <div className="notice">This version of flow-mcp has no narration tool. Update flow-mcp to use it.</div>}
          <Field label="Script">
            <textarea rows={4} value={script} onChange={(e) => setScript(e.target.value)} placeholder="About two and a half words per second: 25 words fit ten seconds." />
          </Field>
          <Field label="Voice" hint={session?.voices.length ? undefined : 'Check the session to list the voices, or type a voice name such as af_heart.'}>
            {session?.voices.length ? (
              <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                <option value="">flow-mcp's default</option>
                {session.voices.map((v) => <option key={v}>{v}</option>)}
              </select>
            ) : <input type="text" value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="Default voice" />}
          </Field>
          <div className="row">
            <Button variant="primary" icon="speaker" onClick={narrate} disabled={!ready || busy || !script.trim() || !canNarrate}>Record narration</Button>
          </div>
        </Panel>

        <Panel title="Import from the Flow output folder">
          <span className="muted">Copies new images, videos and audio that flow-mcp has saved into your Library. This works even when flow-mcp is not running, so it also collects anything you made in flow-mcp's own panel.</span>
          <div className="small mono faint" style={{ overflowWrap: 'anywhere' }}>{state.out_dir}{state.out_dir_exists ? '' : ' (not created yet)'}</div>
          <div className="row">
            <Button icon="download" onClick={importFolder} disabled={!state.can_import || busy}>Import new files</Button>
          </div>
        </Panel>
      </div>

      {(items.length > 0 || failed.length > 0) && (
        <Panel title={`Added this session (${items.length})`}>
          {failed.length > 0 && (
            <div className="col gap-s">
              {failed.map((f, i) => <div key={i} className="notice bad"><b>{f.scene || 'Scene'}</b> {f.status && f.status !== 'done' ? `(${f.status}) ` : ''}{f.error}</div>)}
            </div>
          )}
          {items.length > 0 && (
            <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {items.map((it) => (
                <div key={it.url} className="card">
                  {it.type === 'audio' ? <audio src={it.url} controls preload="none" style={{ width: '100%', height: 34 }} />
                    : it.type === 'video' ? <video className="thumb tall" src={it.url} controls preload="metadata" />
                      : <img className="thumb tall" src={it.url} alt="" loading="lazy" />}
                  <strong className="small ellipsis" title={it.name}>{it.label}</strong>
                  <span className="small muted">{it.kind === 'voice' ? 'Voiceovers' : 'B-roll'} · {fmtBytes(it.size)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
