// Small shared UI bits: icons, avatars, country codes.
import { Profile } from "./api";

const I = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
export const Icons = {
  profiles: () => <I d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  proxies: () => <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />,
  shield: () => <I d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" />,
  settings: () => <I d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  search: () => <I d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" size={14} />,
  plus: () => <I d="M12 5v14M5 12h14" size={14} />,
  play: () => <I d="M6 4l14 8-14 8z" size={12} />,
  stop: () => <I d="M6 6h12v12H6z" size={12} />,
  check: () => <I d="M20 6L9 17l-5-5" size={13} />,
  refresh: () => <I d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" size={14} />,
  warn: () => <I d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" size={16} />,
  info: () => <I d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" size={14} />,
  x: () => <I d="M18 6L6 18M6 6l12 12" size={14} />,
};

const PALETTE = ["#3b6cf6", "#8b5cf6", "#22a06b", "#d97706", "#0ea5e9", "#db2777", "#14b8a6", "#f97316"];

export function colorFor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.replace(/[—–-]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" style={{ background: colorFor(name) }}>{initials(name)}</span>;
}

export function CC({ code }: { code?: string | null }) {
  return <span className="cc">{code ? code.toUpperCase() : "—"}</span>;
}

export function fpLine(p: Profile): string {
  const f = p.fingerprint_summary;
  const os = (f.os || p.os || "").replace(/^windows$/i, "Windows").replace(/^macos$/i, "macOS").replace(/^linux$/i, "Linux");
  return [os, f.screen, f.hardware_concurrency ? `${f.hardware_concurrency} cores` : null].filter(Boolean).join(" · ");
}

export function osLabel(os?: string | null): string {
  if (!os) return "—";
  const o = os.toLowerCase();
  if (o.startsWith("win")) return "Windows";
  if (o.startsWith("mac")) return "macOS";
  if (o.startsWith("lin")) return "Linux";
  return os;
}
