import { useEffect, useRef, useState } from 'react';

import { go } from '../App';
import { api, upload } from '../api';
import { Button, Empty, Field, Icon, JobBar, More, Panel, Seg, SimpleSwitch, fmtDur, fmtTime, toast, toastError, useJobRunner } from '../ui';
import { Clip, ClipKind, ExportAllResult, MomentsResult, Project, Score, StyleProfile, Template } from './types';

const KINDS: { value: ClipKind; label: string; hint: string }[] = [
  { value: 'highlights', label: 'Highlights', hint: 'The best standalone moments' },
  { value: 'series', label: 'Series', hint: 'Part 1, 2, 3… of one story' },
  { value: 'topic', label: 'Topic', hint: 'Every strong moment on one subject' },
  { value: 'recap', label: 'Recap', hint: 'One clip of the main points' },
  { value: 'trailer', label: 'Trailer', hint: 'One teaser that holds back the end' },
];
const LENGTHS = [
  { label: 'Auto', min: 15, max: 60 },
  { label: 'Short', min: 15, max: 30 },
  { label: 'Medium', min: 30, max: 60 },
  { label: 'Long', min: 60, max: 120 },
];
const LENGTH_NOTE: Record<ClipKind, string> = {
  highlights: 'Length of each clip.', series: 'Length of each part.', topic: 'Length of each clip.',
  recap: 'Length of the whole recap.', trailer: 'Length of the whole trailer.',
};

export function ScoreRing({ score }: { score: Score | null }) {
  if (!score) return <div className="score" style={{ ['--v' as any]: 0 }} title="Not scored"><span>–</span></div>;
  return <div className="score" style={{ ['--v' as any]: score.total }} title="Virality score out of 100"><span>{score.total}</span></div>;
}

function ScoreTiles({ score }: { score: Score }) {
  return (
    <div className="score-tiles">
      {(['hook', 'flow', 'value', 'trend'] as const).map((k) => (
        <div key={k} className="score-tile" title={`${k} score out of 100`}>
          <span>{k}</span>
          <b>{score[k]}<i>/100</i></b>
        </div>
      ))}
    </div>
  );
}

/** Seconds of source the clip keeps (a recap or trailer skips the gaps between its pieces). */
const keptSeconds = (c: Clip) => (c.spec.segments?.length ? c.spec.segments.reduce((t, s) => t + Math.max(0, s.end - s.start), 0) : c.spec.out - c.spec.in);

