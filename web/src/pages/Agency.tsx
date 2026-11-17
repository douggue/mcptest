import './agency.css';

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../api';
import {
  Button, Empty, Field, Icon, JobBar, Modal, Panel, Seg, Toggle, fmtDur, fmtMoney, fmtNum, toast, toastError,
  useJobRunner,
} from '../ui';

/* ------------------------------------------------------------------ types */

const PLATFORMS = ['TikTok', 'YouTube Shorts', 'Instagram Reels', 'X', 'Facebook', 'Other'] as const;
const STATUSES = ['planned', 'posted', 'submitted', 'approved', 'rejected', 'paid'] as const;
type Status = (typeof STATUSES)[number];
const LIVE: Status[] = ['posted', 'submitted', 'approved', 'rejected', 'paid'];

type Rules = {
  required_hashtags: string[];
  required_mentions: string[];
  banned_words: string[];
  min_duration: number;
  max_duration: number;
  required_phrase: string;
};
type Campaign = {
  id: string; name: string; creator: string; platforms: string[]; rate: number; budget: number; max_payout: number;
  min_views: number; start: string; end: string; link: string; notes: string; rules: Rules;
  stats: { earned: number; uncapped: number; budget: number; remaining: number | null; views: number; posts: number };
};
type Account = { id: string; platform: string; handle: string; label: string; times: string[]; notes: string };
type Caption = { title: string; description: string; hashtags: string[] };
type Video = {
  key: string; kind: 'export' | 'clip'; id: string; title: string; file: string; cover: string; duration: number;
  status: string; meta: Caption; source_origin: string; transcript_text: string;
};
type Post = {
  id: string; video_key: string; video_title: string; account_id: string; campaign_id: string; scheduled: string;
  status: Status; url: string; notes: string; caption: Caption; views: number; earnings: number;
};
type Pair = { a: string; b: string; a_title: string; b_title: string; reasons: string[]; score: number };
type Dupes = { pairs: Pair[]; double_bookings: { video_key: string; account_id: string; post_ids: string[] }[] };
type Check = { rule: string; ok: boolean; detail: string };
type Bucket = { posts: number; live: number; views: number; earned: number };
type Analytics = {
  totals: Bucket & { paid: number };
  by_campaign: (Bucket & { id: string; name: string; budget: number; remaining: number | null })[];
  by_account: (Bucket & { id: string; handle: string; platform: string; label: string })[];
  by_platform: (Bucket & { platform: string })[];
  timeline: { date: string; views: number }[];
  rule: string;
};
type Data = { campaigns: Campaign[]; accounts: Account[]; posts: Post[]; videos: Video[]; dupes: Dupes };

/* ------------------------------------------------------------------ helpers */

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toInput = (d: Date) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromInput = (s: string) => new Date(s.length === 10 ? s + 'T00:00' : s);

