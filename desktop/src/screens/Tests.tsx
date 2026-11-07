import { useEffect, useState } from "react";
import { ago, api, SelfTestReport } from "../api";
import type { Shared } from "../App";
import { Avatar, Icons } from "../ui";

export default function Tests({ s }: { s: Shared }) {
  const { profiles, reload, notify } = s;
  const [selected, setSelected] = useState<string>("");
  const [history, setHistory] = useState<SelfTestReport[]>([]);
  const [running, setRunning] = useState(false);
  const [external, setExternal] = useState(false);
  const [events, setEvents] = useState<{ ts: string; kind: string; profile_id: string | null; detail: Record<string, unknown> }[]>([]);

  useEffect(() => {
    if (!selected && profiles.length) setSelected((profiles.find((p) => p.last_selftest_passed === false) || profiles[0]).id);
  }, [profiles, selected]);
  useEffect(() => {
    api("/events?limit=40").then((e) => setEvents(e as typeof events)).catch(() => undefined);
  }, [running, profiles]);
  useEffect(() => {
    if (!selected) return;
    api<SelfTestReport[]>(`/profiles/${selected}/selftest`).then(setHistory).catch(() => setHistory([]));
  }, [selected, running, profiles]);

  const issues = profiles.filter((p) => p.last_selftest_passed === false);
  const run = async (id = selected) => {
    setRunning(true);
    try {
      const r = await api<SelfTestReport>(`/profiles/${id}/selftest?external=${external}`, { method: "POST" });
      notify(r.passed ? "Leak test passed" : "Leak test found issues");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setRunning(false);
      reload();
    }
  };
  const current = profiles.find((p) => p.id === selected);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Leak tests</h2>
          <div className="sub">{issues.length ? `${issues.length} profile${issues.length > 1 ? "s" : ""} with issues` : "No open issues"} · the browser is asked what it exposes and compared with the proxy and the frozen fingerprint</div>
        </div>
        <div className="grow" />
        <div className="actions">
          <label className="check-row"><input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} /> Also open public test pages</label>
          <select style={{ width: 240 }} value={selected} onChange={(e) => setSelected(e.target.value)}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="primary lg" onClick={() => run()} disabled={!selected || running}><Icons.shield /> {running ? "Running…" : "Run leak test"}</button>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="banner warn">
          <Icons.warn />
          <span>Issues in <b>{issues.map((p) => p.name).join(", ")}</b>. Fix the proxy or location and run the test again.</span>
          <div className="grow" />
          {issues.map((p) => <button key={p.id} className="sm" onClick={() => setSelected(p.id)}>Show {p.name}</button>)}
        </div>
      )}

      {current && (
        <div className="card">
          <div className="card-head">
            <div className="who"><Avatar name={current.name} /><div><div className="cell-title" style={{ fontSize: 15 }}>{current.name}</div><div className="cell-sub">{current.proxy ? `${current.proxy.label || current.proxy.host} · ${current.proxy.last_geo?.timezone || ""}` : "no proxy"}</div></div></div>
            {history[0] && (history[0].passed ? <span className="badge ok plain"><Icons.check /> Passed {ago(history[0].ran_at)}</span> : <span className="badge warn plain"><Icons.warn /> Issues {ago(history[0].ran_at)}</span>)}
          </div>
          {history.length === 0 && <div className="empty">Not run yet.</div>}
          {history.map((r, i) => (
            <details key={r.id} open={i === 0} style={{ borderTop: i ? "1px solid var(--line)" : "none", paddingTop: i ? 10 : 0, marginTop: i ? 10 : 0 }}>
              <summary className="muted" style={{ fontSize: 12 }}>{i === 0 ? "Latest run" : "Earlier run"} · {r.ran_at}{r.error ? <span className="error"> · {r.error}</span> : ""}</summary>
              <div className="checks" style={{ marginTop: 6 }}>
                {r.checks.map((c) => (
                  <div className="row" key={c.name}>
                    <span style={{ color: c.passed ? "var(--ok)" : "var(--warn)" }}>{c.passed ? <Icons.check /> : <Icons.warn />}</span>
                    <span className="name">{label(c.name)}</span>
                    <span className="mono" style={{ color: c.passed ? "var(--muted)" : "var(--text)" }}>
                      {c.passed ? fmt(c.actual) : `${c.reason || "mismatch"} · expected ${fmt(c.expected)}, got ${fmt(c.actual)}`}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Recent events</h3></div>
        <table>
          <tbody>
            {events.map((e, i) => (
              <tr key={i}>
                <td className="mono" style={{ whiteSpace: "nowrap", width: 180 }}>{e.ts.replace("T", " ").replace(/\+.*$/, "")}</td>
                <td>{e.kind}</td>
                <td className="muted">{profiles.find((p) => p.id === e.profile_id)?.name || e.profile_id || ""}</td>
                <td className="mono" style={{ textAlign: "left" }}>{JSON.stringify(e.detail)}</td>
              </tr>
            ))}
            {events.length === 0 && <tr><td className="empty">No events yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  proxy_assigned: "Proxy assigned",
  exit_ip_matches_proxy: "Exit IP is the proxy's",
  webrtc_no_leak: "WebRTC shows no other IP",
  timezone_matches_geo: "Timezone matches location",
  language_matches_geo: "Language matches location",
  user_agent_is_stored: "User agent unchanged",
  platform_is_stored: "Platform unchanged",
  ua_platform_consistent: "UA and platform agree",
  screen_is_stored: "Screen unchanged",
  cores_are_stored: "CPU cores unchanged",
};
function label(name: string) {
  return LABELS[name] || name;
}
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}
