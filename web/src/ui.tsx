// Shared UI kit. Keep pages consistent by using these rather than ad-hoc markup.
import { ReactNode, useEffect, useRef, useState } from 'react';

import { Job, cancelJob, waitJob } from './api';

/* ---------- icons (24px stroke) ---------- */
const ICONS = {
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  film: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4v16M17 4v16',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  upload: 'M12 20V8M7 13l5-5 5 5M4 4h16',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  shuffle: 'M16 4h4v4M4 20 20 4M16 20h4v-4M4 4l5 5M15 15l5 5',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5 9-11',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.2A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.5 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  image: 'M4 4h16v16H4zM4 15l4-4 5 5 3-3 4 4M9 9h.01',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  speaker: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  type: 'M5 6V4h14v2M12 4v16M9 20h6',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5M2 18l10 5 10-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  crop: 'M6 2v16h16M2 6h16v16',
  wand: 'M4 20 15 9M15 4v3M19 8h3M18 5l1.5-1.5M9 4l.5 1.5M20 13l1.5.5',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  alert: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  dollar: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ---------- basics ---------- */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  small?: boolean;
  icon?: IconName;
  busy?: boolean;
};
export function Button({ variant = 'default', small, icon, busy, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn ${variant} ${small ? 'small' : ''} ${className}`} disabled={disabled || busy} {...rest}>
      {busy ? <span className="spinner" /> : icon ? <Icon name={icon} size={small ? 14 : 16} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Field({ label, hint, children, grow }: { label: string; hint?: string; children: ReactNode; grow?: boolean }) {
  return (
    <label className={'field' + (grow ? ' grow' : '')}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Panel({ title, actions, children, className = '', pad = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <h3>{title}</h3>
          <div className="row gap-s">{actions}</div>
        </header>
      )}
      <div className={pad ? 'panel-body' : ''}>{children}</div>
    </section>
  );
}

/** Segmented control. */
export function Seg<T extends string | number>({ value, options, onChange, small }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div className={'seg' + (small ? ' small' : '')} role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} title={o.title}
          className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, format }: {
  label?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="slider">
      {label && (
        <div className="slider-head">
          <span>{label}</span>
          <span className="mono">{format ? format(value) : value}</span>
        </div>
      )}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <header className="panel-head">
          <h3>{title}</h3>
          <Button variant="ghost" small icon="x" onClick={onClose} aria-label="Close" />
        </header>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon = 'film', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

/* ---------- toasts ---------- */
type ToastItem = { id: number; text: string; kind: 'info' | 'good' | 'bad' };
let pushToast: (t: ToastItem) => void = () => {};
let toastId = 0;
export function toast(text: string, kind: ToastItem['kind'] = 'info') {
  pushToast({ id: ++toastId, text, kind });
}
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'bad');

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((cur) => [...cur.slice(-3), t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), t.kind === 'bad' ? 7000 : 3500);
    };
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>
      ))}
    </div>
  );
}

/* ---------- jobs ---------- */
/** Track one background job at a time. `run` takes a call that returns {job_id} and resolves with the job result. */
export function useJobRunner() {
  const [job, setJob] = useState<Job | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  async function run<T = any>(start: () => Promise<{ job_id: string }>): Promise<T> {
    const { job_id } = await start();
    try {
      return await waitJob<T>(job_id, (j) => alive.current && setJob(j));
    } finally {
      if (alive.current) setTimeout(() => alive.current && setJob(null), 600);
    }
  }
  return { job, run, busy: !!job && (job.status === 'queued' || job.status === 'running') };
}

export function JobBar({ job }: { job: Job | null }) {
  if (!job) return null;
  const active = job.status === 'queued' || job.status === 'running';
  return (
    <div className={'jobbar ' + job.status}>
      <div className="jobbar-top">
        <span>{job.message || job.title}</span>
        <span className="mono">{Math.round(job.progress * 100)}%</span>
        {active && <Button variant="ghost" small icon="x" onClick={() => cancelJob(job.id)} aria-label="Cancel" />}
      </div>
      <div className="bar"><i style={{ width: `${job.progress * 100}%` }} /></div>
    </div>
  );
}

/* ---------- formatting ---------- */
export function fmtTime(sec: number, tenths = false): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const frac = tenths ? '.' + Math.floor((sec % 1) * 10) : '';
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}${frac}`;
}

export function fmtDur(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : '', `${s}s`].filter(Boolean).join(' ');
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const fmtNum = (n: number) => new Intl.NumberFormat().format(Math.round(n));
export const fmtMoney = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n || 0);
