import { useCallback, useEffect, useState } from "react";
import { api, daemonInfo, EngineStatus, Profile, Proxy, setDevInfo } from "./api";
import { Icons, colorFor } from "./ui";
import Profiles, { ProfileForm } from "./screens/Profiles";
import Proxies from "./screens/Proxies";
import Tests from "./screens/Tests";
import SettingsScreen from "./screens/Settings";

export type Tab = "profiles" | "proxies" | "tests" | "settings";
export type Route = { tab: Tab; edit?: Profile | "new" };

export interface Shared {
  profiles: Profile[];
  proxies: Proxy[];
  reload: () => Promise<void>;
  notify: (m: string) => void;
  go: (r: Route) => void;
}

export default function App() {
  const [route, setRoute] = useState<Route>({ tab: "profiles" });
  const [group, setGroup] = useState<string>("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState("");
  const [bootedAt] = useState(() => Date.now());

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  const reload = useCallback(async () => {
    try {
      const { base_url } = await daemonInfo();
      setApiBase(base_url.replace(/^https?:\/\//, ""));
      const r = await fetch(base_url + "/health");
      setOnline(r.ok);
      if (!r.ok) return;
      const [p, x, e] = await Promise.all([
        api<Profile[]>("/profiles"),
        api<Proxy[]>("/proxies"),
        api<EngineStatus>("/engine/status"),
      ]);
      setProfiles(p);
      setProxies(x);
      setEngine(e);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    reload();
    // Poll a little faster while offline so the UI reconnects promptly, but
    // `reload` only changes state when something actually changed, so this no
    // longer forces a re-render on every tick (which made the connect form flicker).
    const t = window.setInterval(reload, online ? 4000 : 1500);
    return () => window.clearInterval(t);
  }, [reload, online]);

  const groups = Array.from(new Set(profiles.map((p) => p.group_name).filter(Boolean))) as string[];
  const running = profiles.filter((p) => p.status === "running").length;
  const issues = profiles.filter((p) => p.last_selftest_passed === false).length;
  const shared: Shared = { profiles, proxies, reload, notify, go: setRoute };

  const isTauri = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
  const bootingFor = Date.now() - bootedAt;
  const needsBrowser = Boolean(engine && !engine.browser_installed);
  // Splash: until the daemon answers (desktop: up to 30 s, browser: 4 s), and on first run until the browser exists.
  const showSplash = !online ? bootingFor < (isTauri ? 30_000 : 4_000) : needsBrowser && profiles.length === 0;

  const installBrowser = async () => {
    await api("/engine/install", { method: "POST" });
    notify("Downloading the browser in the background…");
    reload();
  };

  const navItem = (tab: Tab, label: string, icon: JSX.Element, count?: string | number, issue = false) => (
    <button className={route.tab === tab ? "nav active" : "nav"} onClick={() => { setRoute({ tab }); setGroup(""); }}>
      {icon}
      {label}
      {count !== undefined && count !== 0 && <span className={"count" + (issue ? " issue" : "")}>{count}</span>}
    </button>
  );

  if (showSplash) {
    return (
      <div className="app">
        <div className="titlebar">
          <span className="logo"><Icons.shield /></span>
          <span className="brand">MultiProfile</span>
          <span className="sub">Personal</span>
        </div>
        <Splash
          online={Boolean(online)}
          engine={engine}
          elapsed={bootingFor}
          onInstall={installBrowser}
          onRetry={reload}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="titlebar">
        <span className="logo"><Icons.shield /></span>
        <span className="brand">MultiProfile</span>
        <span className="sub">Personal</span>
      </div>
      <div className="body">
        <aside className="sidebar">
          {navItem("profiles", "Profiles", <Icons.profiles />, profiles.length)}
          {navItem("proxies", "Proxies", <Icons.proxies />, proxies.length)}
          {navItem("tests", "Leak tests", <Icons.shield />, issues ? `${issues} issue${issues > 1 ? "s" : ""}` : undefined, true)}
          {navItem("settings", "Settings", <Icons.settings />)}
          {groups.length > 0 && route.tab === "profiles" && (
            <>
              <div className="side-section">GROUPS</div>
              {groups.map((g) => (
                <button key={g} className={"group-row" + (group === g ? " active" : "")} onClick={() => { setGroup(group === g ? "" : g); setRoute({ tab: "profiles" }); }}>
                  <span className="sw" style={{ background: colorFor(g) }} />
                  {g}
                  <span className="count">{profiles.filter((p) => p.group_name === g).length}</span>
                </button>
              ))}
            </>
          )}
          <div className="spacer" />
          {engine && !engine.browser_installed && (
            <div className="side-card" style={{ marginBottom: 8 }}>
              <strong>Browser not downloaded</strong>
              {engine.install_in_progress ? (
                <progress value={engine.install_progress ?? undefined} />
              ) : (
                <button className="primary sm" onClick={installBrowser}>Download Camoufox</button>
              )}
              {engine.install_error && <div className="error">{engine.install_error}</div>}
            </div>
          )}
          {route.tab === "proxies" ? (
            <div className="side-card">
              <strong>Kill switch on</strong>
              A profile never opens if its proxy is down. No direct-connection fallback.
            </div>
          ) : (
            <div className="side-card">
              <strong><span className={"dot" + (online ? "" : " bad")} />{online ? `${running} running` : "daemon offline"}</strong>
              Engine: {engine?.engine ?? "—"}{engine?.browser_version ? ` · ${engine.browser_version}` : ""}
              <br />API: {apiBase || "—"}
            </div>
          )}
        </aside>
        <main>
          {online === false && <DevConnect onSaved={reload} />}
          {route.tab === "profiles" && !route.edit && <Profiles s={shared} group={group} />}
          {route.tab === "profiles" && route.edit && <ProfileForm s={shared} profile={route.edit === "new" ? null : route.edit} />}
          {route.tab === "proxies" && <Proxies s={shared} />}
          {route.tab === "tests" && <Tests s={shared} />}
          {route.tab === "settings" && <SettingsScreen s={shared} />}
        </main>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Splash({ online, engine, elapsed, onInstall, onRetry }: {
  online: boolean;
  engine: EngineStatus | null;
  elapsed: number;
  onInstall: () => void;
  onRetry: () => void;
}) {
  const steps = [
    { label: "Starting local service", state: online ? "done" : "active" },
    { label: "Loading profiles and proxies", state: online ? "done" : "todo" },
    {
      label: engine?.browser_installed ? "Browser ready" : engine?.install_in_progress ? "Downloading browser" : "Browser download",
      state: !online ? "todo" : engine?.browser_installed ? "done" : engine?.install_in_progress ? "active" : "wait",
    },
  ];
  return (
    <div className="splash">
      <div className="splash-card">
        <div className="splash-logo"><Icons.shield /></div>
        <h1>MultiProfile</h1>
        <p className="muted">Isolated browser profiles with stable fingerprints</p>
        <ul className="steps">
          {steps.map((st) => (
            <li key={st.label} className={st.state}>
              <span className="mark">{st.state === "done" ? <Icons.check /> : st.state === "active" ? <span className="spin" /> : <span className="hollow" />}</span>
              {st.label}
              {st.label === "Downloading browser" && engine?.install_progress != null && (
                <span className="muted" style={{ marginLeft: "auto" }}>{Math.round(engine.install_progress * 100)}%</span>
              )}
            </li>
          ))}
        </ul>
        {engine?.install_in_progress && <progress value={engine.install_progress ?? undefined} />}
        {online && engine && !engine.browser_installed && !engine.install_in_progress && (
          <>
            <p className="muted" style={{ fontSize: 12 }}>
              First run: the Camoufox browser (about 150 MB) is downloaded once into your local app data. Profiles cannot open until it is there.
            </p>
            {engine.install_error && <div className="error" style={{ marginBottom: 8 }}>{engine.install_error}</div>}
            <button className="primary lg" onClick={onInstall} style={{ width: "100%", justifyContent: "center" }}>Download browser</button>
          </>
        )}
        {!online && elapsed > 8000 && (
          <p className="muted" style={{ fontSize: 12 }}>
            Still waiting for the local service… <a href="#" onClick={(e) => { e.preventDefault(); onRetry(); }} style={{ color: "var(--accent)" }}>retry</a>
          </p>
        )}
      </div>
    </div>
  );
}

function DevConnect({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("http://127.0.0.1:47821");
  const [token, setToken] = useState("");
  return (
    <div className="card">
      <h3>Cannot reach the daemon</h3>
      <p className="muted">
        Inside the desktop app the daemon starts automatically. In a browser (dev mode) start it with
        <code> python -m app</code> and paste the token from <code>api_token</code> in the data folder.
      </p>
      <div className="cols">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:47821" />
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="API token" />
      </div>
      <div className="actions">
        <button className="primary" onClick={() => { setDevInfo(url, token); onSaved(); }}>Connect</button>
      </div>
    </div>
  );
}
