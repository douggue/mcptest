import { useEffect, useState } from "react";
import { api, daemonInfo, EngineStatus, Profile, Settings } from "../api";

export default function SettingsScreen({ notify }: { notify: (m: string) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [token, setToken] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [backups, setBackups] = useState<{ path: string; name: string; size: number }[]>([]);
  const [pass, setPass] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [importPath, setImportPath] = useState("");

  const load = async () => {
    try {
      setS(await api<Settings>("/settings"));
      setEngine(await api<EngineStatus>("/engine/status"));
      const info = await daemonInfo();
      setToken(info.token);
      setBaseUrl(info.base_url);
      setProfiles(await api<Profile[]>("/profiles"));
      setBackups(await api("/backup/list"));
    } catch {
      /* offline */
    }
  };
  useEffect(() => {
    load();
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied");
    } catch {
      window.prompt("Copy:", text);
    }
  };

  const exportBackup = async () => {
    if (pass.length < 8) return notify("Passphrase needs at least 8 characters");
    try {
      const r = await api<{ files: string[] }>("/backup/export", {
        method: "POST",
        json: { profile_ids: Array.from(sel), passphrase: pass },
      });
      notify(`Exported ${r.files.length} backup file(s) to ${s?.backups_dir}`);
      load();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const importBackup = async (path: string) => {
    if (!pass) return notify("Enter the backup passphrase first");
    try {
      const r = await api<{ profile_id: string; name: string; replaced: boolean }>("/backup/import", {
        method: "POST",
        json: { path, passphrase: pass },
      });
      notify(`${r.replaced ? "Restored over" : "Imported"} "${r.name}"`);
      load();
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const snippet = `from app.client import profile\n\nwith profile("my-profile") as page:\n    page.goto("https://example.com")`;

  return (
    <div>
      <h2>Settings</h2>
      <div className="card">
        <div className="grid">
          <label>Data folder</label><span className="mono">{s?.data_dir}</span>
          <label>Backups</label><span className="mono">{s?.backups_dir}</span>
          <label>API</label><span className="mono">{baseUrl}</span>
          <label>API token</label>
          <span className="row"><span className="mono">{token ? token.slice(0, 6) + "…" + token.slice(-4) : "—"}</span> <button className="secondary" onClick={() => copy(token)}>Copy token</button></span>
          <label>Engine</label>
          <span>{engine?.engine} {engine?.browser_installed ? <span className="badge ok">browser {engine.browser_version}</span> : <span className="badge warn">browser not installed</span>}</span>
          <label>Auto self-test</label><span>{s?.auto_selftest ? "on" : "off"} <span className="muted">(MULTIPROFILE_AUTO_SELFTEST)</span></span>
          <label>Require proxy</label><span>{s?.require_proxy ? "on" : "off"} <span className="muted">(MULTIPROFILE_REQUIRE_PROXY)</span></span>
        </div>
      </div>

      <div className="card">
        <h3>Use from scripts</h3>
        <pre>{snippet}</pre>
        <button className="secondary" onClick={() => copy(snippet)}>Copy snippet</button>
      </div>

      <div className="card">
        <h3>Encrypted backup</h3>
        <p className="muted">Each profile becomes one passphrase-encrypted file. Restore works on another machine. Profiles must be stopped.</p>
        <div className="row" style={{ marginBottom: 8 }}>
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="passphrase (min 8 chars)" />
        </div>
        <div className="row" style={{ marginBottom: 8 }}>
          {profiles.map((p) => (
            <label key={p.id} className="tag" style={{ padding: "4px 8px" }}>
              <input type="checkbox" checked={sel.has(p.id)} onChange={() => setSel((x) => { const n = new Set(x); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} /> {p.name}
            </label>
          ))}
        </div>
        <button onClick={exportBackup} disabled={!sel.size}>Export selected</button>
        <h4>Restore</h4>
        <div className="row">
          <input style={{ flex: 1 }} value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="path to .mpbackup file" />
          <button className="secondary" onClick={() => importBackup(importPath)} disabled={!importPath}>Import</button>
        </div>
        {backups.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <tbody>
              {backups.map((b) => (
                <tr key={b.path}>
                  <td className="mono">{b.name}</td>
                  <td className="muted">{(b.size / 1e6).toFixed(1)} MB</td>
                  <td><button className="secondary" onClick={() => importBackup(b.path)}>Restore</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
