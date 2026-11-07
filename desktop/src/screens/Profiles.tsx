import { useCallback, useEffect, useMemo, useState } from "react";
import { ago, api, flag, LaunchOptions, Profile, Proxy } from "../api";

interface Props {
  notify: (m: string) => void;
}

export default function Profiles({ notify }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [p, x] = await Promise.all([api<Profile[]>("/profiles"), api<Proxy[]>("/proxies")]);
      setProfiles(p);
      setProxies(x);
    } catch (e) {
      /* daemon offline; App shows the banner */
    }
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [load]);

  const groups = useMemo(() => Array.from(new Set(profiles.map((p) => p.group_name).filter(Boolean))) as string[], [profiles]);
  const visible = profiles.filter(
    (p) =>
      (!group || p.group_name === group) &&
      (!filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.tags.some((t) => t.includes(filter))),
  );

  const withBusy = async (id: string, fn: () => Promise<unknown>) => {
    setBusy((b) => new Set(b).add(id));
    try {
      await fn();
    } catch (e) {
      notify(String((e as Error).message));
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
      load();
    }
  };

  const start = (p: Profile) => withBusy(p.id, () => api(`/profiles/${p.id}/start`, { method: "POST" }));
  const stop = (p: Profile) => withBusy(p.id, () => api(`/profiles/${p.id}/stop`, { method: "POST" }));
  const selftest = (p: Profile) =>
    withBusy(p.id, async () => {
      const r = await api<{ passed: boolean; checks: { name: string; passed: boolean }[] }>(`/profiles/${p.id}/selftest`, { method: "POST" });
      notify(r.passed ? `Self-test passed for ${p.name}` : `Self-test FAILED: ${r.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`);
    });
  const remove = async (p: Profile) => {
    if (!window.confirm(`Delete "${p.name}" and all its browser data? This cannot be undone.`)) return;
    await withBusy(p.id, () => api(`/profiles/${p.id}?confirm=true`, { method: "DELETE" }));
  };
  const clone = (p: Profile) =>
    withBusy(p.id, async () => {
      const copy = window.confirm("Copy cookies into the clone? (OK = yes, Cancel = fresh)");
      await api(`/profiles/${p.id}/clone`, { method: "POST", json: { copy_cookies: copy } });
      notify("Cloned with a new fingerprint");
    });

  const bulk = async (action: "start" | "stop" | "delete" | "proxy") => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(`Delete ${ids.length} profiles and their data?`)) return;
    let proxyId: string | null = null;
    if (action === "proxy") {
      const label = window.prompt("Proxy id or host to assign (empty = clear):", "");
      if (label === null) return;
      proxyId = proxies.find((x) => x.id === label || x.host === label || x.label === label)?.id ?? null;
      if (label && !proxyId) return notify("No such proxy");
    }
    for (const id of ids) {
      try {
        if (action === "start") await api(`/profiles/${id}/start`, { method: "POST" });
        if (action === "stop") await api(`/profiles/${id}/stop`, { method: "POST" });
        if (action === "delete") await api(`/profiles/${id}?confirm=true`, { method: "DELETE" });
        if (action === "proxy") await api(`/profiles/${id}`, { method: "PATCH", json: proxyId ? { proxy_id: proxyId } : { clear_proxy: true } });
      } catch (e) {
        notify(`${id}: ${(e as Error).message}`);
      }
    }
    setSelected(new Set());
    load();
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div>
      <h2>Profiles</h2>
      <div className="toolbar">
        <input placeholder="Search name or tag…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <div className="grow" />
        {selected.size > 0 && (
          <>
            <span className="muted">{selected.size} selected</span>
            <button className="secondary" onClick={() => bulk("start")}>Start</button>
            <button className="secondary" onClick={() => bulk("stop")}>Stop</button>
            <button className="secondary" onClick={() => bulk("proxy")}>Assign proxy</button>
            <button className="danger" onClick={() => bulk("delete")}>Delete</button>
          </>
        )}
        <button onClick={() => setEditing("new")}>New profile</button>
      </div>
      <table>
        <thead>
          <tr>
            <th />
            <th>Name</th>
            <th>Group</th>
            <th>Tags</th>
            <th>Proxy</th>
            <th>Geo</th>
            <th>Status</th>
            <th>Test</th>
            <th>Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visible.map((p) => (
            <tr key={p.id} className={selected.has(p.id) ? "selected" : ""}>
              <td><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
              <td>
                <a href="#" onClick={(e) => { e.preventDefault(); setEditing(p); }}>{p.name}</a>
                <div className="muted mono">{p.os} · {p.fingerprint_summary.screen} · FF {p.fingerprint_summary.browser_version}</div>
              </td>
              <td>{p.group_name || <span className="muted">—</span>}</td>
              <td>{p.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</td>
              <td>
                {p.proxy ? (
                  <span title={`${p.proxy.scheme}://${p.proxy.host}:${p.proxy.port}`}>
                    <span className={"badge " + (p.proxy.healthy === false ? "bad" : p.proxy.healthy ? "ok" : "")}>{p.proxy.label || p.proxy.host}</span>
                  </span>
                ) : (
                  <span className="badge warn">direct</span>
                )}
              </td>
              <td>
                {flag(p.geo_override?.timezone ? undefined : p.proxy?.last_geo?.country)}{" "}
                <span className="muted">{p.geo_override?.timezone || p.proxy?.last_geo?.timezone || ""}</span>
              </td>
              <td><span className={"badge " + (p.status === "running" ? "ok" : "")}>{p.status}</span></td>
              <td>
                {p.last_selftest_passed === null ? <span className="muted">—</span> : (
                  <span className={"badge " + (p.last_selftest_passed ? "ok" : "bad")} title={p.last_selftest_at || ""}>{p.last_selftest_passed ? "pass" : "fail"}</span>
                )}
              </td>
              <td className="muted">{ago(p.last_used_at)}</td>
              <td className="row">
                {p.status === "running" ? (
                  <button className="secondary" disabled={busy.has(p.id)} onClick={() => stop(p)}>Stop</button>
                ) : (
                  <button disabled={busy.has(p.id)} onClick={() => start(p)}>Start</button>
                )}
                <button className="secondary" disabled={busy.has(p.id)} onClick={() => selftest(p)} title="Leak self-test">Test</button>
                <button className="secondary" disabled={busy.has(p.id)} onClick={() => clone(p)}>Clone</button>
                <button className="danger" disabled={busy.has(p.id)} onClick={() => remove(p)}>✕</button>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr><td colSpan={10} className="muted">No profiles yet. Create one to get a frozen Windows fingerprint.</td></tr>
          )}
        </tbody>
      </table>
      {editing && (
        <EditDialog
          profile={editing === "new" ? null : editing}
          proxies={proxies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function EditDialog({ profile, proxies, onClose, onSaved, notify }: {
  profile: Profile | null;
  proxies: Proxy[];
  onClose: () => void;
  onSaved: () => void;
  notify: (m: string) => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [group, setGroup] = useState(profile?.group_name ?? "");
  const [tags, setTags] = useState(profile?.tags.join(", ") ?? "");
  const [notes, setNotes] = useState(profile?.notes ?? "");
  const [os, setOs] = useState(profile?.os ?? "windows");
  const [proxyId, setProxyId] = useState(profile?.proxy_id ?? "");
  const [maxW, setMaxW] = useState("");
  const [maxH, setMaxH] = useState("");
  const [tz, setTz] = useState(profile?.geo_override?.timezone ?? "");
  const [locale, setLocale] = useState(profile?.geo_override?.locale ?? "");
  const [opts, setOpts] = useState<LaunchOptions>(
    profile?.launch_options ?? { webrtc: "proxy", block_images: false, humanize: false, extensions: [] },
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setSaving(true);
    setErr("");
    const geo = tz || locale ? { timezone: tz || null, locale: locale || null } : null;
    try {
      if (profile) {
        await api(`/profiles/${profile.id}`, {
          method: "PATCH",
          json: {
            name, group_name: group || null, notes: notes || null,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
            ...(proxyId ? { proxy_id: proxyId } : { clear_proxy: true }),
            ...(geo ? { geo_override: geo } : { clear_geo_override: true }),
            launch_options: opts,
          },
        });
      } else {
        await api("/profiles", {
          method: "POST",
          json: {
            name, group_name: group || null, notes: notes || null,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
            os, proxy_id: proxyId || null,
            screen: maxW || maxH ? { max_width: maxW ? +maxW : null, max_height: maxH ? +maxH : null } : null,
            geo_override: geo, launch_options: opts,
          },
        });
        notify("Profile created. A self-test will run in the background.");
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    if (!profile || !window.confirm("Generate a brand-new fingerprint? Sites will see a different device.")) return;
    try {
      await api(`/profiles/${profile.id}/regenerate-fingerprint`, { method: "POST", json: { os } });
      notify("Fingerprint regenerated");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const fp = profile?.fingerprint_summary;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{profile ? `Edit ${profile.name}` : "New profile"}</h3>
        <div className="grid">
          <label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label>Group</label><input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. shopping" />
          <label>Tags</label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma separated" />
          <label>Proxy</label>
          <select value={proxyId} onChange={(e) => setProxyId(e.target.value)}>
            <option value="">— none (direct, not recommended) —</option>
            {proxies.map((x) => (
              <option key={x.id} value={x.id}>
                {flag(x.last_geo?.country)} {x.label || x.host}:{x.port} {x.healthy === false ? "(down)" : ""}
              </option>
            ))}
          </select>
          {!profile && (
            <>
              <label>Target OS</label>
              <select value={os} onChange={(e) => setOs(e.target.value)}>
                <option value="windows">Windows (matches host, recommended)</option>
                <option value="macos">macOS</option>
                <option value="linux">Linux</option>
              </select>
              <label>Max screen</label>
              <div className="row">
                <input style={{ width: 90 }} value={maxW} onChange={(e) => setMaxW(e.target.value)} placeholder="width" />
                ×
                <input style={{ width: 90 }} value={maxH} onChange={(e) => setMaxH(e.target.value)} placeholder="height" />
              </div>
            </>
          )}
          <label>WebRTC</label>
          <select value={opts.webrtc} onChange={(e) => setOpts({ ...opts, webrtc: e.target.value as "proxy" | "block" })}>
            <option value="proxy">Spoof to proxy IP</option>
            <option value="block">Disable WebRTC</option>
          </select>
          <label>Timezone override</label><input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="auto from proxy" />
          <label>Locale override</label><input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="auto, e.g. de-DE" />
          <label>Extensions</label>
          <input
            value={opts.extensions.join("; ")}
            onChange={(e) => setOpts({ ...opts, extensions: e.target.value.split(";").map((s) => s.trim()).filter(Boolean) })}
            placeholder="paths to .xpi files, separated by ;"
          />
          <label>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 60 }} />
        </div>
        {fp && (
          <div className="card fp" style={{ marginTop: 12 }}>
            <strong>Fingerprint (frozen)</strong>
            <div>{fp.user_agent}</div>
            <div>{fp.platform} · {fp.screen} · {fp.hardware_concurrency} cores · {fp.languages.join(", ")}</div>
            <div>{fp.gpu_renderer}</div>
            <button className="secondary" style={{ marginTop: 6 }} onClick={regenerate} disabled={profile?.status === "running"}>
              Regenerate fingerprint
            </button>
          </div>
        )}
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving || !name.trim()}>{profile ? "Save" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}
