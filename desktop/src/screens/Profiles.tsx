import { useEffect, useMemo, useState } from "react";
import { ago, api, LaunchOptions, Profile, Proxy, ProxyCheckResultLite } from "../api";
import type { Shared } from "../App";
import { Avatar, CC, Icons, fpLine, osLabel } from "../ui";

// ---------------------------------------------------------------- list screen
export default function Profiles({ s, group }: { s: Shared; group: string }) {
  const { profiles, proxies, reload, notify, go } = s;
  const [filter, setFilter] = useState("");
  const [pill, setPill] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [cookieTarget, setCookieTarget] = useState<Profile | null>(null);

  const groups = useMemo(() => Array.from(new Set(profiles.map((p) => p.group_name).filter(Boolean))) as string[], [profiles]);
  const activeGroup = group || pill;
  const visible = profiles.filter(
    (p) =>
      (!activeGroup || p.group_name === activeGroup) &&
      (!filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.tags.some((t) => t.includes(filter.toLowerCase()))),
  );
  const running = profiles.filter((p) => p.status === "running").length;

  const withBusy = async (ids: string[], fn: (id: string) => Promise<unknown>) => {
    setBusy((b) => new Set([...b, ...ids]));
    for (const id of ids) {
      try {
        await fn(id);
      } catch (e) {
        const name = profiles.find((p) => p.id === id)?.name ?? id;
        notify(`${name}: ${(e as Error).message}`);
      }
    }
    setBusy((b) => { const n = new Set(b); ids.forEach((i) => n.delete(i)); return n; });
    await reload();
  };
  const start = (ids: string[]) => withBusy(ids, (id) => api(`/profiles/${id}/start`, { method: "POST" }));
  const stop = (ids: string[]) => withBusy(ids, (id) => api(`/profiles/${id}/stop`, { method: "POST" }));
  const leak = (ids: string[]) =>
    withBusy(ids, async (id) => {
      const r = await api<{ passed: boolean; checks: { name: string; passed: boolean }[] }>(`/profiles/${id}/selftest`, { method: "POST" });
      const name = profiles.find((p) => p.id === id)?.name ?? id;
      notify(r.passed ? `Leak test passed for ${name}` : `${name}: ${r.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`);
    });
  const remove = async (ids: string[]) => {
    if (!window.confirm(`Delete ${ids.length === 1 ? "this profile" : ids.length + " profiles"} and all browser data? This cannot be undone.`)) return;
    await withBusy(ids, (id) => api(`/profiles/${id}?confirm=true`, { method: "DELETE" }));
    setSelected(new Set());
  };
  const assignProxy = async (ids: string[]) => {
    const pick = window.prompt("Proxy label or host to assign (leave empty to clear):", "");
    if (pick === null) return;
    const proxy = proxies.find((x) => x.id === pick || x.host === pick || x.label === pick);
    if (pick && !proxy) return notify("No such proxy");
    await withBusy(ids, (id) => api(`/profiles/${id}`, { method: "PATCH", json: proxy ? { proxy_id: proxy.id } : { clear_proxy: true } }));
  };
  const clone = (p: Profile) =>
    withBusy([p.id], async () => {
      const copy = window.confirm("Copy cookies into the clone? (OK = yes, Cancel = fresh)");
      await api(`/profiles/${p.id}/clone`, { method: "POST", json: { copy_cookies: copy } });
      notify("Cloned with a new fingerprint");
    });

  const toggle = (id: string) => setSelected((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sel = Array.from(selected);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Profiles</h2>
          <div className="sub">{profiles.length} profiles · {running} running · each with its own storage, proxy and fingerprint</div>
        </div>
        <div className="grow" />
        <div className="actions">
          <button className="lg" onClick={() => setCookieTarget(profiles[0] ?? null)} disabled={!profiles.length}>Import cookies</button>
          <button className="primary lg" onClick={() => go({ tab: "profiles", edit: "new" })}><Icons.plus /> New profile</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search"><Icons.search /><input placeholder="Search by name or tag" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        {!group && (
          <div className="pills">
            <button className={"pill" + (!pill ? " active" : "")} onClick={() => setPill("")}>All</button>
            {groups.map((g) => <button key={g} className={"pill" + (pill === g ? " active" : "")} onClick={() => setPill(pill === g ? "" : g)}>{g}</button>)}
          </div>
        )}
      </div>

      {sel.length > 0 && (
        <div className="selbar">
          <span className="n">{sel.length} selected</span>
          <button className="sm" onClick={() => start(sel)}>Start</button>
          <button className="sm" onClick={() => stop(sel.filter((id) => profiles.find((p) => p.id === id)?.status === "running"))}>Stop</button>
          <button className="sm" onClick={() => assignProxy(sel)}>Assign proxy</button>
          <button className="sm" onClick={() => leak(sel)}>Run leak test</button>
          <button className="sm danger" onClick={() => remove(sel)}>Delete</button>
          <button className="sm ghost" onClick={() => setSelected(new Set())}><Icons.x /></button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th>Profile</th>
              <th>Proxy</th>
              <th>Fingerprint</th>
              <th>Leak test</th>
              <th>Last used</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id} className={selected.has(p.id) ? "selected" : ""}>
                <td><input type="checkbox" style={{ width: 16, height: 16 }} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                <td>
                  <div className="who">
                    <Avatar name={p.name} />
                    <div>
                      <a href="#" className="cell-title" onClick={(e) => { e.preventDefault(); go({ tab: "profiles", edit: p }); }}>{p.name}</a>
                      <div className="cell-sub">{[p.group_name, ...p.tags].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {p.proxy ? (
                    <div className="who">
                      <CC code={p.geo_override?.locale?.split("-")[1] || p.proxy.last_geo?.country} />
                      <div>
                        <div className={"cell-title" + (p.proxy.healthy === false ? " error" : "")}>{p.proxy.label || p.proxy.host}</div>
                        <div className="mono">{p.proxy.last_exit_ip || `${p.proxy.host}:${p.proxy.port}`}</div>
                      </div>
                    </div>
                  ) : (
                    <span className="badge warn sq">No proxy</span>
                  )}
                </td>
                <td>{fpLine(p)}</td>
                <td>
                  {p.last_selftest_passed === null ? (
                    <span className="badge plain" style={{ border: "1px dashed var(--line-2)", background: "transparent" }}>Not run</span>
                  ) : p.last_selftest_passed ? (
                    <span className="badge ok plain"><Icons.check /> Passed</span>
                  ) : (
                    <span className="badge warn plain" title={p.last_selftest_at || ""}><Icons.warn /> Issues</span>
                  )}
                </td>
                <td className="muted">{ago(p.last_used_at)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {p.status === "running" && <span className="status-run">Running</span>}
                  {p.status === "running" ? (
                    <button className="sm stop" disabled={busy.has(p.id)} onClick={() => stop([p.id])}><Icons.stop /> Stop</button>
                  ) : (
                    <button className="sm" disabled={busy.has(p.id) || p.status === "starting"} onClick={() => start([p.id])}><Icons.play /> Start</button>
                  )}
                  <button className="sm ghost" title="Clone" onClick={() => clone(p)}>Clone</button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={7} className="empty">No profiles here yet. Create one; it gets a frozen fingerprint matching this PC.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {cookieTarget && <CookieImportDialog profiles={profiles} initial={cookieTarget} onClose={() => setCookieTarget(null)} notify={notify} />}
    </div>
  );
}

function CookieImportDialog({ profiles, initial, onClose, notify }: { profiles: Profile[]; initial: Profile; onClose: () => void; notify: (m: string) => void }) {
  const [target, setTarget] = useState(initial.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fmt = text.trim().startsWith("[") || text.trim().startsWith("{") ? "json" : "netscape";
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ imported: number; skipped_expired: number }>(`/profiles/${target}/cookies/import`, { method: "POST", json: { format: fmt, text } });
      notify(`Imported ${r.imported} cookies${r.skipped_expired ? `, ${r.skipped_expired} expired skipped` : ""}`);
      onClose();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Import cookies</h3>
        <div className="field"><label className="lbl">Into profile</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        <div className="field"><label className="lbl">Paste JSON (Playwright / extension export) or Netscape cookies.txt — format detected: {fmt}</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>The profile is started briefly if it is not running.</p>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!text.trim() || busy} onClick={run}>{busy ? "Importing…" : "Import"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- create / edit page
type ProxyMode = "saved" | "new" | "none";

export function ProfileForm({ s, profile }: { s: Shared; profile: Profile | null }) {
  const { proxies, reload, notify, go } = s;
  const [name, setName] = useState(profile?.name ?? "");
  const [group, setGroup] = useState(profile?.group_name ?? "");
  const [tags, setTags] = useState(profile?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(profile?.notes ?? "");
  const [startUrl, setStartUrl] = useState(profile?.launch_options.start_url ?? "");
  const [os, setOs] = useState(profile?.os ?? "windows");
  const [proxyMode, setProxyMode] = useState<ProxyMode>(profile?.proxy_id ? "saved" : "none");
  const [proxyId, setProxyId] = useState(profile?.proxy_id ?? "");
  const [newProxy, setNewProxy] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<ProxyCheckResultLite | null>(null);
  const [matchProxy, setMatchProxy] = useState(!profile?.geo_override);
  const [tz, setTz] = useState(profile?.geo_override?.timezone ?? "");
  const [locale, setLocale] = useState(profile?.geo_override?.locale ?? "");
  const [opts, setOpts] = useState<LaunchOptions>(profile?.launch_options ?? { webrtc: "proxy", block_images: false, humanize: false, extensions: [] });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Profile | null>(profile);

  const groups = Array.from(new Set(s.profiles.map((p) => p.group_name).filter(Boolean))) as string[];
  const chosen = proxies.find((p) => p.id === proxyId) || null;
  const geo = checkResult?.geo || chosen?.last_geo || null;

  useEffect(() => {
    setCheckResult(null);
  }, [proxyId]);

  const checkProxy = async () => {
    if (!proxyId) return;
    setChecking(true);
    try {
      setCheckResult(await api<ProxyCheckResultLite>(`/proxies/${proxyId}/check`, { method: "POST" }));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setChecking(false);
      reload();
    }
  };

  const regenerate = async () => {
    if (!preview) return;
    if (!window.confirm("Generate a brand-new fingerprint? Sites will see a different device.")) return;
    try {
      setPreview(await api<Profile>(`/profiles/${preview.id}/regenerate-fingerprint`, { method: "POST", json: { os } }));
      notify("Fingerprint regenerated");
      reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      let pid = proxyId;
      if (proxyMode === "new") {
        const created = await api<Proxy>("/proxies/bulk-import", { method: "POST", json: { text: newProxy } }).then((r: any) => r.created?.[0]);
        if (!created) throw new Error("Could not parse that proxy line");
        pid = created.id;
      }
      const geoOverride = matchProxy ? null : { timezone: tz || null, locale: locale || null };
      const launch_options = { ...opts, start_url: startUrl || null };
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (profile) {
        await api(`/profiles/${profile.id}`, {
          method: "PATCH",
          json: {
            name, group_name: group || null, tags: tagList, notes: notes || null, launch_options,
            ...(proxyMode === "none" ? { clear_proxy: true } : { proxy_id: pid }),
            ...(geoOverride ? { geo_override: geoOverride } : { clear_geo_override: true }),
          },
        });
        notify("Saved");
      } else {
        await api("/profiles", {
          method: "POST",
          json: { name, group_name: group || null, tags: tagList, notes: notes || null, os, proxy_id: proxyMode === "none" ? null : pid, geo_override: geoOverride, launch_options },
        });
        notify("Profile created. A leak test runs in the background.");
      }
      await reload();
      go({ tab: "profiles" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fp = preview?.fingerprint_summary;
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="crumbs"><a href="#" onClick={(e) => { e.preventDefault(); go({ tab: "profiles" }); }}>Profiles</a> / <b>{profile ? profile.name : "New profile"}</b></div>
          <h2>{profile ? "Edit profile" : "New profile"}</h2>
        </div>
        <div className="grow" />
        <div className="actions">
          <button className="lg" onClick={() => go({ tab: "profiles" })}>Cancel</button>
          <button className="primary lg" onClick={save} disabled={saving || !name.trim() || (proxyMode === "saved" && !proxyId) || (proxyMode === "new" && !newProxy.trim())}>
            {saving ? "Saving…" : profile ? "Save changes" : "Create profile"}
          </button>
        </div>
      </div>
      {err && <div className="banner warn"><Icons.warn /> {err}</div>}

      <div className="form-grid">
        <div>
          <div className="card">
            <h3>Basics</h3>
            <div className="field"><h4>Name</h4><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client C — Storefront" autoFocus /></div>
            <div className="cols">
              <div className="field"><label className="lbl">Group</label>
                <input list="groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Work" />
                <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
              </div>
              <div className="field"><label className="lbl">Tags</label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="client-c, shop" /></div>
            </div>
            <div className="field"><h4>Start page (optional)</h4><input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} placeholder="https://" /></div>
          </div>

          <div className="card">
            <h3>Proxy</h3>
            <div className="radios">
              <label className={"radio" + (proxyMode === "saved" ? " active" : "")}><input type="radio" checked={proxyMode === "saved"} onChange={() => setProxyMode("saved")} /> Saved proxy</label>
              <label className={"radio" + (proxyMode === "new" ? " active" : "")}><input type="radio" checked={proxyMode === "new"} onChange={() => setProxyMode("new")} /> Paste a new one</label>
              <label className={"radio wide" + (proxyMode === "none" ? " active" : "")}><input type="radio" checked={proxyMode === "none"} onChange={() => setProxyMode("none")} /> No proxy</label>
            </div>
            {proxyMode === "saved" && (
              <div className="field">
                <h4>Saved proxy</h4>
                <div className="cols" style={{ gridTemplateColumns: "1fr auto" }}>
                  <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
                    <option value="">Choose…</option>
                    {proxies.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label || x.host} · {x.last_geo?.country || "?"} {x.last_geo?.city || ""} · {x.profile_count ? `used by ${x.profile_count} profile${x.profile_count > 1 ? "s" : ""}` : "not used by any profile"}
                      </option>
                    ))}
                  </select>
                  <button onClick={checkProxy} disabled={!proxyId || checking}>{checking ? "Checking…" : "Check"}</button>
                </div>
                {(checkResult || chosen?.last_checked_at) && (
                  (checkResult ? checkResult.healthy : chosen?.healthy) ? (
                    <div className="hint-ok"><Icons.check /> Checked {checkResult ? "just now" : ago(chosen!.last_checked_at)} · exit IP {checkResult?.exit_ip || chosen?.last_exit_ip} · {Math.round(checkResult?.latency_ms || chosen?.last_latency_ms || 0)} ms</div>
                  ) : (
                    <div className="hint-bad">Proxy is down: {checkResult?.error || chosen?.last_error}. The profile will refuse to start until it recovers.</div>
                  )
                )}
                {chosen && chosen.profile_count > 0 && !profile?.proxy_id && <div className="hint-bad" style={{ color: "var(--warn)" }}>Another profile already uses this proxy. Two profiles on one exit IP can be linked.</div>}
              </div>
            )}
            {proxyMode === "new" && (
              <div className="field"><label className="lbl">scheme://user:pass@host:port or host:port:user:pass</label><input value={newProxy} onChange={(e) => setNewProxy(e.target.value)} placeholder="socks5://user:pass@gb1.proxy.example:1080" /></div>
            )}
            {proxyMode === "none" && <div className="banner warn" style={{ marginBottom: 0 }}><Icons.warn /> Without a proxy this profile exposes your real IP. The leak test will flag it.</div>}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Location and language</h3>
              <label className="check-row">Match the proxy <input type="checkbox" checked={matchProxy} onChange={(e) => setMatchProxy(e.target.checked)} /></label>
            </div>
            <div className="cols">
              <div className="field"><label className="lbl">Timezone</label><input disabled={matchProxy} value={matchProxy ? geo?.timezone || "" : tz} onChange={(e) => setTz(e.target.value)} placeholder="Europe/London" /></div>
              <div className="field"><label className="lbl">Language</label><input disabled={matchProxy} value={matchProxy ? geo?.locale || "" : locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-GB" /></div>
            </div>
            <div className="cols">
              <div className="field"><label className="lbl">WebRTC</label>
                <select value={opts.webrtc} onChange={(e) => setOpts({ ...opts, webrtc: e.target.value as "proxy" | "block" })}>
                  <option value="proxy">Proxy IP only</option>
                  <option value="block">Disabled</option>
                </select>
              </div>
              <div className="field"><label className="lbl">Extensions (.xpi paths, separated by ;)</label>
                <input value={opts.extensions.join("; ")} onChange={(e) => setOpts({ ...opts, extensions: e.target.value.split(";").map((x) => x.trim()).filter(Boolean) })} placeholder="C:\\ext\\ublock.xpi" />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}><label className="lbl">Notes</label><textarea style={{ minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </div>
        </div>

        <div className="card" style={{ position: "sticky", top: 0 }}>
          <div className="card-head">
            <h3>Fingerprint</h3>
            {preview && <button className="sm" onClick={regenerate} disabled={preview.status === "running"}><Icons.refresh /> Regenerate</button>}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Taken from real-world device data so every value fits together. Generated once and reused on every launch.</p>
          {fp ? (
            <div className="kv">
              <div>OS</div><div>{osLabel(fp.os || preview?.os)}</div>
              <div>Browser</div><div>Firefox-based (Camoufox){fp.browser_version ? `, ${fp.browser_version}` : ""}, version pinned</div>
              <div>Screen</div><div>{fp.screen?.replace("x", " × ") || "—"}</div>
              <div>Window</div><div>{(fp as any).window?.replace("x", " × ") || "follows screen"}</div>
              <div>Graphics</div><div>{fp.gpu_renderer || "—"}</div>
              <div>CPU cores</div><div>{fp.hardware_concurrency ?? "—"}</div>
              <div>Languages</div><div>{fp.languages.join(", ") || "from proxy"}</div>
              <div>Fonts</div><div>Standard {osLabel(fp.os || preview?.os)} set</div>
              <div>WebRTC</div><div>{opts.webrtc === "proxy" ? "Proxy IP only" : "Disabled"}</div>
            </div>
          ) : (
            <>
              <div className="field"><label className="lbl">Target OS</label>
                <select value={os} onChange={(e) => setOs(e.target.value)}>
                  <option value="windows">Windows (matches this PC)</option>
                  <option value="macos">macOS</option>
                  <option value="linux">Linux</option>
                </select>
              </div>
              <div className="kv">
                <div>OS</div><div>{osLabel(os)}</div>
                <div>Browser</div><div>Firefox-based (Camoufox), version pinned</div>
                <div>Screen</div><div>sampled on create</div>
                <div>Graphics</div><div>sampled on create</div>
                <div>CPU cores</div><div>sampled on create</div>
                <div>WebRTC</div><div>{opts.webrtc === "proxy" ? "Proxy IP only" : "Disabled"}</div>
              </div>
            </>
          )}
          <div className="banner info" style={{ marginTop: 14, marginBottom: 0 }}><Icons.info /> {os === "windows" || (fp && osLabel(fp.os) === "Windows") ? "The OS is set to Windows to match this PC. Faking a different OS is easy to spot." : "This OS differs from the host. Font rendering and TLS can give it away."}</div>
        </div>
      </div>
    </div>
  );
}
