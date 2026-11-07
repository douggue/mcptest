import { useCallback, useEffect, useState } from "react";
import { ago, api, flag, Proxy } from "../api";

export default function Proxies({ notify }: { notify: (m: string) => void }) {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [text, setText] = useState("");
  const [scheme, setScheme] = useState("http");
  const [checking, setChecking] = useState(false);
  const [shared, setShared] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    try {
      setProxies(await api<Proxy[]>("/proxies"));
      setShared(await api<Record<string, string[]>>("/proxies/shared-exit-ips"));
    } catch {
      /* offline */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const importAll = async () => {
    try {
      const r = await api<{ created: Proxy[]; errors: string[] }>("/proxies/bulk-import", {
        method: "POST",
        json: { text, default_scheme: scheme },
      });
      notify(`Imported ${r.created.length} proxies${r.errors.length ? `, ${r.errors.length} lines skipped` : ""}`);
      if (r.errors.length) console.warn(r.errors);
      setText("");
      load();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const checkAll = async () => {
    setChecking(true);
    try {
      await api("/proxies/check-all", { method: "POST" });
    } finally {
      setChecking(false);
      load();
    }
  };
  const checkOne = async (p: Proxy) => {
    try {
      await api(`/proxies/${p.id}/check`, { method: "POST" });
    } catch (e) {
      notify((e as Error).message);
    }
    load();
  };
  const remove = async (p: Proxy) => {
    if (p.profile_count && !window.confirm(`${p.profile_count} profile(s) use this proxy. They will run direct until reassigned. Delete?`)) return;
    await api(`/proxies/${p.id}`, { method: "DELETE" });
    load();
  };
  const rename = async (p: Proxy) => {
    const label = window.prompt("Label", p.label ?? "");
    if (label === null) return;
    await api(`/proxies/${p.id}`, { method: "PATCH", json: { label } });
    load();
  };

  const sharedIds = new Set(Object.values(shared).flat());

  return (
    <div>
      <h2>Proxies</h2>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <strong>Bulk import</strong>
          <span className="muted">one per line: <code>scheme://user:pass@host:port</code> or <code>host:port:user:pass</code></span>
          <div className="grow" />
          <select value={scheme} onChange={(e) => setScheme(e.target.value)}>
            <option value="http">default http</option>
            <option value="https">default https</option>
            <option value="socks5">default socks5</option>
          </select>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"1.2.3.4:8080:user:pass\nsocks5://user:pass@5.6.7.8:1080"} />
        <div className="actions">
          <button onClick={importAll} disabled={!text.trim()}>Import</button>
        </div>
      </div>
      <div className="toolbar">
        <span className="muted">{proxies.length} proxies</span>
        <div className="grow" />
        <button className="secondary" onClick={checkAll} disabled={checking || !proxies.length}>{checking ? "Checking…" : "Check all"}</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Label</th><th>Server</th><th>Health</th><th>Exit IP</th><th>Location</th><th>Latency</th><th>Used by</th><th>Checked</th><th />
          </tr>
        </thead>
        <tbody>
          {proxies.map((p) => (
            <tr key={p.id}>
              <td><a href="#" onClick={(e) => { e.preventDefault(); rename(p); }}>{p.label || <span className="muted">unnamed</span>}</a></td>
              <td className="mono">{p.scheme}://{p.username ? `${p.username}:${p.has_password ? "•••" : ""}@` : ""}{p.host}:{p.port}</td>
              <td>
                {p.healthy === null ? <span className="badge">unchecked</span> : p.healthy ? <span className="badge ok">healthy</span> : <span className="badge bad" title={p.last_error || ""}>down</span>}
                {sharedIds.has(p.id) && <span className="badge warn" title="Another proxy has the same exit IP" style={{ marginLeft: 4 }}>shared IP</span>}
              </td>
              <td className="mono">{p.last_exit_ip || "—"}</td>
              <td>{flag(p.last_geo?.country)} {p.last_geo?.country} <span className="muted">{p.last_geo?.timezone}</span></td>
              <td>{p.last_latency_ms ? `${Math.round(p.last_latency_ms)} ms` : "—"}</td>
              <td>{p.profile_count}</td>
              <td className="muted">{ago(p.last_checked_at)}</td>
              <td className="row">
                <button className="secondary" onClick={() => checkOne(p)}>Check</button>
                <button className="danger" onClick={() => remove(p)}>✕</button>
              </td>
            </tr>
          ))}
          {proxies.length === 0 && <tr><td colSpan={9} className="muted">No proxies. Paste some above; every profile should have its own.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
