import './clipper.css';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { go } from '../App';
import { api, upload, waitJob } from '../api';
import {
  Button, Empty, Field, Icon, JobBar, Panel, Seg, Toggle, fmtBytes, fmtDur, fmtNum, fmtTime, toast, toastError,
  useJobRunner,
} from '../ui';

/* ---------- types ---------- */
type Quality = { height: number; fps: number; actual: number };
type Source = {
  kind: 'video' | 'local';
  source: string;
  origin: string;
  title: string;
  uploader: string;
  view_count: number | null;
  duration: number;
  thumbnail: string;
  youtube_id: string | null;
  width: number;
  height: number;
  fps: number;
  has_video: boolean;
  has_audio: boolean;
  qualities: Quality[];
  subtitle_langs: string[];
  auto_caption_langs: string[];
};
type PlaylistEntry = { id: string; url: string; title: string; duration: number; thumbnail: string };
type Playlist = { kind: 'playlist'; title: string; url: string; entries: PlaylistEntry[] };
type ClipRange = { id: number; name: string; start: number; end: number };
type Fmt = 'mp4' | 'mov' | 'mp3' | 'm4a' | 'gif' | 'frames';
type Aspect = 'original' | '9:16' | '1:1' | '4:5' | '16:9';
type Options = {
  format: Fmt;
  quality: number | null;
  aspect: Aspect;
  mode: 'accurate' | 'fast';
  subtitles: boolean;
  subLang: string;
  gifFps: number;
  framesFps: number | null;
};
type Row = {
  id: string;
  created: number;
  title: string;
  file: string;
  format: Fmt;
  duration: number;
  width: number;
  height: number;
  size: number;
  source_origin: string;
  source_in: number;
  source_out: number;
  thumb?: string;
  subtitles?: string[];
  copied_to?: string | null;
  warnings?: string[];
  frames?: number | null;
};
type SaveResult = { items: Row[]; errors: { source: string; name: string; error: string }[] };

