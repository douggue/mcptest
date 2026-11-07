import { useEffect, useState } from "react";
import { api, Proxy } from "../api";
import type { Shared } from "../App";
import { CC, Icons } from "../ui";

export default function Proxies({ s }: { s: Shared }) {
  const { proxies, profiles, reload, notify } = s;
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState(false);
  const [shared, setShared] = useState<Record<string, string[]>>({});

  useEffect(() => {
    api<Record<string, string[]>>("/proxies/shared-exit-ips").then(setShared).catch(() => setShared({}));
  }, [proxies]);

  const healthy = proxies.filter((p) => p.healthy).length;
  const sharedIds = new Set(Object.values(shared).flat());
  const sharedPairs = Object.values(shared).map((ids) => ids.map((id) => proxies.find((p) => p.id === id)?.label || proxies.find((p) => p.id === id)?.host || id));
  const usedBy = (p: Proxy) => profiles.filter((x) => x.proxy_id === p.id).map((x) => x.name);

  const checkAll = async () => {
    setChecking(true);
    try {
      await api("/proxies/check-all", { method: "POST" });
    } finally {
      setChecking(false);
      reload();
    }
  };
  const checkOne = async (p: Proxy) => {
    try {
      await api(`/proxies/${p.id}/check`, { method: "POST" });
    } catch (e) {
      notify((e as Error).message);
    }
    reload();
  };
  const remove = async (p: Proxy) => {
    const n = usedBy(p).length;
    if (!window.confirm(n ? `${n} profile(s) use this proxy and will run without one until reassigned. Delete?` : "Delete this proxy?")) return;
    await api(`/proxies/${p.id}`, { method: "DELETE" });
    reload();
  };
  const rename = async (p: Proxy) => {
    const label = window.prompt("Label", p.label ?? "");
    if (label === null) return;
    await api(`/proxies/${p.id}`, { method: "PATCH", json: { label } });
    reload();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Proxies</h2>
          <div className="sub">{proxies.length} proxies · {healthy} healthy · location is looked up on this computer, never online</div>
        </div>
        <div className="grow" />
        <div className="actions">
          <button className="lg" onClick={checkAll} disabled={checking || !proxies.length}>{checking ? "Checking…" : "Check all"}</button>
          <button className="primary lg" onClick={() => setAdding(true)}><Icons.plus /> Add proxies</button>
        </div>
      </div>

      {sharedPairs.map((names, i) => (
        <div className="banner warn" key={i}>
          <Icons.warn />
          <span><b>{names.slice(0, -1).join(", ")}</b> and <b>{names[names.length - 1]}</b> exit through the same IP. Two profiles sharing an IP can be linked.</span>
          <div className="grow" />
        </div>
      ))}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Proxy</th><th>Type</th><th>Exit IP</th><th>Location</th><th>Latency</th><th>Used by</th><th>Health</th></tr>
          </thead>
          <tbody>
            {proxies.map((p) => {
              const users = usedBy(p);
              return (
                <tr key={p.id}>
                  <td>
                    <a href="#" className="cell-title" onClick={(e) => { e.preventDefault(); rename(p); }}>{p.label || p.host}</a>
                    <div className="mono">{p.scheme}://{p.host}:{p.port}{p.username ? ` · ${p.username}` : ""}</div>
                  </td>
                  <td><span className="type">{p.scheme.toUpperCase()}</span></td>
                  <td className="mono" style={{ color: "var(--text)" }}>{p.last_exit_ip || "—"}</td>
                  <td>
                    <div className="who">
                      <CC code={p.last_geo?.country} />
                      <div>
                        <div>{p.last_geo?.city || p.last_geo?.country || <span className="muted">unknown</span>}</div>
                        <div className="mono">{p.last_geo?.timezone || ""}</div>
                      </div>
                    </div>
                  </td>
                  <td>{p.last_latency_ms ? `${Math.round(p.last_latency_ms)} ms` : "—"}</td>
                  <td>{users.length ? users.join(", ") : <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {p.healthy === null ? <span className="badge">Unchecked</span>
                      : !p.healthy ? <span className="badge bad plain" title={p.last_error || ""}><Icons.x /> Down</span>
                      : sharedIds.has(p.id) ? <span className="badge warn sq">Shared IP</span>
                      : <span className="badge ok">Healthy</span>}
                    <button className="sm ghost" style={{ marginLeft: 6 }} onClick={() => checkOne(p)} title="Check now"><Icons.refresh /></button>
                    <button className="sm ghost" onClick={() => remove(p)} title="Delete"><Icons.x /></button>
                  </td>
                </tr>
              );
            })}
            {proxies.length === 0 && <tr><td colSpan={7} className="empty">No proxies yet. Add one per profile; two profiles should never share an exit IP.</td></tr>}
          </tbody>
        </table>
      </div>
      {adding && <AddDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} notify={notify} />}
    </div>
  );
}

function AddDialog({ onClose, onDone, notify }: { onClose: () => void; onDone: () => void; notify: (m: string) => void }) {
  const [text, setText] = useState("");
  const [scheme, setScheme] = useState("http");
  const [prefix, setPrefix] = useState("");
  const [check, setCheck] = useState(true);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ created: Proxy[]; errors: string[] }>("/proxies/bulk-import", {
        method: "POST",
        json: { text, default_scheme: scheme, label_prefix: prefix || null },
      });
      notify(`Added ${r.created.length} proxies${r.errors.length ? `, ${r.errors.length} lines skipped` : ""}`);
      if (check) await Promise.all(r.created.map((p) => api(`/proxies/${p.id}/check`, { method: "POST" }).catch(() => null)));
      onDone();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add proxies</h3>
        <p className="muted" style={{ marginTop: 0 }}>One per line: <code>scheme://user:pass@host:port</code> or <code>host:port:user:pass</code>. Passwords are encrypted at rest.</p>
        <div className="field"><textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={"socks5://user:pass@gb1.proxy.example:1080\n198.51.100.9:3128:user:pass"} /></div>
        <div className="cols">
          <div className="field"><label className="lbl">Scheme when a line has none</label>
            <select value={scheme} onChange={(e) => setScheme(e.target.value)}><option value="http">http</option><option value="https">https</option><option value="socks5">socks5</option></select>
          </div>
          <div className="field"><label className="lbl">Label prefix (optional)</label><input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="uk-res" /></div>
        </div>
        <label className="check-row"><input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} /> Check health and location right away</label>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!text.trim() || busy} onClick={run}>{busy ? "Adding…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
