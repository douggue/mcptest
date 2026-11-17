// Post an exported short to a connected YouTube channel, now or scheduled, and follow how it does.
// Every upload is recorded as an Agency post (server/routers/youtube.py), so it shows in the planner too.
import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import { Button, Field, Icon, JobBar, Seg, Toggle, fmtBytes, fmtNum, toast, toastError, useJobRunner } from '../ui';
import {
  Clip, ExportRow, ExportWithMeta, Meta, Project, PublishResult, YouTubePost, YouTubePrivacy, YouTubeState,
} from './types';

export type PublishPanelProps = {
  /** The project and clip being edited. Optional so the Agency planner can publish an export on its own. */
  project?: Project;
  clip?: Clip;
  /** The export to upload. When left out, the clip's exports are listed and the newest is picked. */
  exportRow?: ExportRow | null;
  /** The editor's current post text; defaults to clip.meta, then to the post text saved with the export. */
  meta?: Meta;
  /** Fill this planned Agency post instead of finding or creating one. */
  postId?: string;
  /** Preselect the channel linked to this Agency account. */
  accountId?: string;
  /** A planner time (YYYY-MM-DDTHH:MM, local) to offer as the scheduled publish time. */
  scheduled?: string;
  /** Leave out the panel's own heading (for use inside a modal). */
  bare?: boolean;
  onPublished?: (r: PublishResult) => void;
};

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const splitTags = (s: string) => s.split(/[\s,]+/).map((x) => x.replace(/^#+/, '').trim()).filter(Boolean);
const tagText = (tags: string[]) => tags.map((t) => '#' + t.replace(/^#+/, '')).join(' ');

function inAnHour(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return toLocalInput(d);
}

const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  uploading: { text: 'Uploading', cls: 'accent' },
  live: { text: 'Live', cls: 'good' },
  scheduled: { text: 'Scheduled', cls: 'info' },
  private: { text: 'Private', cls: '' },
  failed: { text: 'Failed', cls: 'bad' },
  cancelled: { text: 'Cancelled', cls: 'muted' },
};

export default function PublishPanel({ clip, exportRow, meta, postId, accountId, scheduled, bare, onPublished }: PublishPanelProps) {
  const [yt, setYt] = useState<YouTubeState | null>(null);
  const [list, setList] = useState<ExportWithMeta[]>([]);
  const [exportId, setExportId] = useState(exportRow?.id ?? '');
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState<YouTubePrivacy>('public');
  const [kids, setKids] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState(inAnHour);
  const [history, setHistory] = useState<YouTubePost[]>([]);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [refreshing, setRefreshing] = useState('');
  const jobs = useJobRunner();

  // channels
  useEffect(() => { api.get<YouTubeState>('/api/youtube/state').then(setYt).catch(() => setYt(null)); }, []);
  const usable = (yt?.channels ?? []).filter((c) => !c.needs_reconnect && c.can_upload);
  useEffect(() => {
    if (!yt) return;
    const linked = accountId ? yt.channels.find((c) => c.account_id === accountId) : undefined;
    setChannelId((cur) => (linked ? linked.id : cur && yt.channels.some((c) => c.id === cur) ? cur : usable[0]?.id ?? ''));
  }, [yt, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  // exports of this clip, when no single export was handed in
  useEffect(() => {
    if (exportRow) { setExportId(exportRow.id); return; }
    api.get<ExportWithMeta[]>('/api/exports').then((rows) => {
      const mine = clip ? rows.filter((r) => r.clip_id === clip.id) : rows;
      setList(mine);
      setExportId((cur) => (mine.some((r) => r.id === cur) ? cur : mine[0]?.id ?? ''));
    }).catch(() => {});
  }, [exportRow?.id, clip?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen: ExportWithMeta | undefined = exportRow ?? list.find((r) => r.id === exportId);

  // prefill from the post text whenever the clip or export changes
  const source: Meta | undefined = meta ?? clip?.meta ?? chosen?.meta;
  useEffect(() => {
    setTitle(source?.title || clip?.title || chosen?.title || '');
    setDescription(source?.description ?? '');
    setTags(tagText(source?.hashtags ?? []));
    setResult(null);
  }, [clip?.id, chosen?.id, postId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (scheduled && new Date(scheduled) > new Date(Date.now() + 5 * 60 * 1000)) { setWhen('later'); setAt(scheduled.slice(0, 16)); }
  }, [scheduled]);

  const loadHistory = () => {
    if (!chosen) { setHistory([]); return Promise.resolve(); }
    return api.get<YouTubePost[]>(`/api/youtube/posts?export_id=${encodeURIComponent(chosen.id)}`).then(setHistory).catch(() => {});
  };
  useEffect(() => { loadHistory(); }, [chosen?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const atDate = useMemo(() => new Date(at), [at]);
  const timeProblem = when === 'later' && (!at || isNaN(atDate.getTime()) ? 'Pick a date and time.'
    : atDate.getTime() < Date.now() + 60 * 1000 ? 'Pick a time in the future.' : '');
  const channel = yt?.channels.find((c) => c.id === channelId);
  const cannot = !yt ? 'Loading…'
    : !yt.channels.length ? 'none'
    : !chosen ? 'Export the clip first, then post the MP4.'
    : !channel ? 'Pick a channel.'
    : channel.needs_reconnect ? channel.problem || 'Reconnect this channel under Settings → YouTube.'
    : !channel.can_upload ? 'Cutroom was not given permission to upload to this channel. Reconnect it under Settings → YouTube.'
    : !title.trim() ? 'Give the video a title.'
    : timeProblem;

  async function publish(again = false) {
    if (!chosen) return;
    const body = {
      export_id: chosen.id, channel_id: channelId, title, description, hashtags: splitTags(tags), privacy,
      made_for_kids: kids, publish_at: when === 'later' ? atDate.toISOString() : '', scheduled: when === 'later' ? at : '',
      post_id: postId ?? '', again,
    };
    try {
      const r = await jobs.run<PublishResult>(() => api.post('/api/youtube/publish', body));
      setResult(r);
      toast(r.state === 'scheduled' ? 'Uploaded. YouTube will publish it at the scheduled time.' : 'Posted to YouTube', 'good');
      onPublished?.(r);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (!again && /already on YouTube/.test(text) && window.confirm(`${text}\n\nUpload it again as a new video?`)) return publish(true);
      if (text !== 'Cancelled') toastError(e);
    }
    loadHistory();
  }

  async function refresh(p: YouTubePost) {
    setRefreshing(p.id);
    try {
      await api.post(`/api/youtube/posts/${p.id}/stats`);
      await loadHistory();
    } catch (e) { toastError(e); }
    setRefreshing('');
  }

  const body = (
    <>
      {yt && !yt.channels.length ? (
        <div className="notice">
          No YouTube channel is connected yet. Add your Google OAuth client and connect a channel under{' '}
          <a href="#/settings">Settings → YouTube</a>, then come back to post.
        </div>
      ) : (
        <>
          {!exportRow && (
            list.length === 0 ? <span className="small muted">Nothing exported yet. Export the MP4 first; that file is what gets uploaded.</span> : (
              <Field label="Video">
                <select value={exportId} onChange={(e) => setExportId(e.target.value)}>
                  {list.map((r) => <option key={r.id} value={r.id}>{r.title} · {r.width}×{r.height} · {fmtBytes(r.size)} · {new Date(r.created * 1000).toLocaleString()}</option>)}
                </select>
              </Field>
            )
          )}
          {exportRow && <span className="small muted ellipsis">Video: {exportRow.title} · {exportRow.width}×{exportRow.height} · {fmtBytes(exportRow.size)}</span>}

          <Field label="Channel">
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
              {!channelId && <option value="">Pick a channel</option>}
              {(yt?.channels ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.title}{c.handle ? ` (${c.handle})` : ''}{c.needs_reconnect ? ' — needs reconnecting' : ''}</option>
              ))}
            </select>
          </Field>
          {channel?.needs_reconnect && <div className="notice bad">{channel.problem} <a href="#/settings">Open Settings</a></div>}

          <Field label={`Title (${title.length}/100)`}>
            <input type="text" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Hashtags" hint="Added to the end of the description if they are not in it already, and sent as tags.">
            <input type="text" placeholder="#shorts #funny" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>

          <Field label="Who can see it">
            <Seg small value={privacy} onChange={setPrivacy} options={[
              { value: 'public', label: 'Public' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'private', label: 'Private' }]} />
          </Field>
          <Field label="When">
            <Seg small value={when} onChange={setWhen} options={[{ value: 'now', label: 'Post now' }, { value: 'later', label: 'Schedule' }]} />
          </Field>
          {when === 'later' && (
            <Field label="Publish at" hint="Your local time. The video uploads now as private, and YouTube makes it public at this time.">

              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          )}
          <Toggle checked={kids} onChange={setKids} label="Made for kids" />
          {(privacy !== 'private' || when === 'later') && (
            <span className="small muted">Google keeps uploads from an OAuth app it has not verified private until the app passes an audit. A personal app usually stays unverified, so the video may stay private{when === 'later' ? ', even at its publish time' : ''}; you can make it public in YouTube Studio.</span>
          )}

          {cannot && cannot !== 'none' && cannot !== 'Loading…' && <span className="small muted">{cannot}</span>}
          <Button variant="primary" icon="upload" busy={jobs.busy} disabled={!!cannot || jobs.busy} onClick={() => publish()}>
            {when === 'later' ? 'Upload and schedule' : 'Post to YouTube'}
          </Button>
          <JobBar job={jobs.job} />

          {result && (
            <div className="card col gap-s" style={{ padding: 10 }}>
              <div className="small">
                <b>{result.state === 'scheduled' ? 'Scheduled.' : result.state === 'live' ? 'Posted.' : 'Uploaded as private.'}</b>{' '}
                <a href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
              </div>
              {result.warnings.map((w, i) => <div key={i} className="small" style={{ color: 'var(--accent)' }}>{w}</div>)}
              <span className="small muted">It is in the Agency planner as well, where its views are tracked.</span>
            </div>
          )}
        </>
      )}

      {history.length > 0 && (
        <div className="col gap-s">
          <span className="small muted">On YouTube from this export</span>
          {history.map((p) => {
            const s = STATE_LABEL[p.youtube.state] ?? { text: p.youtube.state, cls: '' };
            return (
              <div key={p.id} className="asset-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow col" style={{ gap: 3, minWidth: 0 }}>
                  <div className="row gap-s" style={{ minWidth: 0 }}>
                    <span className={`pill ${s.cls}`}>{s.text}</span>
                    <span className="ellipsis small">{p.video_title}</span>
                  </div>
                  {p.youtube.video_id && (
                    <div className="small muted mono">
                      {fmtNum(p.views || 0)} views · {p.youtube.likes == null ? '–' : fmtNum(p.youtube.likes)} likes · {p.youtube.comments == null ? '–' : fmtNum(p.youtube.comments)} comments
                      {p.youtube.state === 'scheduled' && p.youtube.publish_at ? ` · goes public ${new Date(p.youtube.publish_at).toLocaleString()}` : ''}
                    </div>
                  )}
                  {p.youtube.error && <div className="small" style={{ color: 'var(--bad)' }}>{p.youtube.error}</div>}
                  {p.youtube.warning && !p.youtube.error && <div className="small muted">{p.youtube.warning}</div>}
                </div>
                {p.url && <a className="btn ghost small" href={p.url} target="_blank" rel="noreferrer" title="Open on YouTube" aria-label="Open on YouTube"><Icon name="link" size={14} /></a>}
                {p.youtube.video_id && <Button small variant="ghost" icon="redo" busy={refreshing === p.id} title="Refresh views, likes and comments" aria-label="Refresh stats" onClick={() => refresh(p)} />}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  if (bare) return <div className="col">{body}</div>;
  return (
    <div className="group">
      <h3><span>Post to YouTube</span><span className="row gap-s" /></h3>
      {body}
    </div>
  );
}