function fmtWhen(s: string): string {
  if (!s) return 'Not scheduled';
  const d = fromInput(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + s.slice(11, 16);
}
const fmtDay = (s: string) => fromInput(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const splitTags = (s: string) => s.split(/[\s,]+/).map((x) => x.replace(/^#+/, '').trim()).filter(Boolean);
const tagText = (tags: string[]) => tags.map((t) => '#' + t).join(' ');

function captionText(c: Caption): string {
  return [c.title, c.description, tagText(c.hashtags)].map((x) => x.trim()).filter(Boolean).join('\n\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lookups shared by every tab. */
function useIndex(data: Data) {
  return useMemo(() => {
    const video = new Map(data.videos.map((v) => [v.key, v]));
    const account = new Map(data.accounts.map((a) => [a.id, a]));
    const campaign = new Map(data.campaigns.map((c) => [c.id, c]));
    const dupeKeys = new Map<string, Pair[]>();
    for (const p of data.dupes.pairs) {
      for (const k of [p.a, p.b]) dupeKeys.set(k, [...(dupeKeys.get(k) ?? []), p]);
    }
    const doubled = new Set(data.dupes.double_bookings.flatMap((d) => d.post_ids));
    const title = (p: Post) => video.get(p.video_key)?.title || p.video_title || 'Untitled';
    const caption = (p: Post): Caption => {
      const c = p.caption ?? { title: '', description: '', hashtags: [] };
      if (c.title || c.description || c.hashtags.length) return c;
      return video.get(p.video_key)?.meta ?? { title: p.video_title, description: '', hashtags: [] };
    };
    return { video, account, campaign, dupeKeys, doubled, title, caption };
  }, [data]);
}
type Index = ReturnType<typeof useIndex>;

/* ------------------------------------------------------------------ page */

type Tab = 'planner' | 'campaigns' | 'accounts' | 'analytics' | 'videos';

export default function Agency() {
  const [tab, setTab] = useState<Tab>('planner');
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');

  const reload = useCallback(async () => {
    try {
      const [campaigns, accounts, posts, videos, dupes] = await Promise.all([
        api.get<Campaign[]>('/api/agency/campaigns'),
        api.get<Account[]>('/api/agency/accounts'),
        api.get<Post[]>('/api/agency/posts'),
        api.get<Video[]>('/api/agency/videos'),
        api.get<Dupes>('/api/agency/duplicates'),
      ]);
      setData({ campaigns, accounts, posts, videos, dupes });
      setFailed('');
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const dupeCount = data ? data.dupes.pairs.length + data.dupes.double_bookings.length : 0;
  const label = (text: string, n?: number, warn?: boolean): ReactNode => (
    <>
      {text}
      {n !== undefined && n > 0 && <span className={'count' + (warn ? ' warn' : '')}>{n}</span>}
    </>
  );

  return (
    <div className="page agency">
      <div className="page-head">
        <div>
          <h1>Agency</h1>
          <p>Plan posts, track campaigns and count views.</p>
        </div>
        <Seg<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'planner', label: label('Planner', data?.posts.length) },
            { value: 'campaigns', label: label('Campaigns', data?.campaigns.length) },
            { value: 'accounts', label: label('Accounts', data?.accounts.length) },
            { value: 'analytics', label: 'Analytics' },
            { value: 'videos', label: label('Videos', dupeCount, true), title: dupeCount ? `${dupeCount} duplicate warnings` : undefined },
          ]}
        />
      </div>
      {failed && <div className="notice bad">Could not load agency data: {failed}</div>}
      {!data && !failed && <div className="muted">Loading…</div>}
      {data && tab === 'planner' && <Planner data={data} reload={reload} goTo={setTab} />}
      {data && tab === 'campaigns' && <Campaigns data={data} reload={reload} />}
      {data && tab === 'accounts' && <Accounts data={data} reload={reload} />}
      {data && tab === 'analytics' && <AnalyticsTab data={data} />}
      {data && tab === 'videos' && <Videos data={data} reload={reload} />}
    </div>
  );
}

type TabProps = { data: Data; reload: () => Promise<void> };

/* ------------------------------------------------------------------ planner */

function Planner({ data, reload, goTo }: TabProps & { goTo: (t: Tab) => void }) {
  const ix = useIndex(data);
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  const [newDay, setNewDay] = useState('');
  const [distributing, setDistributing] = useState(false);
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [filter, setFilter] = useState<'all' | Status>('all');
  const runner = useJobRunner();

  const now = new Date();
  const today = dayKey(now);
  const nowKey = toInput(now);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week);
    d.setDate(d.getDate() + i);
    return d;
  }), [week]);

  const due = data.posts.filter((p) => p.status === 'planned' && p.scheduled && p.scheduled.slice(0, 10) <= today);
  const shown = filter === 'all' ? data.posts : data.posts.filter((p) => p.status === filter);
  const needSetup = data.accounts.length === 0;

  async function save(post: Post, patch: Partial<Post>) {
    try {
      await api.put(`/api/agency/posts/${post.id}`, patch);
      await reload();
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(post: Post) {
    if (!window.confirm(`Delete the post “${ix.title(post)}”?`)) return;
    try {
      await api.del(`/api/agency/posts/${post.id}`);
      await reload();
    } catch (e) {
      toastError(e);
    }
  }

  async function copy(post: Post) {
    const text = captionText(ix.caption(post));
    if (!text) return toast('This post has no caption yet', 'bad');
    toast((await copyText(text)) ? 'Caption copied' : 'Could not copy the caption', 'good');
  }

  async function refresh(post: Post) {
    try {
      const row = await api.post<Post>(`/api/agency/posts/${post.id}/refresh-views`);
      toast(`${fmtNum(row.views)} views`, 'good');
      await reload();
    } catch (e) {
      toastError(e);
    }
  }

  async function refreshAll() {
    try {
      const res = await runner.run<{ updated: number; failed: { url: string; error: string }[] }>(() =>
        api.post('/api/agency/posts/refresh-all'));
      toast(`Updated ${res.updated} post${res.updated === 1 ? '' : 's'}` +
        (res.failed.length ? `, ${res.failed.length} could not be read` : ''), res.failed.length ? 'bad' : 'good');
      await reload();
    } catch (e) {
      toastError(e);
    }
  }

  const actions = (p: Post) => {
    const file = ix.video.get(p.video_key)?.file;
    return (
      <>
        {p.status === 'planned' && (
          <Button small variant="ghost" icon="check" title="Mark as posted" aria-label="Mark as posted"
            onClick={() => save(p, { status: 'posted' })} />
        )}
        <Button small variant="ghost" icon="copy" title="Copy caption" aria-label="Copy caption" onClick={() => copy(p)} />
        {file && (
          <a className="btn ghost small" href={file} download title="Download video" aria-label="Download video">
            <Icon name="download" size={14} />
          </a>
        )}
        {p.url && (
          <a className="btn ghost small" href={p.url} target="_blank" rel="noreferrer" title="Open post" aria-label="Open post">
            <Icon name="link" size={14} />
          </a>
        )}
        {p.url && (
          <Button small variant="ghost" icon="redo" title="Refresh views from the post link" aria-label="Refresh views"
            onClick={() => refresh(p)} />
        )}
        <Button small variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
        <Button small variant="ghost" icon="trash" title="Delete post" aria-label="Delete post" onClick={() => remove(p)} />
      </>
    );
  };

  const account = (p: Post) => {
    const a = ix.account.get(p.account_id);
    return a ? `${a.handle} · ${a.platform}` : 'Deleted account';
  };

  return (
    <>
      <div className="notice">
        Cutroom plans and tracks posts. It does not upload to TikTok, YouTube, Instagram or any other platform. Post each
        video yourself, then mark it as posted and paste the link here.
      </div>

      {needSetup ? (
        <Panel>
          <Empty icon="users" title="Add an account first">
            A post is planned for an account. Add the accounts you post to, then come back to plan.
          </Empty>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="primary" icon="plus" onClick={() => goTo('accounts')}>Add an account</Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="row wrap">
            <Button variant="primary" icon="plus" onClick={() => { setNewDay(''); setEditing('new'); }}>New post</Button>
            <Button icon="shuffle" onClick={() => setDistributing(true)}>Distribute a video</Button>
            <Button icon="redo" busy={runner.busy} onClick={refreshAll}
              disabled={!data.posts.some((p) => p.url && LIVE.includes(p.status))}>Refresh all views</Button>
          </div>
          <JobBar job={runner.job} />

          <Panel title={`Due today and overdue (${due.length})`}>
            {due.length === 0 ? (
              <span className="muted">Nothing is waiting to be posted.</span>
            ) : (
              <div className="due">
                {due.map((p) => (
                  <div className="due-row" key={p.id}>
                    <div className="due-when">
                      {p.scheduled < nowKey ? <span className="pill bad">Overdue</span> : <span className="pill accent">Today</span>}
                      <div className="mono small muted" style={{ marginTop: 3 }}>{fmtWhen(p.scheduled)}</div>
                    </div>
                    <div className="due-main">
                      <div className="ellipsis" style={{ fontWeight: 500 }}>{ix.title(p)}</div>
                      <div className="muted small ellipsis">{account(p)}</div>
                    </div>
                    <div className="row gap-s">{actions(p)}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title={`Week of ${days[0].toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`}
            actions={
              <>
                <Button small variant="ghost" icon="back" aria-label="Previous week"
                  onClick={() => setWeek((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() - 7))} />
                <Button small onClick={() => setWeek(mondayOf(new Date()))}>This week</Button>
                <Button small variant="ghost" icon="next" aria-label="Next week"
                  onClick={() => setWeek((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + 7))} />
              </>
            }
          >
            <div className="week">
              {days.map((d) => {
                const key = dayKey(d);
                const list = data.posts.filter((p) => p.scheduled.slice(0, 10) === key);
                return (
                  <div className={'day' + (key === today ? ' today' : '')} key={key}>
                    <div className="day-head">
                      <b>{d.toLocaleDateString(undefined, { weekday: 'short' })}</b>
                      <span>{d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                    </div>
                    <div className="day-body">
                      {list.map((p) => (
                        <button key={p.id} className={`chip s-${p.status}` + (p.status === 'planned' && p.scheduled < nowKey ? ' late' : '')}
                          onClick={() => setEditing(p)} title={`${ix.title(p)} — ${account(p)}`}>
                          <span className="chip-top">
                            <span className="mono">{p.scheduled.slice(11, 16)}</span>
                            <span>{cap(p.status)}</span>
                          </span>
                          <span className="chip-title">{ix.title(p)}</span>
                          <span className="chip-sub">{account(p)}</span>
                        </button>
                      ))}
                      {list.length === 0 && <span className="day-empty">No posts</span>}
                      <Button small variant="ghost" icon="plus" aria-label={`Add a post on ${key}`}
                        onClick={() => { setNewDay(key); setEditing('new'); }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="All posts"
            pad={false}
            actions={
              <Seg<'all' | Status> small value={filter} onChange={setFilter}
                options={[{ value: 'all', label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: cap(s) }))]} />
            }
          >
            {shown.length === 0 ? (
              <Empty icon="calendar" title={data.posts.length ? 'No posts with this status' : 'No posts planned yet'}>
                {data.posts.length ? 'Pick another status above.' : 'Create a post, or distribute one video to several accounts.'}
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Scheduled</th><th>Video</th><th>Account</th><th>Campaign</th><th>Status</th>
                      <th className="num">Views</th><th className="num">Est. earnings</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.id}>
                        <td className="mono small" style={{ whiteSpace: 'nowrap' }}>{fmtWhen(p.scheduled)}</td>
                        <td>
                          <div className="cell-title ellipsis">{ix.title(p)}</div>
                          <div className="row gap-s wrap" style={{ marginTop: 2 }}>
                            {ix.dupeKeys.has(p.video_key) && <span className="pill bad">Possible duplicate</span>}
                            {ix.doubled.has(p.id) && <span className="pill bad">Planned twice for this account</span>}
                          </div>
                        </td>
                        <td>
                          <div>{ix.account.get(p.account_id)?.handle ?? 'Deleted account'}</div>
                          <div className="cell-sub">{ix.account.get(p.account_id)?.platform}</div>
                        </td>
                        <td>{ix.campaign.get(p.campaign_id)?.name ?? <span className="faint">None</span>}</td>
                        <td>
                          <select value={p.status} aria-label="Status" onChange={(e) => save(p, { status: e.target.value as Status })}>
                            {STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
                          </select>
                        </td>
                        <td className="num"><ViewsCell post={p} onSave={(views) => save(p, { views })} /></td>
                        <td className="num">{p.campaign_id ? fmtMoney(p.earnings) : <span className="faint">–</span>}</td>
                        <td className="actions">{actions(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {editing && (
        <PostEditor
          data={data} ix={ix} post={editing === 'new' ? null : editing} day={newDay}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }}
        />
      )}
      {distributing && (
        <DistributeModal data={data} ix={ix} onClose={() => setDistributing(false)}
          onDone={async () => { setDistributing(false); await reload(); }} />
      )}
    </>
  );
}

function ViewsCell({ post, onSave }: { post: Post; onSave: (views: number) => void }) {
  const [value, setValue] = useState(String(post.views || ''));
  useEffect(() => setValue(String(post.views || '')), [post.views]);
  const commit = () => {
    const n = Math.max(0, Math.round(Number(value) || 0));
    if (n !== (post.views || 0)) onSave(n);
  };
  return (
    <input className="views" type="number" min={0} placeholder="0" value={value} aria-label="Views"
      onChange={(e) => setValue(e.target.value)} onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

/* ------------------------------------------------------------------ video picker */

function VideoPicker({ data, value, title, onChange }: {
  data: Data; value: string; title: string; onChange: (key: string, title: string) => void;
}) {
  const [mode, setMode] = useState<'library' | 'text'>(value || !title ? 'library' : 'text');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const list = data.videos.filter((v) => !approvedOnly || v.key === value ||
    (v.kind === 'export' && (v.status === 'approved' || v.status === 'posted')));
  return (
    <div className="col gap-s">
      <div className="row between wrap">
        <span className="field-label">Video</span>
        <div className="row">
          {mode === 'library' && <Toggle checked={approvedOnly} onChange={setApprovedOnly} label="Approved only" />}
          <Seg small value={mode} onChange={(m) => { setMode(m); onChange('', ''); }}
            options={[{ value: 'library', label: 'From library' }, { value: 'text', label: 'Type a title' }]} />
        </div>
      </div>
      {mode === 'library' ? (
        <>
          <select value={value} aria-label="Video" onChange={(e) => onChange(e.target.value, '')}>
            <option value="">Choose a video…</option>
            {list.map((v) => (
              <option key={v.key} value={v.key}>
                {v.title} · {v.kind === 'export' ? `short, ${v.status}` : 'clip'}{v.duration ? ` · ${fmtDur(v.duration)}` : ''}
              </option>
            ))}
          </select>
          {list.length === 0 && (
            <span className="field-hint">
              {approvedOnly ? 'No approved shorts yet. Approve one in the Videos tab, or turn this filter off.'
                : 'No exports or clips yet. Render a short or cut a clip, or type a title instead.'}
            </span>
          )}
        </>
      ) : (
        <input type="text" placeholder="What is this post? e.g. Podcast ep. 12, coffee story" value={title} aria-label="Video title"
          onChange={(e) => onChange('', e.target.value)} />
      )}
    </div>
  );
}

function CaptionFields({ caption, onChange }: { caption: Caption; onChange: (c: Caption) => void }) {
  const [tags, setTags] = useState(tagText(caption.hashtags));
  // keep the raw text while typing, but follow outside changes (picking another video)
  const last = useRef(caption.hashtags.join(','));
  useEffect(() => {
    if (caption.hashtags.join(',') !== last.current) {
      last.current = caption.hashtags.join(',');
      setTags(tagText(caption.hashtags));
    }
  }, [caption.hashtags]);
  return (
    <>
      <Field label="Caption title">
        <input type="text" value={caption.title} onChange={(e) => onChange({ ...caption, title: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea rows={3} value={caption.description} onChange={(e) => onChange({ ...caption, description: e.target.value })} />
      </Field>
      <Field label="Hashtags" hint="Separate with spaces or commas.">
        <input type="text" placeholder="#fyp #podcast" value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            const next = splitTags(e.target.value);
            last.current = next.join(',');
            onChange({ ...caption, hashtags: next });
          }} />
      </Field>
    </>
  );
}

function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <div className="checks">
      {checks.map((c) => (
        <div key={c.rule} className={'check ' + (c.ok ? 'ok' : 'fail')}>
          <span className="mark"><Icon name={c.ok ? 'check' : 'x'} size={12} /></span>
          <div>
            <div>{c.rule} <span className="small muted">— {c.ok ? 'pass' : 'fail'}</span></div>
            <div className="detail">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Runs the campaign rule check whenever the inputs change. */
function useRuleCheck(campaignId: string, caption: Caption, video: Video | undefined, platform: string) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const body = JSON.stringify({
    campaign_id: campaignId, title: caption.title, description: caption.description, hashtags: caption.hashtags,
    duration: video?.duration || null, transcript_text: video?.transcript_text ?? '', platform,
  });
  useEffect(() => {
    if (!campaignId) {
      setChecks(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.post<Check[]>('/api/agency/check', JSON.parse(body))
        .then((r) => live && setChecks(r))
        .catch(() => live && setChecks(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [body, campaignId]);
  return checks;
}

function DupeWarnings({ ix, videoKey }: { ix: Index; videoKey: string }) {
  const pairs = ix.dupeKeys.get(videoKey);
  if (!pairs?.length) return null;
  return (
    <div className="notice bad">
      <b>Possible duplicate.</b> Campaigns usually reject near-identical clips.
      {pairs.map((p) => (
        <div key={p.a + p.b} style={{ marginTop: 4 }}>
          Matches “{p.a === videoKey ? p.b_title : p.a_title}”: {p.reasons.join('; ').toLowerCase()}.
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ post editor */

function PostEditor({ data, ix, post, day, onClose, onSaved }: {
  data: Data; ix: Index; post: Post | null; day: string; onClose: () => void; onSaved: () => void;
}) {
  const [videoKey, setVideoKey] = useState(post?.video_key ?? '');
  const [videoTitle, setVideoTitle] = useState(post?.video_title ?? '');
  const [accountId, setAccountId] = useState(post?.account_id ?? data.accounts[0]?.id ?? '');
  const [campaignId, setCampaignId] = useState(post?.campaign_id ?? '');
  const [scheduled, setScheduled] = useState(() => {
    if (post) return post.scheduled;
    if (day) return `${day}T12:00`;
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return toInput(d);
  });
  const [status, setStatus] = useState<Status>(post?.status ?? 'planned');
  const [url, setUrl] = useState(post?.url ?? '');
  const [views, setViews] = useState(String(post?.views || ''));
  const [notes, setNotes] = useState(post?.notes ?? '');
  const [caption, setCaption] = useState<Caption>(post ? ix.caption(post) : { title: '', description: '', hashtags: [] });
  const [busy, setBusy] = useState(false);

  const video = ix.video.get(videoKey);
  const account = ix.account.get(accountId);
  const checks = useRuleCheck(campaignId, caption, video, account?.platform ?? '');
  const failing = checks?.filter((c) => !c.ok).length ?? 0;
  const twice = !!videoKey && data.posts.some((p) => p.id !== post?.id && p.video_key === videoKey &&
    p.account_id === accountId && p.status !== 'rejected');

  function pickVideo(key: string, title: string) {
    setVideoKey(key);
    setVideoTitle(title);
    const v = ix.video.get(key);
    // only prefill a caption the user has not started writing
    if (v && !caption.title && !caption.description && !caption.hashtags.length) setCaption({ ...v.meta });
  }

  async function submit() {
    setBusy(true);
    const body = {
      video_key: videoKey, video_title: videoTitle, account_id: accountId, campaign_id: campaignId, scheduled, status,
      url, views: Math.max(0, Math.round(Number(views) || 0)), notes, caption,
    };
    try {
      if (post) await api.put(`/api/agency/posts/${post.id}`, body);
      else await api.post('/api/agency/posts', body);
      toast(post ? 'Post saved' : 'Post planned', 'good');
      onSaved();
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  return (
    <div className="agency agency-modal">
      <Modal wide title={post ? 'Edit post' : 'New post'} onClose={onClose}>
        <VideoPicker data={data} value={videoKey} title={videoTitle} onChange={pickVideo} />
        {videoKey && <DupeWarnings ix={ix} videoKey={videoKey} />}
        {twice && <div className="notice bad">This video is already planned for {account?.handle}. Posting it twice on one account usually counts as a duplicate.</div>}

        <div className="grid-2">
          <Field label="Account">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.handle} · {a.platform}{a.label ? ` · ${a.label}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Campaign">
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">None</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Scheduled for">
            <input type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </select>
          </Field>
          <Field label="Post link" hint="Paste it after you publish. Needed to refresh views.">
            <input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Views">
            <input type="number" min={0} placeholder="0" value={views} onChange={(e) => setViews(e.target.value)} />
          </Field>
        </div>

        <CaptionFields caption={caption} onChange={setCaption} />

        {campaignId && (
          <div className="card">
            <div className="row between">
              <h3>Campaign rule check</h3>
              {checks && checks.length > 0 && (
                <span className={'pill ' + (failing ? 'bad' : 'good')}>{failing ? `${failing} failing` : 'All rules pass'}</span>
              )}
            </div>
            {!checks ? <span className="muted small">Checking…</span>
              : checks.length === 0 ? <span className="muted small">This campaign has no rules to check.</span>
              : <ChecksList checks={checks} />}
          </div>
        )}

        <Field label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="modal-foot">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon="copy" onClick={async () => toast((await copyText(captionText(caption))) ? 'Caption copied' : 'Could not copy', 'good')}
            disabled={!captionText(caption)}>Copy caption</Button>
          <Button variant="primary" busy={busy} onClick={submit}>{post ? 'Save post' : 'Plan post'}</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ distribute */

function DistributeModal({ data, ix, onClose, onDone }: { data: Data; ix: Index; onClose: () => void; onDone: () => void }) {
  const [videoKey, setVideoKey] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [after, setAfter] = useState(() => toInput(new Date()));
  const [caption, setCaption] = useState<Caption>({ title: '', description: '', hashtags: [] });
  const [busy, setBusy] = useState(false);
  const checks = useRuleCheck(campaignId, caption, ix.video.get(videoKey), '');

  const already = (id: string) => !!videoKey && data.posts.some((p) => p.video_key === videoKey && p.account_id === id && p.status !== 'rejected');
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  function pickVideo(key: string, title: string) {
    setVideoKey(key);
    setVideoTitle(title);
    const v = ix.video.get(key);
    if (v && !caption.title && !caption.description && !caption.hashtags.length) setCaption({ ...v.meta });
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post<{ created: Post[]; skipped: { reason: string }[] }>('/api/agency/posts/distribute', {
        video_key: videoKey, video_title: videoTitle, campaign_id: campaignId, account_ids: picked, after, caption,
      });
      toast(`Planned ${res.created.length} post${res.created.length === 1 ? '' : 's'}` +
        (res.skipped.length ? `. Skipped ${res.skipped.length}: ${res.skipped.map((s) => s.reason).join('; ')}` : ''),
        res.created.length ? 'good' : 'bad');
      onDone();
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  return (
    <div className="agency agency-modal">
      <Modal wide title="Distribute a video" onClose={onClose}>
        <p className="muted">
          Creates one planned post per account, each at that account's next free default posting time. You still publish
          each one yourself.
        </p>
        <VideoPicker data={data} value={videoKey} title={videoTitle} onChange={pickVideo} />
        {videoKey && <DupeWarnings ix={ix} videoKey={videoKey} />}

        <div className="col gap-s">
          <div className="row between">
            <span className="field-label">Accounts ({picked.length} selected)</span>
            <Button small variant="ghost" onClick={() => setPicked(data.accounts.filter((a) => !already(a.id)).map((a) => a.id))}>Select all</Button>
          </div>
          <div className="acct-list">
            {data.accounts.map((a) => (
              <label key={a.id} className={'acct-pick' + (picked.includes(a.id) ? ' on' : '')}>
                <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} disabled={already(a.id)} />
                <span className="grow ellipsis">{a.handle} <span className="muted">· {a.platform}{a.label ? ` · ${a.label}` : ''}</span></span>
                {already(a.id)
                  ? <span className="pill bad">Already planned</span>
                  : <span className="mono small muted">{a.times.length ? a.times.join(', ') : '12:00'}</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="grid-2">
          <Field label="Campaign">
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">None</option>
              {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Start from" hint="The first slot used is the next posting time after this.">
            <input type="datetime-local" value={after} onChange={(e) => setAfter(e.target.value)} />
          </Field>
        </div>

        <CaptionFields caption={caption} onChange={setCaption} />
        {campaignId && checks && checks.length > 0 && (
          <div className="card">
            <h3>Campaign rule check</h3>
            <ChecksList checks={checks} />
          </div>
        )}

        <div className="modal-foot">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!picked.length || (!videoKey && !videoTitle.trim())} onClick={submit}>
            Plan {picked.length || ''} post{picked.length === 1 ? '' : 's'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ campaigns */

function Campaigns({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);

  async function remove(c: Campaign) {
    if (!window.confirm(`Delete the campaign “${c.name}”? Its posts are kept without a campaign.`)) return;
    try {
      await api.del(`/api/agency/campaigns/${c.id}`);
      await reload();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <>
      <div className="row">
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New campaign</Button>
      </div>
      {data.campaigns.length === 0 ? (
        <Panel>
          <Empty icon="dollar" title="No campaigns yet">
            Add a clipping campaign with its rate per 1,000 views, budget and rules. Posts linked to it are checked against
            the rules and counted toward the budget.
          </Empty>
        </Panel>
      ) : (
        <div className="campaigns">
          {data.campaigns.map((c) => {
            const s = c.stats;
            const used = c.budget > 0 ? Math.min(1, s.earned / c.budget) : 0;
            const r = c.rules;
            const ruleBits = [
              ...r.required_hashtags.map((t) => '#' + t),
              ...r.required_mentions,
              r.required_phrase && `“${r.required_phrase}”`,
              (r.min_duration > 0 || r.max_duration > 0) &&
                (r.min_duration > 0 && r.max_duration > 0 ? `${r.min_duration}–${r.max_duration}s`
                  : r.min_duration > 0 ? `≥ ${r.min_duration}s` : `≤ ${r.max_duration}s`),
              r.banned_words.length > 0 && `${r.banned_words.length} banned word${r.banned_words.length === 1 ? '' : 's'}`,
            ].filter(Boolean) as string[];
            return (
              <div className="card campaign" key={c.id}>
                <div className="row between top">
                  <div className="grow">
                    <h2 className="ellipsis">{c.name}</h2>
                    <div className="muted small ellipsis">
                      {[c.creator, c.start || c.end ? `${c.start ? fmtDay(c.start) : '…'} to ${c.end ? fmtDay(c.end) : 'open'}` : '']
                        .filter(Boolean).join(' · ') || 'No creator or dates set'}
                    </div>
                  </div>
                  <div className="row gap-s">
                    {c.link && (
                      <a className="btn ghost small" href={c.link} target="_blank" rel="noreferrer" title="Open campaign page" aria-label="Open campaign page">
                        <Icon name="link" size={14} />
                      </a>
                    )}
                    <Button small variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
                    <Button small variant="ghost" icon="trash" aria-label="Delete campaign" onClick={() => remove(c)} />
                  </div>
                </div>
                {c.platforms.length > 0 && (
                  <div className="rules-list">{c.platforms.map((p) => <span className="pill" key={p}>{p}</span>)}</div>
                )}
                <div className="kv">
                  <div><span>Rate / 1k</span><b>{fmtMoney(c.rate)}</b></div>
                  <div><span>Posts</span><b>{fmtNum(s.posts)}</b></div>
                  <div><span>Views</span><b>{fmtNum(s.views)}</b></div>
                </div>
                <div className={'budget' + (c.budget > 0 && s.remaining !== null && s.remaining <= 0 ? ' spent' : '')}>
                  <div className="budget-top">
                    {c.budget > 0 ? (
                      <>
                        <span>{fmtMoney(s.earned)} of {fmtMoney(c.budget)} used</span>
                        <span>{s.remaining !== null && s.remaining <= 0 ? 'Budget used up' : `${fmtMoney(s.remaining ?? 0)} left`}</span>
                      </>
                    ) : (
                      <>
                        <span>{fmtMoney(s.earned)} earned</span>
                        <span>No budget set</span>
                      </>
                    )}
                  </div>
                  {c.budget > 0 && <div className="bar"><i style={{ width: `${used * 100}%` }} /></div>}
                </div>
                <div className="small muted">
                  {[c.min_views > 0 && `Minimum ${fmtNum(c.min_views)} views`, c.max_payout > 0 && `max ${fmtMoney(c.max_payout)} per post`]
                    .filter(Boolean).join(', ') || 'No minimum views or per-post cap'}
                </div>
                {ruleBits.length > 0 && (
                  <div className="rules-list">{ruleBits.map((b) => <span className="pill accent" key={b}>{b}</span>)}</div>
                )}
                {c.notes && <div className="small muted">{c.notes}</div>}
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <CampaignEditor campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }} />
      )}
    </>
  );
}

function CampaignEditor({ campaign, onClose, onSaved }: { campaign: Campaign | null; onClose: () => void; onSaved: () => void }) {
  const r = campaign?.rules;
  const [f, setF] = useState({
    name: campaign?.name ?? '', creator: campaign?.creator ?? '', platforms: campaign?.platforms ?? ([] as string[]),
    rate: String(campaign?.rate || ''), budget: String(campaign?.budget || ''), max_payout: String(campaign?.max_payout || ''),
    min_views: String(campaign?.min_views || ''), start: campaign?.start ?? '', end: campaign?.end ?? '',
    link: campaign?.link ?? '', notes: campaign?.notes ?? '',
    required_hashtags: r ? tagText(r.required_hashtags) : '', required_mentions: r?.required_mentions.join(', ') ?? '',
    banned_words: r?.banned_words.join(', ') ?? '', min_duration: String(r?.min_duration || ''),
    max_duration: String(r?.max_duration || ''), required_phrase: r?.required_phrase ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    const body = {
      name: f.name, creator: f.creator, platforms: f.platforms, rate: Number(f.rate) || 0, budget: Number(f.budget) || 0,
      max_payout: Number(f.max_payout) || 0, min_views: Number(f.min_views) || 0, start: f.start, end: f.end, link: f.link,
      notes: f.notes,
      rules: {
        required_hashtags: splitTags(f.required_hashtags), required_mentions: splitList(f.required_mentions),
        banned_words: splitList(f.banned_words), min_duration: Number(f.min_duration) || 0,
        max_duration: Number(f.max_duration) || 0, required_phrase: f.required_phrase,
      },
    };
    try {
      if (campaign) await api.put(`/api/agency/campaigns/${campaign.id}`, body);
      else await api.post('/api/agency/campaigns', body);
      toast('Campaign saved', 'good');
      onSaved();
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  return (
    <div className="agency agency-modal">
      <Modal wide title={campaign ? 'Edit campaign' : 'New campaign'} onClose={onClose}>
        <div className="grid-2">
          <Field label="Campaign name"><input type="text" value={f.name} onChange={set('name')} autoFocus /></Field>
          <Field label="Creator or brand"><input type="text" value={f.creator} onChange={set('creator')} /></Field>
        </div>
        <div className="col gap-s">
          <span className="field-label">Platforms</span>
          <div className="check-grid">
            {PLATFORMS.map((p) => {
              const on = f.platforms.includes(p);
              return (
                <label key={p} className={on ? 'on' : ''}>
                  <input type="checkbox" checked={on}
                    onChange={() => setF((cur) => ({ ...cur, platforms: on ? cur.platforms.filter((x) => x !== p) : [...cur.platforms, p] }))} />
                  {p}
                </label>
              );
            })}
          </div>
          <span className="field-hint">Leave all unticked if any platform is allowed.</span>
        </div>
        <div className="grid-2">
          <Field label="Rate per 1,000 views ($)"><input type="number" min={0} step="0.01" value={f.rate} onChange={set('rate')} /></Field>
          <Field label="Total budget ($)" hint="Leave empty for no limit."><input type="number" min={0} value={f.budget} onChange={set('budget')} /></Field>
          <Field label="Max payout per post ($)" hint="Leave empty for no cap."><input type="number" min={0} value={f.max_payout} onChange={set('max_payout')} /></Field>
          <Field label="Minimum views to qualify"><input type="number" min={0} value={f.min_views} onChange={set('min_views')} /></Field>
          <Field label="Start date"><input type="date" value={f.start} onChange={set('start')} /></Field>
          <Field label="End date"><input type="date" value={f.end} onChange={set('end')} /></Field>
        </div>
        <Field label="Campaign link"><input type="url" placeholder="https://…" value={f.link} onChange={set('link')} /></Field>

        <h3>Rules</h3>
        <div className="grid-2">
          <Field label="Required hashtags" hint="Separate with spaces or commas.">
            <input type="text" placeholder="#ad #brandname" value={f.required_hashtags} onChange={set('required_hashtags')} />
          </Field>
          <Field label="Required mentions or credit" hint="Comma separated. Each must appear in the caption.">
            <input type="text" placeholder="@creator, Clip from The Show" value={f.required_mentions} onChange={set('required_mentions')} />
          </Field>
          <Field label="Minimum duration (seconds)"><input type="number" min={0} value={f.min_duration} onChange={set('min_duration')} /></Field>
          <Field label="Maximum duration (seconds)"><input type="number" min={0} value={f.max_duration} onChange={set('max_duration')} /></Field>
          <Field label="Required caption phrase"><input type="text" value={f.required_phrase} onChange={set('required_phrase')} /></Field>
          <Field label="Banned words" hint="Comma separated. Checked in the caption and the transcript.">
            <input type="text" value={f.banned_words} onChange={set('banned_words')} />
          </Field>
        </div>
        <Field label="Notes"><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!f.name.trim()} onClick={submit}>Save campaign</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ accounts */

function Accounts({ data, reload }: TabProps) {
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.posts) m.set(p.account_id, (m.get(p.account_id) ?? 0) + 1);
    return m;
  }, [data.posts]);

  async function remove(a: Account) {
    if (!window.confirm(`Delete the account ${a.handle}?`)) return;
    try {
      await api.del(`/api/agency/accounts/${a.id}`);
      await reload();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <>
      <div className="row">
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New account</Button>
      </div>
      <Panel pad={false}>
        {data.accounts.length === 0 ? (
          <Empty icon="users" title="No accounts yet">
            Add each social account you post to, with the times of day you usually post. The planner uses those times.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Platform</th><th>Handle</th><th>Client or label</th><th>Daily posting times</th><th className="num">Posts</th><th>Notes</th><th /></tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id}>
                    <td><span className="pill">{a.platform}</span></td>
                    <td style={{ fontWeight: 500 }}>{a.handle}</td>
                    <td>{a.label || <span className="faint">–</span>}</td>
                    <td className="mono small">{a.times.length ? a.times.join(', ') : <span className="faint">12:00 (default)</span>}</td>
                    <td className="num">{counts.get(a.id) ?? 0}</td>
                    <td className="muted small" style={{ maxWidth: 260 }}>{a.notes}</td>
                    <td className="actions">
                      <Button small variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                      <Button small variant="ghost" icon="trash" aria-label="Delete account" onClick={() => remove(a)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && (
        <AccountEditor account={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }} />
      )}
    </>
  );
}

function AccountEditor({ account, onClose, onSaved }: { account: Account | null; onClose: () => void; onSaved: () => void }) {
  const [platform, setPlatform] = useState(account?.platform ?? 'TikTok');
  const [handle, setHandle] = useState(account?.handle ?? '');
  const [label, setLabel] = useState(account?.label ?? '');
  const [times, setTimes] = useState(account?.times.join(', ') ?? '09:00, 18:00');
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const body = { platform, handle, label, times: splitList(times), notes };
    try {
      if (account) await api.put(`/api/agency/accounts/${account.id}`, body);
      else await api.post('/api/agency/accounts', body);
      toast('Account saved', 'good');
      onSaved();
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  return (
    <div className="agency agency-modal">
      <Modal title={account ? 'Edit account' : 'New account'} onClose={onClose}>
        <div className="grid-2">
          <Field label="Platform">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Handle"><input type="text" placeholder="@name" value={handle} onChange={(e) => setHandle(e.target.value)} autoFocus /></Field>
        </div>
        <Field label="Client or label"><input type="text" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Daily posting times" hint="24-hour times, comma separated. Used when you distribute a video.">
          <input type="text" placeholder="09:00, 18:00" value={times} onChange={(e) => setTimes(e.target.value)} />
        </Field>
        <Field label="Notes"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!handle.trim()} onClick={submit}>Save account</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ analytics */

function AnalyticsTab({ data }: { data: Data }) {
  const [a, setA] = useState<Analytics | null>(null);
  useEffect(() => {
    api.get<Analytics>('/api/agency/analytics').then(setA).catch(toastError);
  }, [data]);
  if (!a) return <div className="muted">Loading…</div>;
  const t = a.totals;

  const table = (title: string, head: string, rows: { key: string; name: ReactNode; b: Bucket; extra?: ReactNode }[], extraHead?: string) => (
    <Panel title={title} pad={false}>
      {rows.length === 0 ? <div className="panel-body muted">No posts yet.</div> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{head}</th><th className="num">Posts</th><th className="num">Live</th><th className="num">Views</th>
                <th className="num">Est. earnings</th>{extraHead && <th className="num">{extraHead}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td><td className="num">{fmtNum(r.b.posts)}</td><td className="num">{fmtNum(r.b.live)}</td>
                  <td className="num">{fmtNum(r.b.views)}</td><td className="num">{fmtMoney(r.b.earned)}</td>
                  {extraHead && <td className="num">{r.extra}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  return (
    <>
      <div className="stats">
        <div className="card stat"><span>Posts planned</span><b>{fmtNum(t.posts)}</b></div>
        <div className="card stat"><span>Posts live</span><b>{fmtNum(t.live)}</b></div>
        <div className="card stat"><span>Views</span><b>{fmtNum(t.views)}</b></div>
        <div className="card stat"><span>Estimated earnings</span><b>{fmtMoney(t.earned)}</b></div>
        <div className="card stat"><span>Of which paid</span><b>{fmtMoney(t.paid)}</b></div>
      </div>
      <div className="notice"><b>How this is counted.</b> {a.rule}</div>

      <Panel title="Total tracked views over time">
        {a.timeline.length === 0 ? (
          <Empty icon="chart" title="No view counts recorded yet">
            Enter views on a live post, or refresh them from the post link. Each day's count is kept so the total can be
            charted.
          </Empty>
        ) : (
          <>
            <ViewsChart points={a.timeline} />
            <details>
              <summary>Show the numbers as a table</summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Day</th><th className="num">Total views</th></tr></thead>
                  <tbody>
                    {a.timeline.map((p) => <tr key={p.date}><td>{fmtDay(p.date)}</td><td className="num">{fmtNum(p.views)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Panel>

      {table('By campaign', 'Campaign',
        a.by_campaign.map((r) => ({ key: r.id || 'none', name: r.name, b: r, extra: r.remaining === null ? '–' : fmtMoney(r.remaining) })),
        'Budget left')}
      {table('By account', 'Account',
        a.by_account.map((r) => ({ key: r.id || 'none', name: <>{r.handle} <span className="muted">· {r.platform}</span></>, b: r })))}
      {table('By platform', 'Platform', a.by_platform.map((r) => ({ key: r.platform, name: r.platform, b: r })))}
    </>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Single-series line chart: total tracked views per day. Hover for the exact value. */
function ViewsChart({ points }: { points: { date: string; views: number }[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(260, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(260, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const H = 240;
  const m = { top: 14, right: 16, bottom: 30, left: 48 };
  const iw = width - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const t0 = fromInput(points[0].date).getTime();
  const t1 = fromInput(points[points.length - 1].date).getTime();
  const max = niceMax(Math.max(...points.map((p) => p.views)));
  const x = (d: string) => m.left + (t1 === t0 ? iw / 2 : ((fromInput(d).getTime() - t0) / (t1 - t0)) * iw);
  const y = (v: number) => m.top + ih - (v / max) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.views).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  // at most ~6 date labels, always including the first and last
  const step = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 90))));
  const labelled = points.map((_, i) => i).filter((i) => i % step === 0 && points.length - 1 - i >= step / 2);
  if (!labelled.includes(points.length - 1)) labelled.push(points.length - 1);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    setHover(best);
  }

  const hp = hover !== null ? points[hover] : null;
  return (
    <div className="chart" ref={wrap}>
      <svg height={H} viewBox={`0 0 ${width} ${H}`} role="img" onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        aria-label={`Total tracked views per day, from ${fmtDay(points[0].date)} to ${fmtDay(points[points.length - 1].date)}. Latest: ${fmtNum(points[points.length - 1].views)} views.`}>
        {ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? 'base' : 'grid'} x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={m.left - 8} y={y(v) + 4} textAnchor="end">{compact(v)}</text>
          </g>
        ))}
        {labelled.map((i) => (
          <text key={i} className="axis" x={x(points[i].date)} y={H - 8}
            textAnchor={points.length === 1 ? 'middle' : i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {fmtDay(points[i].date)}
          </text>
        ))}
        {hp && <line className="cross" x1={x(hp.date)} x2={x(hp.date)} y1={m.top} y2={m.top + ih} />}
        {points.length > 1 && <path className="line" d={path} />}
        {(points.length <= 14 ? points : hp ? [hp] : []).map((p) => (
          <circle key={p.date} className="dot" cx={x(p.date)} cy={y(p.views)} r={hp?.date === p.date ? 5.5 : 4} />
        ))}
        {hp && points.length > 14 && <circle className="dot" cx={x(hp.date)} cy={y(hp.views)} r={5.5} />}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: Math.min(width - 70, Math.max(70, x(hp.date))), top: y(hp.views) >= 62 ? y(hp.views) - 58 : y(hp.views) + 14 }}>
          <b>{fmtNum(hp.views)} views</b>
          {fmtDay(hp.date)}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ videos: review status and duplicates */

function Videos({ data, reload }: TabProps) {
  const ix = useIndex(data);
  const planned = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.posts) if (p.video_key) m.set(p.video_key, (m.get(p.video_key) ?? 0) + 1);
    return m;
  }, [data.posts]);

  async function setStatus(v: Video, status: string) {
    try {
      await api.patch(`/api/exports/${v.id}`, { status });
      await reload();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <>
      <Panel title={`Possible duplicates (${data.dupes.pairs.length})`}>
        {data.dupes.pairs.length === 0 ? (
          <span className="muted">
            No two videos look alike. A pair is flagged when both come from the same source and at least half of the
            shorter one overlaps, or when their transcripts are at least 60% alike.
          </span>
        ) : (
          <div>
            {data.dupes.pairs.map((p) => (
              <div className="pair" key={p.a + p.b}>
                <Icon name="alert" size={18} />
                <div className="pair-titles">
                  <div><b>{p.a_title}</b> <span className="muted small">({p.a.split(':')[0]})</span></div>
                  <div><b>{p.b_title}</b> <span className="muted small">({p.b.split(':')[0]})</span></div>
                  <div className="muted small">{p.reasons.join('. ')}.</div>
                </div>
                <span className="pill bad">{Math.round(p.score * 100)}% match</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {data.dupes.double_bookings.length > 0 && (
        <Panel title={`Planned twice for the same account (${data.dupes.double_bookings.length})`}>
          <div>
            {data.dupes.double_bookings.map((d) => (
              <div className="pair" key={d.video_key + d.account_id}>
                <Icon name="alert" size={18} />
                <div className="pair-titles">
                  <div><b>{ix.video.get(d.video_key)?.title ?? d.video_key}</b></div>
                  <div className="muted small">
                    {d.post_ids.length} posts on {ix.account.get(d.account_id)?.handle ?? 'a deleted account'}. Remove the extras in the planner.
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Review status" pad={false}>
        {data.videos.length === 0 ? (
          <Empty icon="film" title="No videos yet">
            Shorts you render in the studio and clips you cut in the clipper appear here. Approve a short before you plan it.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Video</th><th>Type</th><th className="num">Length</th><th>Review status</th><th className="num">Planned posts</th><th /></tr>
              </thead>
              <tbody>
                {data.videos.map((v) => (
                  <tr key={v.key}>
                    <td>
                      <div className="cell-title ellipsis">{v.title}</div>
                      {ix.dupeKeys.has(v.key) && <span className="pill bad" style={{ marginTop: 2 }}>Possible duplicate</span>}
                    </td>
                    <td>{v.kind === 'export' ? 'Short' : 'Clip'}</td>
                    <td className="num">{v.duration ? fmtDur(v.duration) : '–'}</td>
                    <td>
                      {v.kind === 'export' ? (
                        <Seg small value={v.status} onChange={(s) => setStatus(v, s)}
                          options={[{ value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Approved' }, { value: 'posted', label: 'Posted' }]} />
                      ) : <span className="faint small">Clips have no review step</span>}
                    </td>
                    <td className="num">{planned.get(v.key) ?? 0}</td>
                    <td className="actions">
                      {v.file && (
                        <a className="btn ghost small" href={v.file} download title="Download video" aria-label="Download video">
                          <Icon name="download" size={14} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
