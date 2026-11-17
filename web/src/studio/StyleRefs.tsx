// A style's reference videos (saved with the style), what the AI remembers from them, and how the style works.
import { useRef, useState } from 'react';

import { api, upload } from '../api';
import { Button, Empty, Field, JobBar, Panel, fmtDur, toast, toastError, useJobRunner } from '../ui';
import type { StyleProfile } from './types';

type Runner = ReturnType<typeof useJobRunner>;

const ago = (t?: number) => {
  if (!t) return 'never';
  const d = (Date.now() / 1000 - t) / 86400;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`;
};

export function ReferencesPanel({ style, reload, job, run, busy, onStudy }: {
  style: StyleProfile; reload: () => void; job: Runner['job']; run: Runner['run']; busy: boolean; onStudy?: () => void;
}) {
  const [uploading, setUploading] = useState('');
  const [link, setLink] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refs = style.references ?? [];
  const links = style.reference_links ?? [];
  const saved = new Set(refs.map((r) => r.source_url).filter(Boolean));
  const missing = links.filter((l) => !saved.has(l.url));
  const base = `/api/profiles/${style.id}`;

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setUploading(`Uploading ${i + 1} of ${list.length}…`);
      const form = new FormData();
      form.append('file', list[i]);
      await upload(`${base}/references`, form).catch(toastError);
    }
    setUploading('');
    reload();
  }
  async function downloadAll() {
    try {
      const p = await run<StyleProfile>(() => api.post(`${base}/references/download`));
      reload();
      toast(p.review_note || `Saved ${p.references?.length ?? 0} reference videos${p.reviewed ? ' and reviewed them' : ''}`, p.review_note ? 'info' : 'good');
    } catch (e) { toastError(e); }
  }
  async function addLink() {
    try {
      await run(() => api.post(`${base}/references/link`, { url: link.trim() }));
      setLink('');
      reload();
      toast('Downloaded and saved with the style', 'good');
    } catch (e) { toastError(e); }
  }

  return (
    <Panel title={`Reference videos (${refs.length} saved)`} actions={<>
      <Button small icon="upload" onClick={() => fileRef.current?.click()}>Add files</Button>
      {missing.length > 0 && <Button small variant="primary" icon="download" onClick={downloadAll} busy={busy}>Download {missing.length} listed</Button>}
      {onStudy && <Button small icon="sparkle" onClick={onStudy} disabled={busy || !refs.length} title="Rebuild this style's look and rules from the references">{style.analysed ? 'Study again' : 'Study the style'}</Button>}
    </>}>
      <p className="muted">
        Videos made in this style. They are downloaded once and kept with the style, so the AI can look at them again:
        it reviews them to refresh its memory, and shows itself a few frames from them every time it plans an edit.
      </p>
      {style.reference_note && <div className="notice">{style.reference_note}</div>}
      <input ref={fileRef} type="file" accept="video/*,.mkv" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      {uploading && <div className="notice">{uploading}</div>}
      <JobBar job={job} />
      <div className="row gap-s" style={{ alignItems: 'flex-end' }}>
        <Field label="Add by link (YouTube, TikTok, Instagram…)" grow>
          <input type="text" value={link} placeholder="https://www.youtube.com/shorts/…" onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && link.trim() && addLink()} />
        </Field>
        <Button icon="download" onClick={addLink} disabled={!link.trim() || busy}>Download</Button>
      </div>
      {links.length > 0 && (
        <div className="ref-links">
          {links.map((l) => (
            <div key={l.url} className="row between small">
              <a href={l.url} target="_blank" rel="noreferrer" className="ellipsis">{l.title}</a>
              <span className={'pill ' + (saved.has(l.url) ? 'good' : 'muted')}>{saved.has(l.url) ? 'Saved' : 'Not downloaded'}</span>
            </div>
          ))}
        </div>
      )}
      {refs.length === 0 ? <Empty icon="film" title="No reference videos saved yet">{links.length ? 'Download the listed ones, or add your own files.' : 'Add two to five short videos that share the look you are after.'}</Empty> : (
        <div className="media-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
          {refs.map((r) => (
            <div key={r.file} className="card" style={{ padding: 8 }}>
              <video src={r.url} className="thumb tall" muted preload="metadata" controls />
              <div className="row between small"><span className="ellipsis" title={r.name}>{r.name}</span>
                <Button small variant="ghost" icon="trash" aria-label={`Remove ${r.name}`} onClick={async () => { await api.del(`${base}/references/${encodeURIComponent(r.file)}`).catch(toastError); reload(); }} /></div>
              {r.duration ? <span className="small muted mono">{fmtDur(r.duration)}{r.shot_seconds ? ` · cut every ${r.shot_seconds.toFixed(1)}s` : ''}</span> : null}
            </div>
          ))}
        </div>
      )}
      {style.note && <div className="notice warn">{style.note}</div>}
    </Panel>
  );
}

export function MemoryPanel({ style, reload, run, busy }: { style: StyleProfile; reload: () => void; run: Runner['run']; busy: boolean }) {
  const memory = style.memory ?? [];
  async function review() {
    try {
      const p = await run<StyleProfile>(() => api.post(`/api/profiles/${style.id}/review`));
      reload();
      toast(`Reviewed: ${p.memory?.length ?? 0} things to match`, 'good');
    } catch (e) { toastError(e); }
  }
  return (
    <Panel title="What the AI remembers from the references" actions={
      <Button small icon="eye" onClick={review} busy={busy} disabled={!style.references?.length} title="Look at the saved reference videos again and refresh this list">Review again</Button>}>
      <p className="muted">
        Last reviewed {ago(style.reviewed)}{style.review_engine ? ` with ${style.review_engine}` : ''}. Every AI request for a clip in this
        style carries this list, and Plan the edit also looks at frames from the references themselves.
      </p>
      {style.review_note && <div className="notice warn">{style.review_note}</div>}
      {memory.length === 0
        ? <span className="small muted">{style.references?.length ? 'Not reviewed yet: click Review again.' : 'Save some reference videos first.'}</span>
        : <ul className="memory-list">{memory.map((m, i) => <li key={i} className="small">{m}</li>)}</ul>}
    </Panel>
  );
}

const TOOL: Record<string, string> = { frame: 'Framing', style: 'Style', words: 'Words', motion: 'Motion', post: 'Export', '': '' };
const MUSIC: Record<string, string> = { under: 'plays under the original sound', replaces: 'replaces the original sound', none: 'none: keep the original sound' };

/** The style's own steps, limits and sound, so its page explains how a video in it is made. */
export function HowItWorks({ style }: { style: StyleProfile }) {
  const steps = style.workflow ?? [];
  const L = style.limits;
  const A = style.audio;
  if (!steps.length && !L && !A) return null;
  return (
    <Panel title="How a video in this style is made">
      {steps.length > 0 && (
        <ol className="how-steps">{steps.map((s, i) => <li key={i} className="small">{s.text}{s.tool ? <span className="faint"> · {TOOL[s.tool]}</span> : null}</li>)}</ol>
      )}
      {L && (
        <div className="small">
          <b>The AI may add:</b> {L.graphics.length ? L.graphics.join(', ') : 'no graphics (only punch-ins)'}
          {L.freezes ? ', freezes' : ''}{L.speeds ? `, speed changes${L.min_rate ? ` (never slower than ${L.min_rate}x)` : ''}` : ''}.
          {!L.sfx && ' No sound effects.'}{!L.emoji && ' No emoji.'}{!L.hook && ' No extra timed title.'}{!L.tracking && ' The camera does not follow movement.'}
        </div>
      )}
      {A && (
        <div className="small">
          <b>Sound:</b> music {MUSIC[A.music]}; exports evened out to {A.lufs} LUFS
          {A.camera_on?.length ? `; the camera-flash sound plays on every ${A.camera_on.join(' and ')}` : ''}.
        </div>
      )}
    </Panel>
  );
}
