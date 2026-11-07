// Thin client for the local daemon.
//
// Inside Tauri the Rust shell tells us the port and token (it reads
// `daemon.port` / `api_token` from the data dir). In a plain browser during
// `npm run dev` we fall back to localStorage so you can paste the token once.

export interface DaemonInfo {
  base_url: string;
  token: string;
}

let info: DaemonInfo | null = null;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (!w.__TAURI_INTERNALS__) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function daemonInfo(): Promise<DaemonInfo> {
  if (info) return info;
  const fromTauri = await tauriInvoke<DaemonInfo>("daemon_info");
  if (fromTauri) {
    info = fromTauri;
    return info;
  }
  info = {
    base_url: localStorage.getItem("mp.base_url") || "http://127.0.0.1:47821",
    token: localStorage.getItem("mp.token") || "",
  };
  return info;
}

export function setDevInfo(base_url: string, token: string) {
  localStorage.setItem("mp.base_url", base_url);
  localStorage.setItem("mp.token", token);
  info = { base_url, token };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown; raw?: boolean } = {},
): Promise<T> {
  const { base_url, token } = await daemonInfo();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body = init.body;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(base_url + path, { ...init, headers: { ...headers, ...(init.headers as object) }, body });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  if (init.raw) return (await res.text()) as T;
  return (await res.json()) as T;
}

// ---- types mirrored from app/models.py (only what the UI uses) ----
export interface Geo {
  country?: string | null;
  timezone?: string | null;
  locale?: string | null;
  city?: string | null;
}
export interface Proxy {
  id: string;
  label: string | null;
  scheme: string;
  host: string;
  port: number;
  username: string | null;
  has_password: boolean;
  healthy: boolean | null;
  last_exit_ip: string | null;
  last_geo: Geo | null;
  last_latency_ms: number | null;
  last_checked_at: string | null;
  last_error: string | null;
  profile_count: number;
}
export interface FingerprintSummary {
  user_agent?: string | null;
  platform?: string | null;
  os?: string | null;
  browser_version?: string | null;
  screen?: string | null;
  hardware_concurrency?: number | null;
  languages: string[];
  gpu_renderer?: string | null;
}
export interface LaunchOptions {
  window?: [number, number] | null;
  webrtc: "proxy" | "block";
  block_images: boolean;
  humanize: boolean;
  extensions: string[];
  start_url?: string | null;
}
export interface Profile {
  id: string;
  name: string;
  group_name: string | null;
  tags: string[];
  notes: string | null;
  os: string;
  fingerprint_summary: FingerprintSummary;
  proxy_id: string | null;
  proxy: Proxy | null;
  geo_override: { timezone?: string | null; locale?: string | null } | null;
  launch_options: LaunchOptions;
  status: string;
  last_used_at: string | null;
  ws_endpoint: string | null;
  last_selftest_passed: boolean | null;
  last_selftest_at: string | null;
}
export interface CheckResult {
  name: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  reason?: string | null;
}
export interface SelfTestReport {
  id: string;
  profile_id: string;
  ran_at: string;
  passed: boolean;
  checks: CheckResult[];
  error?: string | null;
}
export interface EngineStatus {
  engine: string;
  browser_installed: boolean;
  browser_version: string | null;
  install_in_progress: boolean;
  install_progress: number | null;
  install_error: string | null;
}
export interface Settings {
  data_dir: string;
  profiles_dir: string;
  backups_dir: string;
  token_path: string;
  api_base: string;
  engine: string;
  headless: boolean;
  auto_selftest: boolean;
  require_proxy: boolean;
}

export function flag(country?: string | null): string {
  if (!country || country.length !== 2) return "🌐";
  const base = 0x1f1e6;
  const cc = country.toUpperCase();
  return String.fromCodePoint(base + cc.charCodeAt(0) - 65, base + cc.charCodeAt(1) - 65);
}

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}
