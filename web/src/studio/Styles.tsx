// Styles manager: your own styles learned from reference videos, and the built-in ones.
import { ReactNode, useEffect, useState } from 'react';

import { api } from '../api';
import { go, useRoute } from '../App';
import { Button, Empty, Field, JobBar, Panel, Toggle, fmtDur, toast, toastError, useJobRunner } from '../ui';
import { StyleAnalysis, StyleProfile, StyleRule } from './types';
import { AiPicker, HowItWorks, MemoryPanel, ReferencesPanel, StudiesPanel } from './StyleRefs';

export default function Styles() {
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const route = useRoute();
  const [aiUse, setAiUse] = useState('');   // which AI studies and reviews on this page ('' = the usual one)
  // every style has its own page: #/styles/<id>
  const openId = route[0] === 'styles' ? route[1] ?? null : null;
  const setOpenId = (id: string | null) => go(id ? `styles/${id}` : 'styles');
  const [name, setName] = useState('');
  const [newRule, setNewRule] = useState('');
  const { job, run, busy } = useJobRunner();

  const load = () => api.get<StyleProfile[]>('/api/profiles').then(setStyles).catch(toastError);
  useEffect(() => { load(); }, []);
  const open = styles.find((x) => x.id === openId) ?? null;
  const mine = styles.filter((x) => !x.builtin);
  const builtin = styles.filter((x) => x.builtin);

  async function create(from?: StyleProfile) {
    const n = from ? prompt('Name your copy of this style:', `My ${from.name.toLowerCase()}`) : name;
    if (!n?.trim()) return;
    try {
      const p = await api.post<StyleProfile>('/api/profiles', { name: n.trim(), from: from?.id });
      setName('');
      await load();
      setOpenId(p.id);
    } catch (e) { toastError(e); }
  }

  async function analyse() {
    if (!open) return;
    if (open.copied_from && !confirm('Studying rebuilds this style\'s look (captions, colours, frame) and its learned rules from the reference videos, replacing what it copied from the built-in style. Your own rules are kept. Go ahead?')) return;
    try {
      const p = await run<StyleProfile>(() => api.post(`/api/profiles/${open.id}/analyse`, { use: aiUse }));
      await load();
      toast(p.note || `Style learned from ${p.references?.length ?? 0} reference${p.references?.length === 1 ? '' : 's'}`, p.note ? 'info' : 'good');
    } catch (e) { toastError(e); }
  }

  const saveRules = async (rules: StyleRule[]) => { if (open) { await api.put(`/api/profiles/${open.id}`, { rules }).catch(toastError); load(); } };
  const saveBrief = async (brief: string) => { if (open) await api.put(`/api/profiles/${open.id}`, { brief }).catch(toastError); };

  if (open) {
    const a = open.analysis;
    const fixed = !!open.builtin;
    return (
      <>
        <div className="row between wrap">
          <div>
            <button className="crumb" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setOpenId(null)}>← All styles</button>
            <h2>{open.name}{open.draft ? ' (draft)' : ''}</h2>
            <span className="small muted">{fixed ? 'Built-in style: its look is fixed, but its reference videos and what the AI remembers from them are yours.' : open.copied_from ? 'Your copy of a built-in style. Teach it, change its rules, add references.' : 'Your own style.'}</span>
          </div>
          <div className="row">
            {fixed ? <Button icon="copy" onClick={() => create(open)}>Copy to make it yours</Button>
              : <Button variant="danger" icon="trash" onClick={async () => { if (confirm(`Delete the style "${open.name}" and its references?`)) { await api.del(`/api/profiles/${open.id}`).catch(toastError); setOpenId(null); load(); } }}>Delete style</Button>}
          </div>
        </div>

        <AiPicker value={aiUse} onChange={setAiUse} />
        <ReferencesPanel style={open} reload={load} job={job} run={run} busy={busy} onStudy={!fixed ? analyse : undefined} />
        {!fixed && <StudiesPanel style={open} reload={load} />}
        <MemoryPanel style={open} reload={load} run={run} busy={busy} use={aiUse} />
        <HowItWorks style={open} />

        {(a || open.summary) && (
          <Panel title="What this style is">
            <p>{a?.summary || open.summary}</p>
            {a && <StyleReport a={a} />}
          </Panel>
        )}

        <Panel title="Brief for the AI">
          <textarea rows={4} defaultValue={open.brief} key={open.id + (open.analysed ?? '')} disabled={fixed} placeholder="One paragraph describing how videos in this style are made."
            onBlur={(e) => !fixed && e.target.value !== open.brief && saveBrief(e.target.value)} />
        </Panel>

        <Panel title={`Rules (${open.rules.filter((r) => r.on).length} active)`}>
          <p className="muted">Every AI request for a clip in this style carries the active rules. Corrections you teach in the editor land here.</p>
          {open.rules.length === 0 && <span className="small muted">No rules yet.</span>}
          {open.rules.map((r) => (
            <div key={r.id} className="asset-row" style={{ alignItems: 'flex-start' }}>
              {!fixed && <Toggle checked={r.on} onChange={(v) => saveRules(open.rules.map((x) => (x.id === r.id ? { ...x, on: v } : x)))} />}
              <div className="grow">
                {fixed ? <div>{r.text}</div> : <textarea rows={2} defaultValue={r.text} onBlur={(e) => e.target.value.trim() !== r.text && saveRules(open.rules.map((x) => (x.id === r.id ? { ...x, text: e.target.value.trim(), source: 'you' } : x)))} />}
                <div className="small faint">{r.kind} · from {r.source}</div>
              </div>
              {!fixed && <Button small variant="ghost" icon="trash" aria-label="Delete rule" onClick={() => saveRules(open.rules.filter((x) => x.id !== r.id))} />}
            </div>
          ))}
          {!fixed && (
            <div className="row">
              <input type="text" value={newRule} placeholder="Add a rule in your own words" onChange={(e) => setNewRule(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newRule.trim()) { saveRules([...open.rules, { id: '', kind: 'editing', text: newRule.trim(), source: 'you', on: true }]); setNewRule(''); } }} />
              <Button icon="plus" disabled={!newRule.trim()} onClick={() => { saveRules([...open.rules, { id: '', kind: 'editing', text: newRule.trim(), source: 'you', on: true }]); setNewRule(''); }}>Add</Button>
            </div>
          )}
        </Panel>
      </>
    );
  }

  return (
    <>
      <Panel title="Make your own style">
        <p className="muted">Name a style, add reference videos you like, and have the AI study them. The result is a look the editor can apply plus written rules you can read and edit. It learns from your corrections as you work.</p>
        <div className="row">
          <Field label="Name" grow><input type="text" value={name} placeholder="e.g. Street interviews" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} /></Field>
          <Button variant="primary" icon="plus" onClick={() => create()} disabled={!name.trim()} style={{ alignSelf: 'flex-end' }}>Create</Button>
        </div>
      </Panel>
      {mine.length > 0 && (
        <Panel title={`Your styles (${mine.length})`} pad={false}>
          <div className="panel-body grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {mine.map((x) => (
              <div key={x.id} className="card click" onClick={() => setOpenId(x.id)}>
                <strong>{x.name}</strong>
                <span className="small muted clamp-2">{x.analysis?.summary || x.summary || 'Not studied yet. Add reference videos.'}</span>
                <div className="row between small muted"><span>{x.references?.length ?? 0} references · {x.rules.filter((r) => r.on).length} rules</span><span className={'pill ' + (x.analysed ? 'good' : 'muted')}>{x.analysed ? 'Learned' : 'New'}</span></div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="Built-in styles" pad={false}>
        <div className="panel-body grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {builtin.map((x) => (
            <div key={x.id} className="card click" onClick={() => setOpenId(x.id)}>
              <div className="row between"><strong>{x.name}</strong>{x.draft && <span className="pill">Draft</span>}</div>
              <span className="small muted">{x.summary}</span>
              <span className="small faint">{x.style.width}×{x.style.height} · {x.style.fps} fps · {x.rules.length} rules</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c.trim());
const Swatch = ({ colour }: { colour: string }) => (isHex(colour) ? <span className="swatch" style={{ background: colour }} title={colour} /> : null);
const words = (s: string) => s.replace(/_/g, ' ');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="report-section"><h4>{title}</h4>{children}</div>;
}

