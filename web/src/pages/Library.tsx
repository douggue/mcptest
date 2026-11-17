import '../studio/studio.css';

import { useEffect, useRef, useState } from 'react';

import { api, upload } from '../api';
import { Asset, ExportRow, Template } from '../studio/types';
import { Button, Empty, Field, JobBar, Panel, fmtBytes, fmtDur, toast, toastError, useJobRunner } from '../ui';

type Tab = 'exports' | 'music' | 'broll' | 'sfx' | 'brand' | 'voice' | 'templates';
const TABS: { value: Tab; label: string }[] = [
  { value: 'exports', label: 'Exports' }, { value: 'music', label: 'Music' }, { value: 'broll', label: 'B-roll' },
  { value: 'sfx', label: 'Sound effects' }, { value: 'brand', label: 'Brand images' }, { value: 'voice', label: 'Voiceovers' },
  { value: 'templates', label: 'Templates' },
];
const HINT: Record<string, string> = {
  music: 'Background tracks you have the right to use. MP3, M4A, WAV, OGG or FLAC.',
  broll: 'Images, GIFs and video to cut away to. Name files after what they show (“coffee.jpg”) so auto b-roll can match them to spoken words.',
  sfx: 'Built-in effects for motion graphics. You can add your own WAV files.',
  brand: 'Logos for the corner of your shorts. PNG with transparency works best.',
  voice: 'Narration tracks: upload a recording or generate one from a script.',
};

type Stock = { id: number; thumb: string; duration: number; url: string; credit: string; page: string };

