import { Gif } from '@remotion/gif';
import React from 'react';
import { Audio, Img, OffthreadVideo, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

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
  const { fps } = useVideoConfig();
  const backIn = interpolate(frame, [0, fps * 0.18], [0, 1], { extrapolateRight: 'clamp' })
    * interpolate(frame, [frames - fps * 0.2, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <>
      {g.sfx && fxVolume > 0 && <Audio src={`${sfxBase}${g.sfx}.wav`} volume={fxVolume} />}
      <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden', ...box }}>
        {backdrop && <div style={{ position: 'absolute', inset: 0, background: backdrop, opacity: backIn }} />}
        <div style={{ position: g.type === 'broll' ? 'absolute' : 'relative', inset: g.type === 'broll' ? 0 : undefined, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', ...style }}>
          <Body {...ctx} />
        </div>
      </div>
    </>
  );
};
