import { useEffect, useState } from "react";
import { api, daemonInfo, EngineStatus, Settings } from "../api";
import type { Shared } from "../App";
import { Icons } from "../ui";

export default function SettingsScreen({ s }: { s: Shared }) {
  const { profiles, notify, reload } = s;
  const [st, setSt] = useState<Settings | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [backups, setBackups] = useState<{ path: string; name: string; size: number }[]>([]);
  const [pass, setPass] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [importPath, setImportPath] = useState("");
  const [showToken, setShowToken] = useState(false);

  const load = async () => {
    try {
      setSt(await api<Settings>("/settings"));
      setEngine(await api<EngineStatus>("/engine/status"));
      const info = await daemonInfo();
      setToken(info.token);
      setBaseUrl(info.base_url);
      setBackups(await api("/backup/list"));
    } catch {
      /* offline */
    }
  };
  useEffect(() => {
    load();
  }, []);

  const copy = async (text: string, what = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      notify(what);
    } catch {
      window.prompt("Copy:", text);
    }
  };
  const exportBackup = async () => {
    if (pass.length < 8) return notify("Passphrase needs at least 8 characters");
    try {
      const r = await api<{ files: string[] }>("/backup/export", { method: "POST", json: { profile_ids: Array.from(sel), passphrase: pass } });
      notify(`Exported ${r.files.length} backup file(s) to ${st?.backups_dir}`);
      load();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const importBackup = async (path: string) => {
    if (!pass) return notify("Enter the backup passphrase first");
    try {
      const r = await api<{ profile_id: string; name: string; replaced: boolean }>("/backup/import", { method: "POST", json: { path, passphrase: pass } });
      notify(`${r.replaced ? "Restored over" : "Imported"} "${r.name}"`);
      load();
      reload();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const snippet = `from app.client import profile\n\nwith profile("my-profile") as page:\n    page.goto("https://example.com")`;

  return (
    <div>
      <div className="page-head">
        <div><h2>Settings</h2><div className="sub">Where things live, how scripts connect, and encrypted backups</div></div>
      </div>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <div className="card">
            <h3>This installation</h3>
            <div className="kv">
              <div>Data folder</div><div className="mono" style={{ color: "var(--text)" }}>{st?.data_dir || "—"}</div>
              <div>Backups</div><div className="mono" style={{ color: "var(--text)" }}>{st?.backups_dir || "—"}</div>
              <div>Engine</div><div>{engine?.engine} {engine?.browser_installed ? <span className="badge ok">browser {engine.browser_version}</span> : <span className="badge warn sq">browser not installed</span>}</div>
              <div>Auto leak test</div><div>{st?.auto_selftest ? "on" : "off"} <span className="muted">after create, proxy change, regenerate</span></div>
              <div>Require proxy</div><div>{st?.require_proxy ? "on" : "off"} <span className="muted">MULTIPROFILE_REQUIRE_PROXY</span></div>
              <div>GeoIP database</div><div>{st?.geoip_db || "Camoufox GeoIP (local)"}</div>
            </div>
          </div>
          <div className="card">
            <h3>Automation API</h3>
            <div className="kv">
              <div>Address</div><div className="mono" style={{ color: "var(--text)" }}>{baseUrl}</div>
              <div>Token</div>
              <div className="who">
                <span className="mono" style={{ color: "var(--text)" }}>{showToken ? token : token ? token.slice(0, 6) + "••••••••" + token.slice(-4) : "—"}</span>
                <button className="sm ghost" onClick={() => setShowToken(!showToken)}>{showToken ? "Hide" : "Show"}</button>
                <button className="sm" onClick={() => copy(token, "Token copied")}>Copy</button>
              </div>
            </div>
            <pre style={{ marginTop: 12 }}>{snippet}</pre>
            <button className="sm" onClick={() => copy(snippet)}>Copy snippet</button>
          </div>
        </div>
        <div>
          <div className="card">
            <h3>Encrypted backup</h3>
            <p className="muted" style={{ marginTop: 0 }}>Each profile becomes one passphrase-encrypted file. It restores on another machine. Profiles must be stopped.</p>
            <div className="field"><label className="lbl">Passphrase (used for export and restore)</label><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="at least 8 characters" /></div>
            <div className="field">
              <label className="lbl">Profiles to export</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {profiles.map((p) => (
                  <label key={p.id} className={"pill" + (sel.has(p.id) ? " active" : "")} style={{ cursor: "pointer" }} onClick={() => setSel((x) => { const n = new Set(x); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}>{p.name}</label>
                ))}
              </div>
            </div>
            <button className="primary" onClick={exportBackup} disabled={!sel.size}>Export {sel.size || ""} selected</button>
          </div>
          <div className="card">
            <h3>Restore</h3>
            <div className="cols" style={{ gridTemplateColumns: "1fr auto" }}>
              <input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="path to a .mpbackup file" />
              <button onClick={() => importBackup(importPath)} disabled={!importPath}>Import</button>
            </div>
            {backups.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.path}>
                      <td className="mono" style={{ color: "var(--text)" }}>{b.name}</td>
                      <td className="muted">{(b.size / 1e6).toFixed(1)} MB</td>
                      <td><button className="sm" onClick={() => importBackup(b.path)}><Icons.refresh /> Restore</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