export default function Library() {
  const [tab, setTab] = useState<Tab>('exports');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [exportsList, setExports] = useState<ExportRow[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [script, setScript] = useState('');
  const [query, setQuery] = useState('');
  const [stock, setStock] = useState<Stock[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { job, run, busy } = useJobRunner();

  const load = () => {
    if (tab === 'exports') api.get<ExportRow[]>('/api/exports').then(setExports).catch(toastError);
    else if (tab === 'templates') api.get<Template[]>('/api/templates').then(setTemplates).catch(toastError);
    else api.get<Asset[]>(`/api/assets/${tab}`).then(setAssets).catch(toastError);
  };
  useEffect(() => { setAssets([]); load(); }, [tab]);

  async function add(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.append('file', f);
      await upload(`/api/assets/${tab}`, form).catch(toastError);
    }
    load();
  }

  async function speak() {
    try {
      await run(() => api.post('/api/tts', { text: script }));
      setScript('');
      toast('Voiceover added', 'good');
      load();
    } catch (e) { toastError(e); }
  }

  async function search() {
    try { setStock(await api.get<Stock[]>(`/api/stock/search?q=${encodeURIComponent(query)}`)); } catch (e) { toastError(e); }
  }

  const isAsset = tab !== 'exports' && tab !== 'templates';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <p>Finished shorts, plus the music, b-roll, sounds, logos and style templates the studio draws on.</p>
        </div>
      </div>
      <div className="tabs-line" role="tablist">
        {TABS.map((x) => <button key={x.value} role="tab" aria-selected={tab === x.value} className={tab === x.value ? 'on' : ''} onClick={() => setTab(x.value)}>{x.label}</button>)}
      </div>

      {tab === 'exports' && (
        <Panel title={`Exports (${exportsList.length})`} pad={false}>
          {exportsList.length === 0 ? <Empty title="No exports yet">Shorts you render in the studio appear here.</Empty> : (
            <div className="panel-body grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {exportsList.map((r) => (
                <div key={r.id} className="card">
                  <div className="thumb-wrap"><video className="thumb tall" src={r.file} poster={r.cover || undefined} controls preload="none" /></div>
                  <strong className="ellipsis" title={r.title}>{r.title}</strong>
                  <div className="small muted mono">{fmtDur(r.duration)} · {r.width}×{r.height} · {fmtBytes(r.size)}</div>
                  <div className="row between">
                    <span className={'pill cap ' + (r.status === 'approved' ? 'good' : r.status === 'posted' ? 'info' : 'muted')}>{r.status}</span>
                    <div className="row gap-s">
                      <a className="btn small" href={r.file} download>Download</a>
                      <Button variant="ghost" small icon="trash" aria-label="Delete export" onClick={async () => { if (confirm(`Delete "${r.title}"?`)) { await api.del(`/api/exports/${r.id}`).catch(toastError); load(); } }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {isAsset && (
        <Panel title={TABS.find((x) => x.value === tab)!.label} actions={<Button small icon="upload" onClick={() => fileRef.current?.click()}>Add files</Button>}>
          <p className="muted">{HINT[tab]}</p>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          {tab === 'voice' && (
            <div className="card">
              <Field label="Generate from a script" hint="Uses an online voice service (edge-tts); needs internet. Choose the voice in Settings.">
                <textarea rows={3} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Type the narration…" />
              </Field>
              <div className="row"><Button small icon="speaker" onClick={speak} busy={busy} disabled={!script.trim()}>Generate voiceover</Button></div>
              <JobBar job={job} />
            </div>
          )}
          {tab === 'broll' && (
            <div className="card">
              <Field label="Search stock footage (Pexels)" hint="Needs a free Pexels API key in Settings.">
                <div className="row">
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="coffee, city at night, typing…" />
                  <Button small icon="search" onClick={search} disabled={!query.trim()}>Search</Button>
                </div>
              </Field>
              {stock.length > 0 && (
                <div className="media-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                  {stock.map((s) => (
                    <button key={s.id} className="media-pick" style={{ aspectRatio: '9 / 16' }} title={`By ${s.credit} — click to add`}
                      onClick={async () => { try { await run(() => api.post('/api/stock/download', { url: s.url, name: `${query} ${s.id}` })); toast('Added to b-roll', 'good'); load(); } catch (e) { toastError(e); } }}>
                      <img src={s.thumb} alt="" loading="lazy" />
                      <span>{s.credit} · {s.duration}s</span>
                    </button>
                  ))}
                </div>
              )}
              <JobBar job={job} />
            </div>
          )}
          {assets.length === 0 ? <Empty icon={tab === 'music' || tab === 'sfx' || tab === 'voice' ? 'music' : 'image'} title="Nothing here yet" /> : (
            <div className="col gap-s">
              {assets.map((a) => (
                <div key={a.name} className="asset-row">
                  {a.type === 'image' || a.type === 'gif' ? <img className="asset-thumb" src={a.url} alt="" loading="lazy" />
                    : a.type === 'video' ? <video className="asset-thumb" src={a.url} muted preload="metadata" /> : null}
                  <div className="grow">
                    <div className="ellipsis">{a.label}</div>
                    <div className="small muted mono">{a.name} · {fmtBytes(a.size)}</div>
                  </div>
                  {a.type === 'audio' && <audio src={a.url} controls preload="none" style={{ height: 30, maxWidth: 240 }} />}
                  <Button variant="ghost" small icon="trash" aria-label={`Delete ${a.name}`} onClick={async () => { await api.del(`/api/assets/${tab}/${encodeURIComponent(a.name)}`).catch(toastError); load(); }} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === 'templates' && (
        <Panel title={`Templates (${templates.length})`}>
          <p className="muted">A template stores captions, look, brand, shape and frame rate. Save one from the editor's Style tab, then apply it to other clips or pick it when finding moments.</p>
          {templates.length === 0 ? <Empty icon="layers" title="No templates yet" /> : (
            <div className="col gap-s">
              {templates.map((x) => (
                <div key={x.id} className="asset-row">
                  <div className="asset-thumb" style={{ background: x.spec.brand?.accent ?? '#333' }} />
                  <div className="grow">
                    <div className="ellipsis">{x.name}</div>
                    <div className="small muted">{x.spec.captions?.preset ?? 'captions'} · {x.spec.captions?.font} · {x.spec.width}×{x.spec.height} · {x.spec.fps} fps</div>
                  </div>
                  <Button variant="ghost" small onClick={async () => { const name = prompt('Rename template', x.name); if (name?.trim()) { await api.put(`/api/templates/${x.id}`, { name: name.trim() }).catch(toastError); load(); } }}>Rename</Button>
                  <Button variant="ghost" small icon="trash" aria-label={`Delete ${x.name}`} onClick={async () => { await api.del(`/api/templates/${x.id}`).catch(toastError); load(); }} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