const FORMATS: { id: Fmt; label: string; note: string }[] = [
  { id: 'mp4', label: 'MP4', note: 'Video · plays everywhere' },
  { id: 'mov', label: 'MOV', note: 'Video · iPhone and Mac' },
  { id: 'mp3', label: 'MP3', note: 'Audio only' },
  { id: 'm4a', label: 'M4A', note: 'Audio · no re-encode when possible' },
  { id: 'gif', label: 'GIF', note: 'Animated, no sound' },
  { id: 'frames', label: 'PNG frames', note: 'Image sequence in a zip' },
];
const ASPECT_RATIO: Record<Aspect, number | null> = { original: null, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9 };
const ALL_QUALITIES = [2160, 1440, 1080, 720, 480, 360];
const isAudio = (f: Fmt) => f === 'mp3' || f === 'm4a';
const extOf = (f: Fmt) => (f === 'frames' ? 'zip' : f);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const qLabel = (h: number) => (h === 2160 ? '4K' : `${h}p`);
const fmtLen = (s: number) => (s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)}s` : fmtDur(s));

/** Same maths as server/clipper_core.output_dims. */
function outputDims(w: number, h: number, aspect: Aspect, quality: number | null, format: Fmt): [number, number] {
  if (!w || !h) return [0, 0];
  if (format === 'gif') quality = Math.min(quality ?? 480, 480);
  const ratio = ASPECT_RATIO[aspect];
  let cw = even(w);
  let ch = even(h);
  if (ratio) {
    if (w / h > ratio) cw = even(h * ratio);
    else ch = even(w / ratio);
  }
  const short = Math.min(cw, ch);
  if (quality && short > quality * 1.02) {
    const r = ratio ?? cw / ch;
    return r <= 1 ? [even(quality), even(Math.round(quality / r))] : [even(Math.round(quality * r)), even(quality)];
  }
  return [cw, ch];
}

/* ---------- small controls ---------- */
function TimeBoxes({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  const split = (v: number) => {
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    const s = Number((v - h * 3600 - m * 60).toFixed(2));
    return { h: String(h), m: String(m).padStart(2, '0'), s: s < 10 ? '0' + s : String(s) };
  };
  const [draft, setDraft] = useState(split(value));
  useEffect(() => setDraft(split(value)), [value]);
  const commit = () => {
    const total = (parseFloat(draft.h) || 0) * 3600 + (parseFloat(draft.m) || 0) * 60 + (parseFloat(draft.s) || 0);
    const next = clamp(total, 0, max);
    if (Math.abs(next - value) > 0.004) onChange(next);
    else setDraft(split(value));
  };
  const box = (key: 'h' | 'm' | 's', name: string) => (
    <input
      type="text" inputMode="decimal" className={key === 's' ? 'secs' : ''} aria-label={`${label} ${name}`}
      value={draft[key]} onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/[^0-9.]/g, '') })}
      onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
  return (
    <div className="timeboxes">
      {box('h', 'hours')}<i>:</i>{box('m', 'minutes')}<i>:</i>{box('s', 'seconds')}
    </div>
  );
}

function RangeSlider({ max, start, end, step, onChange, playhead, others }: {
  max: number; start: number; end: number; step: number;
  onChange: (start: number, end: number, which: 'start' | 'end') => void;
  playhead?: number | null; others?: { start: number; end: number }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<'start' | 'end' | null>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const gap = Math.max(step, 0.1);
  const pct = (v: number) => (max > 0 ? clamp(v / max, 0, 1) * 100 : 0);
  const snap = (v: number) => Number((Math.round(v / step) * step).toFixed(3));
  const move = (which: 'start' | 'end', v: number) => {
    if (which === 'start') onChange(clamp(snap(v), 0, end - gap), end, 'start');
    else onChange(start, clamp(snap(v), start + gap, max), 'end');
  };
  const valueAt = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp((x - r.left) / r.width, 0, 1) * max;
  };
  const down = (e: React.PointerEvent) => {
    if (max <= 0) return;
    const v = valueAt(e.clientX);
    const hit = (e.target as HTMLElement).dataset.thumb as 'start' | 'end' | undefined;
    const which = hit ?? (Math.abs(v - start) <= Math.abs(v - end) ? 'start' : 'end');
    drag.current = which;
    setDragging(which);
    ref.current!.setPointerCapture(e.pointerId);
    if (!hit) move(which, v);
  };
  const up = () => {
    drag.current = null;
    setDragging(null);
  };
  const key = (which: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? 1 : step;
    const delta = { ArrowLeft: -big, ArrowRight: big, PageDown: -10, PageUp: 10 }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    move(which, (which === 'start' ? start : end) + delta);
  };
  const thumb = (which: 'start' | 'end', v: number) => (
    <button
      type="button" data-thumb={which} className={'range-thumb' + (dragging === which ? ' drag' : '')}
      style={{ left: `${pct(v)}%` }} role="slider" aria-label={which === 'start' ? 'Clip start' : 'Clip end'}
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={v} aria-valuetext={fmtTime(v, true)} onKeyDown={key(which)}
    />
  );
  return (
    <div>
      <div className="range" ref={ref} onPointerDown={down} onPointerUp={up} onPointerCancel={up}
        onPointerMove={(e) => drag.current && move(drag.current, valueAt(e.clientX))}>
        <div className="range-track" />
        {others?.map((o, i) => (
          <div key={i} className="range-other" style={{ left: `${pct(o.start)}%`, width: `${pct(o.end) - pct(o.start)}%` }} />
        ))}
        <div className="range-fill" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />
        {playhead != null && <div className="range-playhead" style={{ left: `${pct(playhead)}%` }} />}
        {thumb('start', start)}
        {thumb('end', end)}
      </div>
      <div className="range-ends"><span>0:00</span><span>{fmtTime(max)}</span></div>
    </div>
  );
}

function OptLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="opt-line">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** Format, quality, framing and cut mode. Shared by single and batch. */
function OutputOptions({ opts, set, qualities, isUrl, hasVideo, dims }: {
  opts: Options; set: (patch: Partial<Options>) => void; qualities: Quality[] | null; isUrl: boolean; hasVideo: boolean;
  dims?: [number, number] | null;
}) {
  const audio = isAudio(opts.format);
  const qOptions = qualities
    ? [...qualities].reverse().map((q) => ({
        value: q.height,
        label: <>{qLabel(q.height)}{q.fps ? <span className="q-fps">{Math.round(q.fps)} fps</span> : null}</>,
        title: q.actual !== q.height ? `Source is ${q.actual}p` : undefined,
      }))
    : ALL_QUALITIES.map((h) => ({ value: h, label: <>{qLabel(h)}</>, title: undefined }));
  const cropOrResize = opts.aspect !== 'original' || (dims != null && qualities != null && opts.quality != null
    && opts.quality < Math.max(...qualities.map((q) => q.height)));
  return (
    <>
      <Panel title="Format">
        <div className="fmt-grid">
          {FORMATS.map((f) => {
            const off = !hasVideo && !isAudio(f.id);
            return (
              <button key={f.id} type="button" disabled={off} aria-pressed={opts.format === f.id}
                className={'fmt-card' + (opts.format === f.id ? ' on' : '')} onClick={() => set({ format: f.id })}>
                <b>{f.label}</b>
                <span>{off ? 'Source has no video' : f.note}</span>
              </button>
            );
          })}
        </div>
        {opts.format === 'gif' && (
          <OptLine label="GIF">
            <Seg small value={opts.gifFps} onChange={(v) => set({ gifFps: v })}
              options={[8, 12, 15, 24].map((v) => ({ value: v, label: `${v} fps` }))} />
            <span className="small muted">GIFs are capped at 480p. Long clips get large.</span>
          </OptLine>
        )}
        {opts.format === 'frames' && (
          <OptLine label="Frames">
            <Seg small value={opts.framesFps ?? 0} onChange={(v) => set({ framesFps: v || null })}
              options={[{ value: 0, label: 'Every frame' }, ...[1, 5, 10].map((v) => ({ value: v, label: `${v} per second` }))]} />
            <span className="small muted">Up to 3,000 frames per clip.</span>
          </OptLine>
        )}
      </Panel>

      {!audio && (
        <Panel title="Quality and framing">
          <OptLine label="Quality">
            {qOptions.length ? (
              <Seg value={opts.quality ?? qOptions[0].value} onChange={(v) => set({ quality: v })} options={qOptions} />
            ) : (
              <span className="muted small">Source quality (no other sizes reported)</span>
            )}
          </OptLine>
          {!qualities && <span className="small muted">Each video is limited to the best quality it actually has.</span>}
          <OptLine label="Aspect">
            <Seg value={opts.aspect} onChange={(v) => set({ aspect: v })}
              options={(['original', '9:16', '1:1', '4:5', '16:9'] as Aspect[]).map((a) => ({
                value: a, label: a === 'original' ? 'Original' : a, title: a === 'original' ? undefined : 'Centre crop',
              }))} />
          </OptLine>
          {(opts.format === 'mp4' || opts.format === 'mov') && (
            <>
              <OptLine label="Cut">
                <Seg value={opts.mode} onChange={(v) => set({ mode: v })}
                  options={[{ value: 'accurate', label: 'Frame-accurate' }, { value: 'fast', label: 'Fast' }]} />
              </OptLine>
              <span className="small muted">
                {opts.mode === 'accurate'
                  ? `Cuts on the exact frames. The clip is re-encoded${isUrl ? ' while it downloads' : ''}, which takes longer.`
                  : cropOrResize
                    ? 'A crop or resize always re-encodes, so this is cut on exact frames here as well.'
                    : 'Copies the original streams without re-encoding. The clip starts on the nearest earlier keyframe, which can be a few seconds before your start.'}
              </span>
            </>
          )}
          {dims && dims[0] > 0 && (
            <span className="small muted">Output size <span className="mono">{dims[0]} × {dims[1]}</span></span>
          )}
        </Panel>
      )}
    </>
  );
}

/* ---------- page ---------- */
export default function Clipper() {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [clips, setClips] = useState<ClipRange[]>([]);
  const [active, setActive] = useState(0);
  const [opts, setOpts] = useState<Options>({
    format: 'mp4', quality: 1080, aspect: 'original', mode: 'accurate', subtitles: false, subLang: 'en', gifFps: 12, framesFps: null,
  });
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [ytPreview, setYtPreview] = useState({ start: 0, end: 0, n: 0 });
  const [results, setResults] = useState<SaveResult | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [batchText, setBatchText] = useState('');
  const [batchWhole, setBatchWhole] = useState(true);
  const [batchRange, setBatchRange] = useState({ start: 0, end: 60 });
  const runner = useJobRunner();
  const video = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stopAt = useRef<number | null>(null);
  const nextId = useRef(1);

  const patch = (p: Partial<Options>) => setOpts((o) => ({ ...o, ...p }));
  const refreshHistory = useCallback(() => {
    api.get<Row[]>('/api/clipper/history').then(setHistory).catch(() => {});
  }, []);
  useEffect(refreshHistory, [refreshHistory]);

  /* --- source --- */
  function adopt(src: Source) {
    setSource(src);
    setPlaylist(null);
    setResults(null);
    setPlayhead(null);
    setYtPreview({ start: 0, end: 0, n: 0 });
    const end = src.duration > 0 ? Math.min(src.duration, 60) : 60;
    setClips([{ id: nextId.current++, name: src.title, start: 0, end }]);
    setActive(0);
    const heights = src.qualities.map((q) => q.height);
    const best = heights.length ? Math.max(...heights) : null;
    // URLs default to 1080p at most so a 4K download is a deliberate choice
    const quality = best == null ? null : src.kind === 'video' ? Math.max(...heights.filter((h) => h <= 1080), heights[0]) : best;
    setOpts((o) => ({
      ...o, quality,
      format: !src.has_video && !isAudio(o.format) ? 'mp3' : o.format,
      subtitles: src.kind === 'video' ? o.subtitles : false,
    }));
  }

  async function fetchInfo(target = url) {
    const u = target.trim();
    if (!u) return;
    setFetching(true);
    try {
      const info = await api.post<Source | Playlist>('/api/clipper/info', { url: u });
      if (info.kind === 'playlist') {
        setPlaylist(info);
        setPicked(new Set());
        setSource(null);
      } else adopt(info);
    } catch (e) {
      toastError(e);
    } finally {
      setFetching(false);
    }
  }

  async function uploadFile(file: File | undefined | null) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setUploadPct(0);
    try {
      adopt(await upload<Source>('/api/clipper/upload', form, setUploadPct));
      setUrl('');
    } catch (e) {
      toastError(e);
    } finally {
      setUploadPct(null);
    }
  }

  /* --- clips --- */
  const clip = clips[active] ?? clips[0];
  const duration = source?.duration ?? 0;
  const maxTime = duration > 0 ? duration : 24 * 3600;
  const step = source?.kind === 'local' && source.fps > 0 ? 1 / source.fps : duration > 1200 ? 1 : 0.1;

  function setRange(start: number, end: number, which?: 'start' | 'end') {
    setClips((cs) => cs.map((c, i) => (i === active ? { ...c, start, end } : c)));
    if (which && video.current) {
      stopAt.current = null;
      video.current.pause();
      video.current.currentTime = which === 'start' ? start : end;
    }
  }
  const setName = (i: number, name: string) => setClips((cs) => cs.map((c, j) => (j === i ? { ...c, name } : c)));
  function addClip() {
    const last = clips[clips.length - 1];
    const start = duration > 0 ? Math.min(last.end, Math.max(0, duration - 1)) : last.end;
    const end = duration > 0 ? Math.min(duration, start + 30) : start + 30;
    setClips([...clips, { id: nextId.current++, name: `${source?.title ?? 'clip'} ${clips.length + 1}`, start, end }]);
    setActive(clips.length);
  }
  function removeClip(i: number) {
    setClips(clips.filter((_, j) => j !== i));
    setActive((a) => Math.max(0, a > i || a === clips.length - 1 ? a - 1 : a));
  }

  /* --- local preview --- */
  const frame = source && source.fps > 0 ? 1 / source.fps : 1 / 30;
  const stepFrame = (n: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = clamp(v.currentTime + n * frame, 0, duration);
  };
  const playSelection = () => {
    const v = video.current;
    if (!v || !clip) return;
    v.currentTime = clip.start;
    stopAt.current = clip.end;
    void v.play();
  };
  const onTime = () => {
    const v = video.current;
    if (!v) return;
    setPlayhead(v.currentTime);
    if (stopAt.current != null && v.currentTime >= stopAt.current) {
      v.pause();
      stopAt.current = null;
    }
  };

  /* --- save --- */
  async function save(body: Record<string, unknown>) {
    setResults(null);
    try {
      const res = await runner.run<SaveResult>(() => api.post('/api/clipper/save', {
        format: opts.format, quality: isAudio(opts.format) ? null : opts.quality, aspect: isAudio(opts.format) ? 'original' : opts.aspect,
        mode: opts.mode, subtitles: opts.subtitles, sub_lang: opts.subLang || 'en', gif_fps: opts.gifFps, frames_fps: opts.framesFps,
        ...body,
      }));
      setResults(res);
      refreshHistory();
      if (res.items.length) toast(res.items.length === 1 ? `Saved ${res.items[0].title}.${extOf(res.items[0].format)}` : `Saved ${res.items.length} clips`, 'good');
      if (res.errors.length) toast(`${res.errors.length} failed: ${res.errors[0].error}`, 'bad');
    } catch (e) {
      toastError(e);
    }
  }
  const saveSingle = () => source && save({
    sources: [source.source],
    titles: { [source.source]: source.title },
    clips: clips.map((c) => ({ start: c.start, end: c.end, name: c.name.trim() })),
  });
  const batchUrls = useMemo(
    () => Array.from(new Set(batchText.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)))),
    [batchText],
  );
  const saveBatch = () => save({
    sources: batchUrls,
    clips: [batchWhole ? { name: '' } : { start: batchRange.start, end: batchRange.end, name: '' }],
  });

  async function sendToStudio(row: Row) {
    setSending(row.id);
    try {
      const { job_id } = await api.post<{ job_id: string }>('/api/projects', { media_url: row.file, name: row.title });
      const res = await waitJob<{ project_id: string }>(job_id);
      go('studio/' + res.project_id);
    } catch (e) {
      toastError(e);
    } finally {
      setSending(null);
    }
  }
  async function removeRow(row: Row) {
    try {
      await api.del(`/api/clipper/history/${row.id}`);
      setHistory((h) => h.filter((r) => r.id !== row.id));
    } catch (e) {
      toastError(e);
    }
  }

  const dims = source && source.has_video && !isAudio(opts.format)
    ? outputDims(source.width, source.height, opts.aspect, opts.quality, opts.format) : null;
  const selected = clip ? clip.end - clip.start : 0;
  const total = clips.reduce((n, c) => n + (c.end - c.start), 0);
  const invalid = clips.some((c) => c.end - c.start < 0.03);

  const saveBox = (count: number, onSave: () => void, disabled: boolean, extra?: ReactNode) => (
    <Panel title="Save">
      {extra}
      <Button variant="primary" icon="download" className="block" onClick={onSave} disabled={disabled || runner.busy} busy={runner.busy}>
        {count > 1 ? `Save ${count} clips` : 'Save clip'}
      </Button>
      <JobBar job={runner.job} />
      {results && (results.items.length > 0 || results.errors.length > 0) && (
        <div className="result-list">
          {results.items.map((r) => (
            <div key={r.id} className="result-item">
              <Icon name="check" />
              <div className="grow">
                <div className="ellipsis">{r.title}.{extOf(r.format)} <span className="muted">· {fmtBytes(r.size)}</span></div>
                {r.copied_to && <div className="small muted ellipsis">Copied to {r.copied_to}</div>}
                {r.subtitles && r.subtitles.length > 0 && <div className="small muted">Subtitles saved (SRT and TXT)</div>}
                {r.warnings?.map((w, i) => <div key={i} className="small" style={{ color: 'var(--accent)' }}>{w}</div>)}
              </div>
              <a className="btn small" href={r.file} download>Download</a>
            </div>
          ))}
          {results.errors.map((e, i) => (
            <div key={i} className="notice bad"><b>{e.name}</b>: {e.error}</div>
          ))}
        </div>
      )}
    </Panel>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clipper</h1>
          <p>Cut a section out of a video and save it in the format you need.</p>
        </div>
        <Seg value={mode} onChange={setMode} options={[{ value: 'single', label: 'One video' }, { value: 'batch', label: 'Batch of URLs' }]} />
      </div>

      {mode === 'single' && (
        <>
          <Panel title="Source">
            <div className="clip-source-row">
              <input type="url" placeholder="Paste a video or playlist URL" value={url} aria-label="Video URL"
                onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchInfo()} />
              <Button variant="primary" icon="search" onClick={() => fetchInfo()} busy={fetching} disabled={!url.trim()}>Fetch</Button>
              <Button icon="upload" onClick={() => fileInput.current?.click()} busy={uploadPct !== null}>
                {uploadPct !== null ? `Uploading ${Math.round(uploadPct * 100)}%` : 'Open a file'}
              </Button>
              <input ref={fileInput} type="file" hidden accept="video/*,audio/*,.mkv,.mov"
                onChange={(e) => { void uploadFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {!source && !playlist && (
              <div className={'drop' + (over ? ' over' : '')} onClick={() => fileInput.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); void uploadFile(e.dataTransfer.files?.[0]); }}>
                Drop a video or audio file here, or paste a link above
              </div>
            )}
          </Panel>

          {playlist && (
            <Panel title={`Playlist · ${playlist.title}`} actions={
              <>
                <Button small onClick={() => setPicked(new Set(picked.size === playlist.entries.length ? [] : playlist.entries.map((e) => e.url)))}>
                  {picked.size === playlist.entries.length ? 'Select none' : 'Select all'}
                </Button>
                <Button small variant="primary" disabled={picked.size === 0} onClick={() => {
                  const urls = playlist.entries.filter((e) => picked.has(e.url)).map((e) => e.url);
                  if (urls.length === 1) {
                    setUrl(urls[0]);
                    void fetchInfo(urls[0]);
                  } else {
                    setBatchText(urls.join('\n'));
                    setMode('batch');
                  }
                }}>
                  {picked.size <= 1 ? 'Open video' : `Send ${picked.size} to batch`}
                </Button>
              </>
            }>
              {playlist.entries.length === 0 ? <Empty title="This playlist has no videos" /> : (
                <div className="pl-list">
                  {playlist.entries.map((e) => (
                    <label key={e.url} className="pl-item">
                      <input type="checkbox" checked={picked.has(e.url)} onChange={() => {
                        const next = new Set(picked);
                        next.has(e.url) ? next.delete(e.url) : next.add(e.url);
                        setPicked(next);
                      }} />
                      <span className="ellipsis">{e.title}</span>
                      <span className="mono muted">{e.duration ? fmtTime(e.duration) : ''}</span>
                    </label>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {source && clip && (
            <div className="clip-grid">
              <div className="clip-side sticky">
                <Panel>
                  <div className="clip-preview">
                    {source.kind === 'local' && source.has_video && (
                      <video ref={video} src={source.source} controls preload="metadata" onTimeUpdate={onTime} onSeeked={onTime} />
                    )}
                    {source.kind === 'local' && !source.has_video && (
                      <div className="clip-preview-empty"><audio ref={video as any} src={source.source} controls onTimeUpdate={onTime} /></div>
                    )}
                    {source.kind === 'video' && source.youtube_id && (
                      <iframe key={ytPreview.n} title="Preview" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
                        src={`https://www.youtube.com/embed/${source.youtube_id}?rel=0&start=${Math.floor(ytPreview.start)}`
                          + (ytPreview.end ? `&end=${Math.ceil(ytPreview.end)}` : '') + (ytPreview.n ? '&autoplay=1' : '')} />
                    )}
                    {source.kind === 'video' && !source.youtube_id && (source.thumbnail
                      ? <img src={source.thumbnail} alt="" referrerPolicy="no-referrer" />
                      : <div className="clip-preview-empty">No preview for this site. The clip is cut from the times you set.</div>)}
                  </div>
                  <div className="clip-meta">
                    <h2>{source.title}</h2>
                    <div className="muted">
                      {[source.uploader, source.view_count != null ? `${fmtNum(source.view_count)} views` : '',
                        duration > 0 ? fmtTime(duration) : 'Length unknown',
                        source.has_video && source.width ? `${source.width} × ${source.height}` : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {source.kind === 'local' ? (
                    <div className="row wrap gap-s">
                      <Button small icon="back" onClick={() => stepFrame(-1)} title="Back one frame">1 frame</Button>
                      <Button small onClick={() => stepFrame(1)} title="Forward one frame">1 frame <Icon name="next" size={14} /></Button>
                      <Button small onClick={() => video.current && setRange(clamp(video.current.currentTime, 0, clip.end - 0.05), clip.end)}>Set start here</Button>
                      <Button small onClick={() => video.current && setRange(clip.start, clamp(video.current.currentTime, clip.start + 0.05, maxTime))}>Set end here</Button>
                      <Button small icon="play" onClick={playSelection}>Play selection</Button>
                    </div>
                  ) : source.youtube_id ? (
                    <div className="row wrap gap-s">
                      <Button small icon="play" onClick={() => setYtPreview({ start: clip.start, end: clip.end, n: ytPreview.n + 1 })}>Play selection</Button>
                      <span className="small muted">The preview starts and stops on whole seconds.</span>
                    </div>
                  ) : null}
                </Panel>
              </div>

              <div className="clip-side">
                <Panel title="Clip range" actions={<Button small icon="plus" onClick={addClip}>Add another clip</Button>}>
                  {duration > 0 ? (
                    <RangeSlider max={duration} start={clip.start} end={clip.end} step={step} onChange={setRange}
                      playhead={source.kind === 'local' ? playhead : null}
                      others={clips.filter((_, i) => i !== active)} />
                  ) : (
                    <div className="notice">This source did not report a length, so set the times by hand.</div>
                  )}
                  <div className="range-times">
                    <Field label="Start">
                      <TimeBoxes label="Start" value={clip.start} max={Math.max(0, clip.end - 0.05)} onChange={(v) => setRange(v, clip.end, 'start')} />
                    </Field>
                    <Field label="End">
                      <TimeBoxes label="End" value={clip.end} max={maxTime}
                        onChange={(v) => setRange(clip.start, Math.max(v, clip.start + 0.05), 'end')} />
                    </Field>
                    <div className="range-selected">
                      <span className="field-label">Selected</span>
                      <b>{fmtLen(selected)}</b>
                    </div>
                  </div>
                  {clips.length > 1 && (
                    <div className="clip-rows">
                      {clips.map((c, i) => (
                        <div key={c.id} className={'clip-row' + (i === active ? ' on' : '')} onClick={() => setActive(i)}>
                          <span className="idx">{i + 1}</span>
                          <input type="text" value={c.name} aria-label={`Clip ${i + 1} name`} onChange={(e) => setName(i, e.target.value)} />
                          <span className="rng">{fmtTime(c.start, true)} – {fmtTime(c.end, true)} · {fmtLen(c.end - c.start)}</span>
                          <Button small variant="ghost" icon="trash" aria-label={`Remove clip ${i + 1}`}
                            onClick={(e) => { e.stopPropagation(); removeClip(i); }} />
                        </div>
                      ))}
                      <span className="small muted">{clips.length} clips · {fmtLen(total)} in total. Grey bars on the slider are the other clips.</span>
                    </div>
                  )}
                </Panel>

                <OutputOptions opts={opts} set={patch} qualities={source.qualities.length ? source.qualities : source.has_video ? [] : null}
                  isUrl={source.kind === 'video'} hasVideo={source.has_video} dims={dims} />

                {saveBox(clips.length, saveSingle, invalid, (
                  <>
                    <Field label={clips.length > 1 ? `File name · clip ${active + 1}` : 'File name'}>
                      <div className="name-row">
                        <input type="text" value={clip.name} onChange={(e) => setName(active, e.target.value)} placeholder={source.title} />
                        <span className="ext">.{extOf(opts.format)}</span>
                      </div>
                    </Field>
                    {source.kind === 'video' && (
                      <div className="opt-line">
                        <Toggle checked={opts.subtitles} onChange={(v) => patch({ subtitles: v })} label="Also save subtitles for this range (SRT and TXT)" />
                        {opts.subtitles && (
                          <>
                            <input type="text" style={{ width: 90 }} value={opts.subLang} aria-label="Subtitle language" list="clip-langs"
                              onChange={(e) => patch({ subLang: e.target.value.trim() })} />
                            <datalist id="clip-langs">
                              {Array.from(new Set([...source.subtitle_langs, ...source.auto_caption_langs])).map((l) => <option key={l} value={l} />)}
                            </datalist>
                            {source.subtitle_langs.length + source.auto_caption_langs.length === 0 && (
                              <span className="small muted">This video did not list any subtitles.</span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'batch' && (
        <div className="clip-grid">
          <div className="clip-side">
            <Panel title="URLs">
              <textarea rows={9} placeholder={'One video URL per line'} value={batchText} aria-label="Video URLs"
                onChange={(e) => setBatchText(e.target.value)} />
              <span className="small muted">{batchUrls.length} {batchUrls.length === 1 ? 'video' : 'videos'}. Each one is saved under its own title.</span>
            </Panel>
            <Panel title="Range">
              <Toggle checked={batchWhole} onChange={setBatchWhole} label="Whole video" />
              {!batchWhole && (
                <div className="range-times">
                  <Field label="Start">
                    <TimeBoxes label="Start" value={batchRange.start} max={Math.max(0, batchRange.end - 0.05)}
                      onChange={(v) => setBatchRange({ ...batchRange, start: v })} />
                  </Field>
                  <Field label="End">
                    <TimeBoxes label="End" value={batchRange.end} max={24 * 3600}
                      onChange={(v) => setBatchRange({ ...batchRange, end: Math.max(v, batchRange.start + 0.05) })} />
                  </Field>
                  <div className="range-selected">
                    <span className="field-label">Length</span>
                    <b>{fmtLen(batchRange.end - batchRange.start)}</b>
                  </div>
                </div>
              )}
            </Panel>
          </div>
          <div className="clip-side">
            <OutputOptions opts={opts} set={patch} qualities={null} isUrl hasVideo />
            {saveBox(batchUrls.length, saveBatch, batchUrls.length === 0, (
              <div className="opt-line">
                <Toggle checked={opts.subtitles} onChange={(v) => patch({ subtitles: v })} label="Also save subtitles (SRT and TXT)" />
                {opts.subtitles && (
                  <input type="text" style={{ width: 90 }} value={opts.subLang} aria-label="Subtitle language"
                    onChange={(e) => patch({ subLang: e.target.value.trim() })} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Panel title={`Saved clips${history.length ? ` · ${history.length}` : ''}`}>
        {history.length === 0 ? (
          <Empty icon="scissors" title="No clips yet">Clips you save appear here, ready to download or send to the shorts studio.</Empty>
        ) : (
          <div className="grid-auto">
            {history.map((r) => (
              <div key={r.id} className="card hist-card">
                {r.thumb ? <img className="thumb" src={r.thumb} alt="" loading="lazy" />
                  : <div className="hist-audio"><Icon name={isAudio(r.format) ? 'music' : r.format === 'frames' ? 'image' : 'film'} size={26} /></div>}
                <div className="hist-title">{r.title}</div>
                <div className="row wrap gap-s">
                  <span className="pill accent">{r.format === 'frames' ? 'PNG zip' : r.format.toUpperCase()}</span>
                  {r.width > 0 && <span className="pill">{r.width} × {r.height}</span>}
                  <span className="pill">{r.frames ? `${r.frames} frames` : fmtLen(r.duration)}</span>
                  <span className="pill">{fmtBytes(r.size)}</span>
                </div>
                <div className="hist-origin ellipsis" title={r.source_origin}>
                  {fmtTime(r.source_in, true)} – {fmtTime(r.source_out, true)} of {r.source_origin}
                </div>
                <div className="row wrap gap-s">
                  <a className="btn small" href={r.file} download><Icon name="download" size={14} /><span>Download</span></a>
                  {r.subtitles?.map((s) => (
                    <a key={s} className="btn small ghost" href={s} download>{s.split('.').pop()?.toUpperCase()}</a>
                  ))}
                  {(r.format === 'mp4' || r.format === 'mov') && (
                    <Button small icon="film" busy={sending === r.id} onClick={() => sendToStudio(r)}>Send to studio</Button>
                  )}
                  <span className="spacer" />
                  <Button small variant="ghost" icon="trash" aria-label={`Delete ${r.title}`} onClick={() => removeRow(r)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
