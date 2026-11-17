import { Gif } from '@remotion/gif';
import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { EMOJI_STACK, fontStack, fontWeight } from './fonts';
import { Brand, Graphic } from './types';

type Ctx = { g: Graphic; brand: Brand; u: number; frames: number; fxVolume: number; sfxBase: string };

/** Splits "40%" / "$1,200" / "3x" into prefix, number and suffix; null when there is no number. */
export function parseValue(text: string): { prefix: string; value: number; suffix: string; decimals: number } | null {
  const m = /^([^\d-]*)(-?[\d.,]+)(.*)$/.exec(text.trim());
  if (!m) return null;
  const num = m[2].replace(/,/g, '');
  const value = Number(num);
  if (!isFinite(value)) return null;
  return { prefix: m[1], value, suffix: m[3], decimals: (num.split('.')[1] || '').length };
}

/** "WOULD YOU HAVE {STOPPED?}" → plain and marked runs. `{text|#ff0}` gives that run its own colour. */
export function splitMarkup(text: string): { text: string; mark: boolean; color?: string }[] {
  const out: { text: string; mark: boolean; color?: string }[] = [];
  const re = /\{([^}|]*)(?:\|(#[0-9a-fA-F]{3,8}))?\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), mark: false });
    out.push({ text: m[1], mark: true, color: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out.length ? out : [{ text, mark: false }];
}

function useEnter(g: Graphic, frames: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 12, stiffness: 190, mass: 0.7 } });
  const exit = interpolate(frame, [frames - Math.round(fps * 0.22), frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  let style: React.CSSProperties = {};
  switch (g.animation) {
    case 'slam': {
      const p = spring({ frame, fps, config: { damping: 16, stiffness: 320, mass: 0.6 } });
      const shake = frame < fps * 0.3 ? Math.sin(frame * 2.4) * 6 * (1 - frame / (fps * 0.3)) : 0;
      style = { transform: `scale(${interpolate(p, [0, 1], [2.6, 1])}) translateX(${shake}px)`, opacity: Math.min(1, frame / 2) };
      break;
    }
    case 'fade':
      style = { opacity: interpolate(frame, [0, fps * 0.3], [0, 1], { extrapolateRight: 'clamp' }) };
      break;
    case 'slide':
      style = { transform: `translateY(${interpolate(s, [0, 1], [90, 0])}px)`, opacity: Math.min(1, s * 1.6) };
      break;
    case 'glitch': {
      const active = frame < fps * 0.35;
      const dx = active ? (random(`gx${g.id}${frame}`) - 0.5) * 46 : 0;
      const sk = active ? (random(`gs${g.id}${frame}`) - 0.5) * 14 : 0;
      style = {
        transform: `translateX(${dx}px) skewX(${sk}deg)`,
        opacity: active ? (random(`go${g.id}${frame}`) > 0.25 ? 1 : 0.35) : 1,
        filter: active ? `drop-shadow(${6}px 0 0 rgba(255,0,80,.8)) drop-shadow(${-6}px 0 0 rgba(0,220,255,.8))` : undefined,
      };
      break;
    }
    case 'type':
      style = { clipPath: `inset(0 ${interpolate(frame, [0, fps * 0.5], [100, 0], { extrapolateRight: 'clamp' })}% 0 0)` };
      break;
    case 'pop':
    default:
      style = { transform: `scale(${interpolate(s, [0, 1], [0.55, 1])})`, opacity: Math.min(1, s * 1.8) };
  }
  return { style: { ...style, opacity: (Number(style.opacity ?? 1)) * exit }, frame, fps, s };
}

const zoneBox = (g: Graphic): { box: React.CSSProperties; backdrop: string | null } => {
  switch (g.zone) {
    case 'full':
      return { box: { inset: 0, justifyContent: 'center' }, backdrop: g.type === 'broll' ? null : 'rgba(9,9,12,.86)' };
    case 'top':
      return { box: { left: 0, right: 0, top: 0, height: '38%', justifyContent: 'center' }, backdrop: g.type === 'broll' ? null : 'linear-gradient(rgba(9,9,12,.92), rgba(9,9,12,.75) 70%, rgba(9,9,12,0))' };
    case 'bottom':
      return { box: { left: 0, right: 0, bottom: 0, height: '34%', justifyContent: 'center' }, backdrop: g.type === 'broll' ? null : 'linear-gradient(rgba(9,9,12,0), rgba(9,9,12,.75) 30%, rgba(9,9,12,.92))' };
    case 'center':
      return { box: { left: 0, right: 0, top: '30%', height: '40%', justifyContent: 'center' }, backdrop: null };
    case 'free':
      return { box: { inset: 0, justifyContent: 'center' }, backdrop: null };
    case 'overlay':
    default:
      return { box: { left: 0, right: 0, top: '14%', height: '34%', justifyContent: 'center' }, backdrop: null };
  }
};

const shadow = (u: number) => `0 ${4 * u}px ${18 * u}px rgba(0,0,0,.75)`;

const Body: React.FC<Ctx> = ({ g, brand, u, frames }) => {
  const { frame, fps } = useEnter(g, frames);
  const family = fontStack(brand.font);
  const weight = fontWeight(brand.font);
  const small: React.CSSProperties = {
    fontFamily: fontStack('Inter'), fontWeight: 800, fontSize: 34 * u, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: brand.accent, textShadow: shadow(u),
  };
  const big: React.CSSProperties = {
    fontFamily: family, fontWeight: weight, fontSize: 150 * u, lineHeight: 0.98, color: brand.secondary, textTransform: 'uppercase',
    textShadow: shadow(u), textAlign: 'center', maxWidth: '90%',
  };
  // Largest size at which the longest word still fits the frame width (fonts differ a lot in width).
  const charW = ({ Anton: 0.47, 'Bebas Neue': 0.42, 'Archivo Black': 0.7, Montserrat: 0.72, Inter: 0.66, 'JetBrains Mono': 0.62 } as Record<string, number>)[brand.font] ?? 0.62;
  const fit = (text: string, base: number) => {
    const words = text.trim().split(/\s+/);
    const longest = Math.max(...words.map((w) => w.length), Math.min(text.length, 12), 1);
    return Math.min(base, (0.84 * 1080) / (longest * charW)) * u;
  };

  switch (g.type) {
    case 'cascade': {
      const items = g.keywords.length ? g.keywords : [g.primary];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 * u }}>
          {g.primary && g.keywords.length > 0 && <div style={small}>{g.primary}</div>}
          {items.map((k, i) => {
            const p = spring({ frame: frame - i * Math.round(fps * 0.16), fps, config: { damping: 13, stiffness: 240, mass: 0.6 } });
            return (
              <div key={i} style={{ ...big, fontSize: fit(k, 132), color: i % 2 ? brand.accent : brand.secondary, opacity: Math.min(1, p * 2), transform: `translateY(${interpolate(p, [0, 1], [50, 0])}px) scale(${interpolate(p, [0, 1], [0.8, 1])})` }}>{k}</div>
            );
          })}
        </div>
      );
    }
    case 'gauge':
    case 'counter': {
      const v = parseValue(g.primary);
      const p = interpolate(frame, [0, Math.min(frames * 0.6, fps * 1.2)], [0, 1], { extrapolateRight: 'clamp' });
      const eased = 1 - Math.pow(1 - p, 3);
      const shown = v ? `${v.prefix}${(v.value * eased).toFixed(v.decimals)}${v.suffix}` : g.primary;
      if (g.type === 'counter') {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 * u }}>
            <div style={{ ...big, fontSize: fit(shown, 230), color: brand.accent, fontVariantNumeric: 'tabular-nums' }}>{shown}</div>
            {g.headline && <div style={{ ...small, color: brand.secondary }}>{g.headline}</div>}
          </div>
        );
      }
      const size = 420 * u;
      const r = size / 2 - 22 * u;
      const c = 2 * Math.PI * r;
      const pct = v ? Math.max(0, Math.min(1, Math.abs(v.value) / 100)) : 1;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 * u }}>
          <div style={{ position: 'relative', width: size, height: size, filter: `drop-shadow(${shadow(u)})` }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={size / 2} cy={size / 2} r={r} fill="rgba(9,9,12,.72)" stroke="rgba(255,255,255,.16)" strokeWidth={26 * u} />
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={brand.accent} strokeWidth={26 * u} strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - pct * eased)} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', ...big, fontSize: fit(shown, 120), maxWidth: 'none', fontVariantNumeric: 'tabular-nums' }}>{shown}</div>
          </div>
          {g.headline && <div style={small}>{g.headline}</div>}
        </div>
      );
    }
    case 'lowerthird': {
      const p = spring({ frame, fps, config: { damping: 18, stiffness: 180 } });
      return (
        <div style={{ alignSelf: 'flex-start', marginLeft: '6%', display: 'flex', transform: `translateX(${interpolate(p, [0, 1], [-700 * u, 0])}px)` }}>
          <div style={{ width: 14 * u, background: brand.accent }} />
          <div style={{ background: 'rgba(9,9,12,.9)', padding: `${22 * u}px ${34 * u}px`, display: 'flex', flexDirection: 'column', gap: 6 * u }}>
            <div style={{ fontFamily: family, fontWeight: weight, fontSize: 66 * u, lineHeight: 1, color: brand.secondary, textTransform: 'uppercase' }}>{g.primary}</div>
            {g.headline && <div style={{ fontFamily: fontStack('Inter'), fontWeight: 600, fontSize: 34 * u, color: brand.accent }}>{g.headline}</div>}
          </div>
        </div>
      );
    }
    case 'steps': {
      const items = g.keywords.length ? g.keywords : [g.headline || g.primary];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 26 * u, width: '78%' }}>
          {g.primary && <div style={{ ...big, fontSize: 84 * u, textAlign: 'left', maxWidth: '100%' }}>{g.primary}</div>}
          {items.map((k, i) => {
            const p = spring({ frame: frame - Math.round(fps * 0.25) * (i + 1), fps, config: { damping: 15, stiffness: 200 } });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 24 * u, opacity: Math.min(1, p * 2), transform: `translateX(${interpolate(p, [0, 1], [-60, 0])}px)` }}>
                <div style={{ width: 70 * u, height: 70 * u, borderRadius: '50%', background: brand.accent, color: '#111', display: 'grid', placeItems: 'center', fontFamily: fontStack('Inter'), fontWeight: 800, fontSize: 38 * u, flex: 'none' }}>{i + 1}</div>
                <div style={{ fontFamily: fontStack('Inter'), fontWeight: 800, fontSize: 52 * u, color: brand.secondary, textShadow: shadow(u), lineHeight: 1.1 }}>{k}</div>
              </div>
            );
          })}
        </div>
      );
    }
    case 'emoji': {
      const p = spring({ frame, fps, config: { damping: 7, stiffness: 180, mass: 0.7 } });
      return <div style={{ fontFamily: EMOJI_STACK, fontSize: 330 * u, lineHeight: 1, transform: `scale(${p}) rotate(${interpolate(p, [0, 1], [-25, 0])}deg)`, filter: `drop-shadow(${shadow(u)})` }}>{g.primary || '🔥'}</div>;
    }
    case 'broll': {
      const kb = interpolate(frame, [0, frames], [1.04, 1.14]);
      const media: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${kb})` };
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#000' }}>
          {!g.src ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', ...small, color: '#888' }}>Choose b-roll media</div>
          ) : g.mediaType === 'video' ? (
            <OffthreadVideo src={g.src} muted style={media} />
          ) : g.mediaType === 'gif' ? (
            <Gif src={g.src} fit="cover" style={media} />
          ) : (
            <Img src={g.src} style={media} />
          )}
          {g.headline && (
            <div style={{ position: 'absolute', left: '6%', bottom: '8%', background: brand.accent, color: '#111', fontFamily: fontStack('Inter'), fontWeight: 800, fontSize: 36 * u, padding: `${10 * u}px ${20 * u}px` }}>{g.headline}</div>
          )}
        </div>
      );
    }
    case 'label': {
      const color = g.color ?? brand.accent;
      const look = g.style ?? 'neon';
      const size = 64 * u;
      const parts = splitMarkup(g.primary);
      const marked = parts.some((q) => q.mark);
      const glow = (c: string) => `0 0 ${6 * u}px ${c}, 0 0 ${18 * u}px color-mix(in srgb, ${c} 55%, transparent), 0 ${3 * u}px ${8 * u}px rgba(0,0,0,.75)`;
      const soft = `0 ${3 * u}px ${10 * u}px rgba(0,0,0,.85), 0 0 ${4 * u}px rgba(0,0,0,.7)`;
      const text = parts.map((q, i) => {
        const c = q.color ?? color;
        const tinted = marked ? q.mark : look !== 'plain' && look !== 'box';
        const st: React.CSSProperties = look === 'outline' && tinted
          ? { color: 'transparent', WebkitTextStroke: `${3 * u}px ${c}` }
          : tinted
            ? { color: c, textShadow: look === 'box' ? undefined : glow(c), WebkitTextStroke: look === 'neon' ? `${2 * u}px color-mix(in srgb, ${c} 38%, #000)` : undefined, paintOrder: 'stroke fill' }
            : { color: '#fff', textShadow: look === 'box' ? undefined : soft };
        return <span key={i} style={st}>{q.text}</span>;
      });
      const base: React.CSSProperties = {
        fontFamily: family, fontWeight: weight, fontStyle: look === 'quoted' ? 'italic' : 'normal', fontSize: size, lineHeight: 1.12,
        textTransform: 'uppercase', textAlign: 'center', whiteSpace: 'pre-line', maxWidth: 940 * u, letterSpacing: look === 'neon' ? '0.03em' : undefined,
      };
      if (look === 'box') {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {g.tag && <div style={{ background: '#000', color, fontFamily: family, fontWeight: weight, fontSize: 34 * u, padding: `${8 * u}px ${16 * u}px ${2 * u}px` }}>{g.tag}</div>}
            <div style={{ ...base, textTransform: 'none', textAlign: 'left', background: '#000', padding: `${20 * u}px ${26 * u}px`, fontSize: 60 * u }}>{text}</div>
          </div>
        );
      }
      return (
        <div style={base}>
          {look === 'quoted' && <span style={{ color: '#fff', textShadow: soft }}>“</span>}
          {text}
          {look === 'quoted' && <span style={{ color: '#fff', textShadow: soft }}>”</span>}
        </div>
      );
    }
    case 'nametag': {
      const color = g.color ?? brand.accent;
      const shadowed = `0 0 ${6 * u}px ${color}, 0 0 ${16 * u}px color-mix(in srgb, ${color} 55%, transparent), 0 ${3 * u}px ${8 * u}px rgba(0,0,0,.8)`;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 * u, color, textShadow: shadowed }}>
          <div style={{ fontFamily: family, fontWeight: weight, fontStyle: 'italic', fontSize: 42 * u, textTransform: 'uppercase', whiteSpace: 'nowrap', lineHeight: 1.1 }}>{g.primary}</div>
          <div style={{ fontSize: 30 * u, lineHeight: 0.9 }}>▼</div>
        </div>
      );
    }
    case 'circle': {
      const d = 300 * u;
      const color = g.color ?? '#d2050a';
      return <div style={{ width: d, height: d, borderRadius: '50%', border: `${11 * u}px solid ${color}`, boxShadow: `0 0 ${14 * u}px color-mix(in srgb, ${color} 60%, transparent), inset 0 0 ${10 * u}px color-mix(in srgb, ${color} 40%, transparent)` }} />;
    }
    case 'arrow': {
      const w = 300 * u;
      const color = g.color ?? '#e01016';
      return (
        <svg width={w} height={w * 0.72} viewBox="0 0 300 216" style={{ transform: `rotate(${g.rotate ?? 0}deg)`, filter: `drop-shadow(0 ${4 * u}px ${8 * u}px rgba(0,0,0,.55))`, overflow: 'visible' }}>
          <path d="M18 150 C 70 40, 170 20, 232 70 L 250 44 L 284 134 L 190 128 L 210 100 C 160 66, 100 84, 62 172 Z" fill={color} stroke="#fff" strokeWidth="10" strokeLinejoin="round" />
        </svg>
      );
    }
    case 'heart': {
      const w = 230 * u;
      const t = frame / fps;
      const pop = t < 0.16 ? interpolate(t, [0, 0.16], [0, 1.12]) : t < 0.3 ? interpolate(t, [0.16, 0.3], [1.12, 1]) : 1;
      const echo = interpolate(t, [0, 0.75], [0, 1], { extrapolateRight: 'clamp' });
      const bob = Math.sin((t / 1.4) * Math.PI * 2) * 7 * u;
      const breathe = 1 + Math.sin((t / 1.1) * Math.PI * 2) * 0.0175;
      const heart = (op: number) => (
        <svg width={w} height={w * 0.92} viewBox="0 0 100 92" style={{ opacity: op, overflow: 'visible' }}>
          <defs>
            <radialGradient id={`hg${g.id}`} cx="38%" cy="30%" r="75%"><stop offset="0%" stopColor="#ff6b6b" /><stop offset="55%" stopColor="#e3121c" /><stop offset="100%" stopColor="#9c0810" /></radialGradient>
          </defs>
          <path d="M50 86 C 18 62, 4 44, 4 27 C 4 12, 15 3, 28 3 C 38 3, 46 9, 50 17 C 54 9, 62 3, 72 3 C 85 3, 96 12, 96 27 C 96 44, 82 62, 50 86 Z" fill={`url(#hg${g.id})`} stroke="#fff" strokeWidth="6" strokeLinejoin="round" />
          <ellipse cx="28" cy="22" rx="11" ry="7" fill="rgba(255,255,255,.75)" transform="rotate(-28 28 22)" />
        </svg>
      );
      return (
        <div style={{ position: 'relative', display: 'grid', placeItems: 'center', transform: `translateY(${bob}px) scale(${pop * breathe})`, filter: `drop-shadow(0 ${8 * u}px ${14 * u}px rgba(0,0,0,.5))` }}>
          <div style={{ position: 'absolute', transform: `scale(${1 + echo * 4.6})` }}>{heart(0.8 * (1 - echo))}</div>
          {heart(1)}
          {g.headline && <div style={{ ...small, color: '#fff', marginTop: 14 * u, position: 'absolute', top: '100%', whiteSpace: 'nowrap' }}>{g.headline}</div>}
        </div>
      );
    }
    case 'keyword':
    default:
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 * u }}>
          {g.headline && <div style={small}>{g.headline}</div>}
          <div style={{ ...big, fontSize: fit(g.primary, 190) }}>{g.primary}</div>
          <div style={{ width: 160 * u, height: 12 * u, background: brand.accent, borderRadius: 6 * u }} />
        </div>
      );
  }
};

