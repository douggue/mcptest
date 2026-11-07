import { useEffect, useState } from "react";
import { api, daemonInfo, EngineStatus, setDevInfo } from "./api";
import Profiles from "./screens/Profiles";
import Proxies from "./screens/Proxies";
import Tests from "./screens/Tests";
import SettingsScreen from "./screens/Settings";

type Tab = "profiles" | "proxies" | "tests" | "settings";

export default function App() {
  const [tab, setTab] = useState<Tab>("profiles");
  const [online, setOnline] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

  const refreshStatus = async () => {
    try {
      const { base_url } = await daemonInfo();
      const r = await fetch(base_url + "/health");
      setOnline(r.ok);
      if (r.ok) setEngine(await api<EngineStatus>("/engine/status"));
    } catch {
      setOnline(false);
    }
  };

  useEffect(() => {
    refreshStatus();
    const t = window.setInterval(refreshStatus, 5000);
    return () => window.clearInterval(t);
  }, []);

  const installBrowser = async () => {
    await api("/engine/install", { method: "POST" });
    notify("Downloading the browser in the background…");
    refreshStatus();
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>MultiProfile</h1>
        {(["profiles", "proxies", "tests", "settings"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "nav active" : "nav"} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <div className="spacer" />
        <div className={"status " + (online ? "ok" : "bad")}>
          <span className="dot" /> {online === null ? "connecting…" : online ? "daemon online" : "daemon offline"}
        </div>
        {engine && !engine.browser_installed && (
          <div className="banner">
            Browser not downloaded yet.
            {engine.install_in_progress ? (
              <progress value={engine.install_progress ?? undefined} />
            ) : (
              <button onClick={installBrowser}>Download Camoufox</button>
            )}
            {engine.install_error && <div className="error">{engine.install_error}</div>}
          </div>
        )}
      </aside>
      <main>
        {online === false && <DevConnect onSaved={refreshStatus} />}
        {tab === "profiles" && <Profiles notify={notify} />}
        {tab === "proxies" && <Proxies notify={notify} />}
        {tab === "tests" && <Tests notify={notify} />}
        {tab === "settings" && <SettingsScreen notify={notify} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function DevConnect({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("http://127.0.0.1:47821");
  const [token, setToken] = useState("");
  return (
    <div className="card">
      <h3>Cannot reach the daemon</h3>
      <p>
        Inside the desktop app the daemon starts automatically. In a browser (dev mode) start it with
        <code> python -m app</code> and paste the token from <code>api_token</code> in the data folder.
      </p>
      <div className="row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:47821" />
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="API token" />
        <button
          onClick={() => {
            setDevInfo(url, token);
            onSaved();
          }}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
