import { useCallback, useEffect, useState } from "react";
import { ago, api, Profile, SelfTestReport } from "../api";

export default function Tests({ notify }: { notify: (m: string) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [history, setHistory] = useState<SelfTestReport[]>([]);
  const [running, setRunning] = useState(false);
  const [external, setExternal] = useState(false);
  const [events, setEvents] = useState<{ ts: string; kind: string; profile_id: string | null; detail: Record<string, unknown> }[]>([]);

  const load = useCallback(async () => {
    try {
      const p = await api<Profile[]>("/profiles");
      setProfiles(p);
      setEvents(await api("/events?limit=60"));
      if (!selected && p.length) setSelected(p[0].id);
    } catch {
      /* offline */
    }
  }, [selected]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!selected) return;
    api<SelfTestReport[]>(`/profiles/${selected}/selftest`).then(setHistory).catch(() => setHistory([]));
  }, [selected, running]);

  const run = async () => {
    setRunning(true);
    try {
      const r = await api<SelfTestReport>(`/profiles/${selected}/selftest?external=${external}`, { method: "POST" });
      notify(r.passed ? "Self-test passed" : "Self-test failed, see details");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRunning(false);
      load();
    }
  };

  return (
    <div>
      <h2>Leak self-test</h2>
      <div className="toolbar">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="row"><input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} /> also open public test pages (BrowserLeaks, CreepJS, DNS leak)</label>
        <div className="grow" />
        <button onClick={run} disabled={!selected || running}>{running ? "Running…" : "Run self-test"}</button>
      </div>
      <p className="muted">
        The profile is started if needed, the browser is asked what it exposes (exit IP, WebRTC candidates, timezone,
        languages, UA, screen, cores) and the answers are compared with the proxy and the frozen fingerprint.
      </p>
      {history.length === 0 && <div className="card muted">No reports yet for this profile.</div>}
      {history.map((r, i) => (
        <details key={r.id} className="card" open={i === 0}>
          <summary>
            <span className={"badge " + (r.passed ? "ok" : "bad")}>{r.passed ? "PASS" : "FAIL"}</span> {ago(r.ran_at)}{" "}
            <span className="muted">{r.ran_at}</span>
            {r.error && <span className="error"> · {r.error}</span>}
          </summary>
          <div style={{ marginTop: 8 }}>
            {r.checks.map((c) => (
              <div className="check" key={c.name}>
                <span>{c.passed ? "✅" : "❌"}</span>
                <span className="name">{c.name}</span>
                <span className="mono muted">{c.passed ? fmt(c.actual) : `${c.reason || ""} (expected ${fmt(c.expected)}, got ${fmt(c.actual)})`}</span>
              </div>
            ))}
          </div>
        </details>
      ))}
      <h2 style={{ marginTop: 24 }}>Recent events</h2>
      <table>
        <tbody>
          {events.map((e, i) => (
            <tr key={i}>
              <td className="muted mono" style={{ whiteSpace: "nowrap" }}>{e.ts}</td>
              <td>{e.kind}</td>
              <td className="muted">{profiles.find((p) => p.id === e.profile_id)?.name || e.profile_id || ""}</td>
              <td className="mono muted">{JSON.stringify(e.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}