/** One motion graphic; must be rendered inside a <Sequence> that starts when it appears. */
export const GraphicLayer: React.FC<Ctx> = (ctx) => {
  const { g, frames, fxVolume, sfxBase } = ctx;
  const { style } = useEnter(g, frames);
  const { box, backdrop } = zoneBox(g);
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const moved = `translate(${((g.dx ?? 0) / 100) * width}px, ${((g.dy ?? 0) / 100) * height}px) scale(${g.scale ?? 1})`;
  if (g.type === 'flash') {   // a white or coloured flash that decays
    const p = Math.max(0, 1 - frame / frames);
    return (
      <>
        {g.sfx && fxVolume > 0 && <Audio src={`${sfxBase}${g.sfx}.wav`} volume={fxVolume} />}
        <AbsoluteFill style={{ background: g.color ?? '#fff', opacity: (g.scale ?? 0.9) * Math.pow(p, 1.6) }} />
      </>
    );
  }
  if (g.type === 'dip') {   // dip to black and back
    const p = frame / Math.max(1, frames - 1);
    return <AbsoluteFill style={{ background: '#000', opacity: p < 0.55 ? interpolate(p, [0, 0.55], [0, 1]) : interpolate(p, [0.55, 1], [1, 0]) }} />;
  }
  if (g.type === 'spotlight') {   // everything outside a soft ellipse dims
    const ramp = Math.min(interpolate(frame, [0, fps * 0.12], [0, 1], { extrapolateRight: 'clamp' }), interpolate(frame, [frames - fps * 0.12, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    const sc = g.scale ?? 1;
    const rx = (width * 0.3) * sc, ry = (width * 0.27) * sc;
    const cx = width / 2 + ((g.dx ?? 0) / 100) * width, cy = height / 2 + ((g.dy ?? 0) / 100) * height;
    return (
      <>
        {g.sfx && fxVolume > 0 && <Audio src={`${sfxBase}${g.sfx}.wav`} volume={fxVolume} />}
        <AbsoluteFill style={{ background: `radial-gradient(ellipse ${rx * 1.35}px ${ry * 1.35}px at ${cx}px ${cy}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 62%, rgba(0,0,0,${0.7 * ramp}) 100%)` }} />
        <div data-el={`graphic:${g.id}`} style={{ position: 'absolute', left: cx - rx, top: cy - ry, width: rx * 2, height: ry * 2, borderRadius: '50%' }} />
      </>
    );
  }
  const backIn = interpolate(frame, [0, fps * 0.18], [0, 1], { extrapolateRight: 'clamp' })
    * interpolate(frame, [frames - fps * 0.2, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      {g.sfx && fxVolume > 0 && <Audio src={`${sfxBase}${g.sfx}.wav`} volume={fxVolume} />}
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: g.type === 'broll' ? 'hidden' : 'visible', ...box }}>
        {backdrop && <div style={{ position: 'absolute', inset: 0, background: backdrop, opacity: backIn }} />}
        {g.type === 'broll' ? (
          <div style={{ position: 'absolute', inset: 0, ...style }}><Body {...ctx} /></div>
        ) : (
          <div data-el={`graphic:${g.id}`} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', transform: moved }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', ...style }}>
              <Body {...ctx} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