/** Everything the AI reported about a set of references, in the order an editor would read it. */
function StyleReport({ a }: { a: StyleAnalysis }) {
  const sound = a.sound;
  const heard = sound && [sound.music, sound.effects, sound.voice].some((x) => x && !/cannot|unknown|stills/i.test(x));
  return (
    <div className="style-report">
      {a.confidence && (
        <div className="row wrap gap-s" aria-label="How sure the AI is">
          {Object.entries(a.confidence).map(([k, v]) => <span key={k} className={'pill conf-' + v} title={`Confidence in ${k}: ${v}`}>{k}: {v}</span>)}
        </div>
      )}
      {(a.canvas || a.picture || a.framing) && (
        <Section title="Format and framing">
          <div className="small">
            {a.canvas && <><b>{a.canvas}</b> canvas. </>}
            {a.picture && (a.picture.mode === 'panel'
              ? <>Picture in a {a.picture.corners} box about {Math.round(a.picture.box_width)}% wide, centred {Math.round(a.picture.box_position)}% down, over {a.picture.background === 'blur' ? 'a blurred copy' : 'black'}. </>
              : <>Picture fills the frame. </>)}
            {a.framing && <>Subject framed {words(a.framing.subject_size)}, {a.framing.subject_position}; camera {words(a.framing.movement)}. <span className="muted">{a.framing.note}</span></>}
          </div>
        </Section>
      )}
      {a.opening && <Section title="The first three seconds"><div className="small">{a.opening}</div></Section>}
      {a.text_styles && a.text_styles.length > 0 && (
        <Section title="On-screen text">
          <div className="report-cards">
            {a.text_styles.map((t, i) => (
              <div key={i} className="report-card">
                <div className="row between"><b>{words(t.role)}</b><span className="small faint mono">{t.nearest_font}</span></div>
                <div className="small">{t.lettering}{t.uppercase ? ', capitals' : ''}{t.italic ? ', italic' : ''}</div>
                <div className="row wrap gap-s small">
                  <span className="row gap-s"><Swatch colour={t.colour} /><span className="mono">{t.colour}</span></span>
                  {t.accents.map((x, j) => <span key={j} className="row gap-s" title={x.used_for}><Swatch colour={x.colour} /><span className="muted">{x.used_for}</span></span>)}
                </div>
                <div className="small muted">
                  {Math.round(t.position)}% down, {words(t.align)} · {t.height_pct.toFixed(1)}% tall · {t.lines} line{t.lines === 1 ? '' : 's'} of ~{t.words_per_line} words
                  {t.arrives !== 'unknown' && <> · arrives {words(t.arrives)}</>}{t.stays_seconds > 0 && <> · stays {t.stays_seconds.toFixed(1)}s</>}
                </div>
                <div className="small muted">
                  {[t.outline !== 'none' && `outline: ${t.outline}`, t.shadow_or_glow !== 'none' && `behind: ${t.shadow_or_glow}`, t.box !== 'none' && `box: ${t.box}`].filter(Boolean).join(' · ')}
                </div>
                <div className="small">{t.used_for}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {a.palette && a.palette.length > 0 && (
        <Section title="Colours">
          <div className="col gap-s">{a.palette.map((c, i) => <div key={i} className="row gap-s small"><Swatch colour={c.colour} /><span className="mono">{c.colour}</span><span className="muted">{c.meaning}</span></div>)}</div>
          {a.colour && <div className="small muted">Grade: brightness {a.colour.brightness.toFixed(2)}, contrast {a.colour.contrast.toFixed(2)}, saturation {a.colour.saturation.toFixed(2)}{a.colour.black_and_white ? ', black and white' : ''}{a.colour.vignette ? ', vignette' : ''}. {a.colour.note}</div>}
        </Section>
      )}
      {a.elements.length > 0 && (
        <Section title="Effects and graphics">
          <div className="col gap-s">{a.elements.map((e, i) => (
            <div key={i} className="small"><span className="pill">{words(e.type)}</span> <span>{e.how}</span>
              {e.when && <span className="muted"> — {e.when}{e.seconds ? `, about ${e.seconds.toFixed(1)}s` : ''}</span>}</div>
          ))}</div>
        </Section>
      )}
      {a.structure && a.structure.length > 0 && (
        <Section title="Story beats">
          <ol className="report-beats">{a.structure.map((b, i) => (
            <li key={i}><span className="mono faint">{fmtDur(b.from_seconds)}–{fmtDur(b.to_seconds)}</span> <b>{b.beat}</b> <span className="muted">{b.on_screen}</span></li>
          ))}</ol>
          {a.ending && <div className="small"><b>Ending:</b> {a.ending}</div>}
        </Section>
      )}
      {(a.pacing || a.transitions) && (
        <Section title="Pacing and transitions">
          {a.pacing && <div className="small">{a.pacing}</div>}
          {a.transitions && <div className="small muted">{a.transitions}</div>}
        </Section>
      )}
      {sound && (
        <Section title="Sound">
          {heard ? (
            <div className="col gap-s small">
              <div><b>Music:</b> {sound.music}</div>
              <div><b>Effects:</b> {sound.effects}</div>
              <div><b>Voice:</b> {sound.voice}{sound.words_per_minute ? ` (about ${Math.round(sound.words_per_minute)} words a minute)` : ''}</div>
            </div>
          ) : <div className="small muted">Not studied: sound is only heard when the whole videos are watched, which needs a Gemini key.</div>}
        </Section>
      )}
      {a.branding && <Section title="Branding placement"><div className="small">{a.branding}</div></Section>}
      {a.example_lines && a.example_lines.length > 0 && (
        <Section title="Lines quoted from the references">
          <div className="col gap-s">{a.example_lines.map((l, i) => <div key={i} className="small report-quote">{l}</div>)}</div>
        </Section>
      )}
      {a.timeline && a.timeline.length > 0 && (
        <details className="report-section">
          <summary><h4 style={{ display: 'inline' }}>Timeline ({a.timeline.length} moments)</h4></summary>
          <table className="report-table"><tbody>{a.timeline.map((t, i) => (
            <tr key={i}><td className="mono faint">#{t.reference}</td><td className="mono">{t.at_seconds.toFixed(1)}s</td><td><span className="pill">{t.kind}</span></td><td>{t.what}</td></tr>
          ))}</tbody></table>
        </details>
      )}
      {a.per_reference && a.per_reference.length > 0 && (
        <details className="report-section">
          <summary><h4 style={{ display: 'inline' }}>Notes on each reference</h4></summary>
          {a.per_reference.map((r, i) => <div key={i} className="small"><b>#{r.reference}</b> {r.notes}</div>)}
        </details>
      )}
      {a.varies.length > 0 && <div className="notice"><b>Varies between references:</b> {a.varies.join(' ')}</div>}
      {a.cannot_reproduce.length > 0 && <div className="notice warn"><b>Cannot be reproduced here:</b> {a.cannot_reproduce.join(' ')}</div>}
      {a.unsure.length > 0 && <div className="notice"><b>Could not tell:</b> {a.unsure.join(' ')}</div>}
    </div>
  );
}