export function ProjectView({ project, reload }: { project: Project; reload: () => Promise<void> }) {
  const [picked, setPicked] = useState<string[]>([]);
  async function mergePicked() {
    try {
      const clip = await api.post<{ id: string; title: string }>(`/api/projects/${project.id}/clips/merge`, { ids: picked });
      setPicked([]);
      await reload();
      toast(`Merged into "${clip.title}"`, 'good');
    } catch (e) { toastError(e); }
  }
  const online = project.origin.startsWith('http');
  const [engine, setEngine] = useState<'whisper' | 'youtube'>('whisper');
  const [model, setModel] = useState('');
  const [language, setLanguage] = useState('');
  const [kind, setKind] = useState<ClipKind>('highlights');
  const [count, setCount] = useState(6);
  const [minLen, setMinLen] = useState(15);
  const [maxLen, setMaxLen] = useState(60);
  const [query, setQuery] = useState('');
  const [instructions, setInstructions] = useState('');
  const [pastPosts, setPastPosts] = useState(0);
  const [quality, setQuality] = useState<'1080' | '720'>('1080');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [styleId, setStyleId] = useState('');
  const [note, setNote] = useState('');
  const [range, setRange] = useState({ in: 0, out: Math.min(30, project.source.duration) });
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tx = useJobRunner();
  const mo = useJobRunner();
  const ex = useJobRunner();
  const words = project.transcript?.words.length ?? 0;

  useEffect(() => {
    api.get<Template[]>('/api/templates').then(setTemplates).catch(() => {});
    api.get<StyleProfile[]>('/api/profiles').then(setStyles).catch(() => {});
    api.get<{ posts: number }>(`/api/projects/${project.id}/moments/performance`).then((r) => setPastPosts(r.posts)).catch(() => {});
  }, [project.id]);

  async function transcribe() {
    try {
      const r = await tx.run<{ words: number; engine: string }>(() =>
        api.post(`/api/projects/${project.id}/transcribe`, { engine, model: model || undefined, language: language || undefined }));
      toast(`Transcribed ${r.words} words`, 'good');
      await reload();
    } catch (e) { toastError(e); }
  }

  async function importTranscript(file: File) {
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await upload<{ words: number }>(`/api/projects/${project.id}/transcript`, form);
      toast(`Imported ${r.words} words`, 'good');
      await reload();
    } catch (e) { toastError(e); }
  }

  const single = kind === 'recap' || kind === 'trailer';
  const preset = LENGTHS.find((l) => l.min === minLen && l.max === maxLen);

  async function findMoments() {
    if (kind === 'topic' && !query.trim()) { toast('Type the topic to look for', 'info'); return; }
    try {
      const r = await mo.run<MomentsResult>(() =>
        api.post(`/api/projects/${project.id}/moments`, {
          kind, count: single ? 1 : count, min_len: minLen, max_len: maxLen, query: kind === 'series' ? '' : query, instructions,
          template_id: templateId || undefined, profile_id: styleId || undefined,
        }));
      setNote(r.note);
      setPastPosts(r.performance_posts);
      const what = kind === 'series' ? 'part' : 'moment';
      toast(r.added ? (single ? `Made the ${kind}` : `Found ${r.added} ${what}${r.added === 1 ? '' : 's'}`) : 'No matching moments found', r.added ? 'good' : 'info');
      await reload();
    } catch (e) { toastError(e); }
  }

  async function addManual() {
    try {
      const clip = await api.post<Clip>(`/api/projects/${project.id}/clips`, { in: range.in, out: range.out, title: 'Manual clip', template_id: templateId || undefined });
      await reload();
      go(`studio/${project.id}/${clip.id}`);
    } catch (e) { toastError(e); }
  }

  async function exportAll() {
    try {
      const r = await ex.run<ExportAllResult>(() => api.post(`/api/projects/${project.id}/render-all`, { quality }));
      const total = r.exported.length + r.failed.length;
      toast(`Exported ${r.exported.length} of ${total} clip${total === 1 ? '' : 's'}`, r.failed.length ? 'info' : 'good');
      for (const f of r.failed) toast(`${f.title}: ${f.error}`, 'bad');
    } catch (e) { toastError(e); }
  }

  const sorted = [...project.clips].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1) || a.spec.in - b.spec.in);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <a href="#/studio" className="crumb"><Icon name="back" size={13} /> All projects</a>
          <h1 className="ellipsis" title={project.name}>{project.name}</h1>
          <p>{fmtDur(project.source.duration)} · {project.source.width}×{project.source.height} · {Math.round(project.source.fps)} fps{online ? <> · <a href={project.origin} target="_blank" rel="noreferrer">source</a></> : null}</p>
        </div>
        <SimpleSwitch />
      </div>

      <div className="project-grid">
        <div className="col gap-l">
      <Panel title="Source video">
          <div className="col gap-l">
            <video ref={videoRef} className="source-video" src={project.source.url} poster={project.source.poster || undefined} controls preload="metadata" />
            <More title="Make a clip by hand">
            <div className="col">
              <span className="small muted">Mark a clip yourself: play to a spot and set the start and end.</span>
              <div className="grid-2">
                <Field label="Start">
                  <div className="row">
                    <input className="mono" type="text" value={fmtTime(range.in, true)} readOnly />
                    <Button small onClick={() => setRange((r) => ({ ...r, in: Math.min(videoRef.current?.currentTime ?? 0, r.out - 1) }))}>Set at playhead</Button>
                  </div>
                </Field>
                <Field label="End">
                  <div className="row">
                    <input className="mono" type="text" value={fmtTime(range.out, true)} readOnly />
                    <Button small onClick={() => setRange((r) => ({ ...r, out: Math.max(videoRef.current?.currentTime ?? 0, r.in + 1) }))}>Set at playhead</Button>
                  </div>
                </Field>
              </div>
              <div className="row">
                <Button icon="plus" onClick={addManual}>Create clip ({fmtDur(range.out - range.in)})</Button>
              </div>
            </div>
            </More>
          </div>
        </Panel>
        </div>
        <div className="col gap-l">
        <Panel title={<><span className={'step-num' + (words ? ' done' : '')}>1</span>Transcript</>} actions={words ? <a className="btn small ghost" href={`/api/projects/${project.id}/transcript.srt`} download={`${project.name}.srt`}>Download SRT</a> : null}>
            <div className="row between">
              <span className={'pill ' + (words ? 'good' : 'muted')}>{words ? `${words.toLocaleString()} words · ${project.transcript!.engine}` : 'Not transcribed yet'}</span>
            </div>
            <More title={words ? 'Transcribe again or import a file' : 'How to transcribe'} open={!words}>
            <Seg value={engine} onChange={setEngine} options={[
              { value: 'whisper', label: 'Whisper (on this computer)' },
              { value: 'youtube', label: 'Captions from the site', title: 'Uses the video\'s own word-timed captions; instant, needs a link import' },
            ]} />
            {engine === 'whisper' ? (
              <div className="grid-2">
                <Field label="Model" hint="Bigger is more accurate and slower.">
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">Default (from Settings)</option>
                    {['tiny', 'base', 'small', 'medium', 'large-v3'].map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Language" hint="Leave empty to detect.">
                  <input type="text" placeholder="en" value={language} onChange={(e) => setLanguage(e.target.value)} />
                </Field>
              </div>
            ) : !online ? <div className="notice">This project came from a file, so there are no online captions. Use Whisper or import a file.</div> : null}
            <div className="row wrap">
              <Button variant="primary" icon="type" onClick={transcribe} busy={tx.busy} disabled={engine === 'youtube' && !online}>{words ? 'Transcribe again' : 'Transcribe'}</Button>
              <Button icon="upload" onClick={() => fileRef.current?.click()}>Import SRT / VTT / JSON</Button>
              <input ref={fileRef} type="file" accept=".srt,.vtt,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importTranscript(f); e.target.value = ''; }} />
            </div>
            </More>
            <JobBar job={tx.job} />
          </Panel>

          <Panel title={<><span className={'step-num' + (project.clips.length ? ' done' : '')}>2</span>Make clips</>}>
            <Field label="Style" hint={styleId ? 'The clips get this style\'s look, and the AI follows its rules.' : 'Pick the style these clips should have; it sets the look and the AI\'s rules.'}>
              <select value={styleId ? styleId : templateId ? `tpl:${templateId}` : ''} onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith('tpl:')) { setTemplateId(v.slice(4)); setStyleId(''); } else { setStyleId(v); setTemplateId(''); }
              }}>
                <option value="">Default look</option>
                <optgroup label="Built-in styles">{styles.filter((x) => x.builtin).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                {styles.filter((x) => !x.builtin).length > 0 && <optgroup label="Your styles">{styles.filter((x) => !x.builtin).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
                {templates.length > 0 && <optgroup label="Saved templates">{templates.map((t) => <option key={t.id} value={`tpl:${t.id}`}>{t.name}</option>)}</optgroup>}
              </select>
            </Field>
            <Field label="What to make">
              <div className="chips" role="radiogroup" aria-label="What to make">
                {KINDS.map((k) => (
                  <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} className={'chip' + (kind === k.value ? ' on' : '')} onClick={() => setKind(k.value)}>
                    {k.label}<small>{k.hint}</small>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Length" hint={LENGTH_NOTE[kind]}>
              <div className="chips" role="radiogroup" aria-label="Length">
                {LENGTHS.map((l) => (
                  <button key={l.label} type="button" role="radio" aria-checked={preset === l} className={'chip' + (preset === l ? ' on' : '')} onClick={() => { setMinLen(l.min); setMaxLen(l.max); }}>
                    {l.label}<small>{l.min}–{l.max} s</small>
                  </button>
                ))}
                {!preset && <span className="chip on">Custom<small>{minLen}–{maxLen} s</small></span>}
              </div>
            </Field>
            {kind === 'topic' && (
              <Field label="Topic">
                <input type="text" placeholder="e.g. sleep and caffeine" value={query} onChange={(e) => setQuery(e.target.value)} />
              </Field>
            )}
            <More title="More options: how many, exact lengths, a specific part">
            <div className={single ? 'grid-2' : 'grid-3'}>
              {!single && <Field label={kind === 'series' ? 'Most parts' : 'How many'}><input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>}
              <Field label="Min seconds"><input type="number" min={5} max={170} value={minLen} onChange={(e) => setMinLen(Number(e.target.value))} /></Field>
              <Field label="Max seconds"><input type="number" min={10} max={180} value={maxLen} onChange={(e) => setMaxLen(Number(e.target.value))} /></Field>
            </div>
            {kind !== 'topic' && kind !== 'series' && (
              <Field label={single ? 'Focus on something? (optional)' : 'Looking for something specific? (optional)'}>
                <input type="text" placeholder="e.g. the part about sleep and caffeine" value={query} onChange={(e) => setQuery(e.target.value)} />
              </Field>
            )}
            </More>
            <Field label="Anything the AI should know? (optional)" hint="In your own words: what to focus on, what to skip, how it should end.">
              <textarea rows={2} placeholder="e.g. keep it light, skip the intro, end on the tip" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </Field>
            <div className="row">
              <Button variant="primary" icon="sparkle" onClick={findMoments} busy={mo.busy} disabled={!words}>
                {kind === 'series' ? 'Make the series' : kind === 'recap' ? 'Make the recap' : kind === 'trailer' ? 'Make the trailer' : 'Find moments'}
              </Button>
              {!words && <span className="small muted">Needs a transcript first.</span>}
            </div>
            {pastPosts > 0 && <span className="small muted">Using the views of {pastPosts} posted clip{pastPosts === 1 ? '' : 's'}.</span>}
            {note && <div className="notice">{note}</div>}
            <JobBar job={mo.job} />
          </Panel>
        </div>
      </div>

      <Panel title={<><span className="step-num">3</span>{`Edit and export your clips (${project.clips.length})`}</>} pad={false}
        actions={project.clips.length ? <>
          {picked.length > 0 && (
            <>
              <span className="small muted">{picked.length} selected</span>
              <Button small icon="plus" disabled={picked.length < 2} onClick={mergePicked}
                title="One new clip playing the selected clips one after another, in the order they come in the video. The clips stay as they are.">Merge into one clip</Button>
              <Button small variant="ghost" onClick={() => setPicked([])}>Clear</Button>
            </>
          )}
          <Seg small value={quality} onChange={setQuality} options={[{ value: '1080', label: '1080p' }, { value: '720', label: '720p' }]} />
          <Button small icon="download" onClick={exportAll} busy={ex.busy}>Export all clips</Button>
        </> : null}>
        {ex.job && <div className="panel-body"><JobBar job={ex.job} /></div>}
        {sorted.length === 0 ? <Empty icon="sparkle" title="No clips yet">Find moments automatically, or mark one yourself above.</Empty> : (
          <div className="panel-body grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {sorted.map((c) => (
              <div key={c.id} className={'card clip-card' + (picked.includes(c.id) ? ' picked' : '')}>
                <div className="row top">
                  <input type="checkbox" className="clip-pick" checked={picked.includes(c.id)} aria-label={`Select ${c.title}`}
                    title="Select to merge" onChange={(e) => setPicked((x) => (e.target.checked ? [...x, c.id] : x.filter((i) => i !== c.id)))} />
                  <ScoreRing score={c.score} />
                  <div className="grow">
                    <h4>{c.title}</h4>
                    <div className="small muted mono">{fmtTime(c.spec.in)} – {fmtTime(c.spec.out)} · {fmtDur(keptSeconds(c))}{(c.kind === 'recap' || c.kind === 'trailer') ? ` · ${c.kind}` : ''}</div>
                  </div>
                  <span className={'pill cap ' + (c.status === 'approved' ? 'good' : c.status === 'posted' ? 'info' : 'muted')}>{c.status}</span>
                </div>
                {c.score && <ScoreTiles score={c.score} />}
                {c.reason && <p className="small muted clamp-2" title={c.reason}>{c.reason}</p>}
                <div className="row" style={{ marginTop: 'auto' }}>
                  <Button variant="primary" small icon="film" onClick={() => go(`studio/${project.id}/${c.id}`)}>Open editor</Button>
                  <span className="spacer" />
                  <Button variant="ghost" small icon="copy" aria-label="Duplicate clip" title="Duplicate" onClick={async () => { await api.post(`/api/projects/${project.id}/clips/${c.id}/duplicate`).catch(toastError); reload(); }} />
                  <Button variant="ghost" small icon="trash" aria-label="Delete clip" title="Delete" onClick={async () => { if (confirm(`Delete "${c.title}"?`)) { await api.del(`/api/projects/${project.id}/clips/${c.id}`).catch(toastError); reload(); } }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
