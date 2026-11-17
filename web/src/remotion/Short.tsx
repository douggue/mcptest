import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, Audio, Freeze, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { CaptionLayer } from './Captions';
import { GraphicLayer } from './Graphics';
import { fontStack, fontWeight, fontsReady } from './fonts';
import { Cut, Piece, buildPlan, driftAt, graphicFrames, paneXAt, speechEnvelope, srcTimeAt, totalFrames, transitionCuts, zoomAt } from './timing';
import { DEFAULT_FRAME, Look, ShortSpec, Shot } from './types';

const LOOKS: Record<Look['preset'], string> = {
  none: '',
  punchy: 'contrast(1.16) saturate(1.28)',
  warm: 'sepia(0.16) saturate(1.22) contrast(1.05)',
  cool: 'hue-rotate(-10deg) saturate(1.12) brightness(1.03) contrast(1.05)',
  cinematic: 'contrast(1.14) saturate(0.86) brightness(0.96)',
  vintage: 'sepia(0.34) contrast(0.94) saturate(0.9) brightness(1.04)',
};

export function lookFilter(look: Look): string {
  const fine = [
    look.brightness && look.brightness !== 1 ? `brightness(${look.brightness})` : '',
    look.contrast && look.contrast !== 1 ? `contrast(${look.contrast})` : '',
    look.saturation && look.saturation !== 1 ? `saturate(${look.saturation})` : '',
  ];
  return [LOOKS[look.preset] ?? '', ...fine, look.bw ? 'grayscale(1) contrast(1.12)' : ''].filter(Boolean).join(' ') || 'none';
}

/** One crop of the source video filling a w×h box. */
const Pane: React.FC<{
  spec: ShortSpec; piece: Piece; w: number; h: number; x: number; y: number; zoom: number; audible: boolean; mode: 'cover' | 'contain' | 'blur';
}> = ({ spec, piece, w, h, x, y, zoom, audible, mode }) => {
  const { fps } = useVideoConfig();
  const base = mode === 'contain' ? Math.min(w / spec.srcW, h / spec.srcH) : Math.max(w / spec.srcW, h / spec.srcH);
  const s = base * (mode === 'blur' ? 1.15 : zoom);
  const dw = spec.srcW * s;
  const dh = spec.srcH * s;
  const left = mode === 'cover' ? -(dw - w) * (x / 100) : (w - dw) / 2;
  const top = mode === 'cover' ? -(dh - h) * (y / 100) : (h - dh) / 2;
  const useClean = !!spec.audio.cleanSrc;
  const volume = spec.audio.voiceover?.muteOriginal ? 0 : spec.audio.voice;
  const video = (
    <OffthreadVideo
      src={spec.src}
      trimBefore={Math.round(piece.srcStart * fps)}
      playbackRate={piece.hold ? 1 : piece.rate}
      muted={piece.hold || !audible || useClean || volume <= 0}
      volume={volume}
      pauseWhenBuffering
      style={{ position: 'absolute', left, top, width: dw, height: dh, maxWidth: 'none', objectFit: 'fill', filter: mode === 'blur' ? 'blur(34px) brightness(0.55)' : undefined }}
    />
  );
  return (
    <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', background: '#000' }}>
      {piece.hold ? <Freeze frame={0}>{video}</Freeze> : video}
    </div>
  );
};

const Panes: React.FC<{ spec: ShortSpec; piece: Piece }> = ({ spec, piece }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = piece.hold ? piece.srcStart : piece.srcStart + (frame / fps) * piece.rate;
  const shot: Shot = spec.shots[piece.shot] ?? { start: 0, layout: 'single', x: [50], transition: 'cut' };
  const xs = paneXAt(spec.shots, t);
  const zoom = zoomAt(spec.zooms, t) * driftAt(spec.shots, t, spec.out, spec.look.drift ?? 0);
  const y = shot.y ?? 50;
  const cleanVolume = spec.audio.voiceover?.muteOriginal ? 0 : spec.audio.voice;
  const clean = spec.audio.cleanSrc && cleanVolume > 0 && !piece.hold && (
    <Audio src={spec.audio.cleanSrc} playbackRate={piece.rate} trimBefore={Math.max(0, Math.round((piece.srcStart - (spec.audio.cleanOffset ?? 0)) * fps))} volume={cleanVolume} />
  );

  // The picture area: the whole frame, or a box on a background ("panel").
  const fm = spec.frame ?? DEFAULT_FRAME;
  const panel = fm.mode === 'panel';
  const bw = panel ? Math.round((width * fm.width) / 100) : width;
  const bh = panel ? Math.min(height, Math.round(bw / fm.aspect)) : height;
  const radius = !panel ? 0 : fm.shape === 'square' ? 0 : fm.shape === 'squircle' ? bw * 0.19 : bw * 0.06;
  const boxTop = panel ? Math.max(0, Math.min(height - bh, (height * fm.y) / 100 - bh / 2)) : 0;

  let inner: React.ReactNode;
  if (shot.layout === 'fit') {
    inner = (
      <>
        <AbsoluteFill><Pane spec={spec} piece={piece} w={bw} h={bh} x={50} y={50} zoom={1} audible={false} mode="blur" /></AbsoluteFill>
        <AbsoluteFill><Pane spec={spec} piece={piece} w={bw} h={bh} x={50} y={50} zoom={zoom} audible mode="contain" /></AbsoluteFill>
      </>
    );
  } else {
    const n = shot.layout === 'split' ? 2 : shot.layout === 'trio' ? 3 : 1;
    const landscape = bw > bh;
    const gap = n > 1 ? Math.round(bw * 0.006) : 0;
    const pw = landscape ? (bw - gap * (n - 1)) / n : bw;
    const ph = landscape ? bh : (bh - gap * (n - 1)) / n;
    inner = (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: landscape ? 'row' : 'column', gap, background: '#000' }}>
        {Array.from({ length: n }, (_, i) => (
          <Pane key={i} spec={spec} piece={piece} w={pw} h={ph} x={xs[i] ?? 50} y={y} zoom={zoom} audible={i === 0} mode="cover" />
        ))}
      </div>
    );
  }
  if (!panel) return <AbsoluteFill>{clean}{inner}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {clean}
      {fm.bg === 'blur' && <AbsoluteFill><Pane spec={spec} piece={piece} w={width} h={height} x={50} y={50} zoom={1} audible={false} mode="blur" /></AbsoluteFill>}
      <div style={{ position: 'absolute', left: (width - bw) / 2, top: boxTop, width: bw, height: bh, borderRadius: radius, overflow: 'hidden' }}>{inner}</div>
    </AbsoluteFill>
  );
};

const HookTitle: React.FC<{ spec: ShortSpec; u: number }> = ({ spec, u }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.round(spec.hook.duration * fps);
  if (!spec.hook.visible || !spec.hook.text.trim() || frame >= total) return null;
  const enter = spring({ frame, fps, config: { damping: 12, stiffness: 200, mass: 0.7 } });
  const exit = interpolate(frame, [total - fps * 0.25, total], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const words = spec.hook.text.trim().split(/\s+/);
  const accentFrom = Math.max(1, words.length - (words.length > 4 ? 2 : 1));
  const size = (96 * u * Math.min(1, 26 / Math.max(14, spec.hook.text.length)) + 22 * u) * (spec.hook.scale ?? 1);
  return (
    <div data-el="hook" style={{ position: 'absolute', left: `${spec.hook.x ?? 50}%`, top: `${spec.hook.y ?? 11}%`, width: 'max-content', maxWidth: '86%', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: size * 0.24, rowGap: size * 0.04, opacity: exit, transform: `translateX(-50%) scale(${interpolate(enter, [0, 1], [0.7, 1])})` }}>
      {words.map((w, i) => (
        <span key={i} style={{
          fontFamily: fontStack(spec.brand.font), fontWeight: fontWeight(spec.brand.font), fontSize: size, lineHeight: 1.04, textTransform: 'uppercase',
          color: i >= accentFrom ? spec.brand.accent : spec.brand.secondary, WebkitTextStroke: `${10 * u}px #000`, paintOrder: 'stroke fill',
          textShadow: `0 ${6 * u}px 0 rgba(0,0,0,.55)`,
        }}>{w}</span>
      ))}
    </div>
  );
};

const BrandLayer: React.FC<{ spec: ShortSpec; u: number }> = ({ spec, u }) => {
  const { brand } = spec;
  const pad = 44 * u;
  const free = brand.logoX !== undefined && brand.logoY !== undefined;
  const pos: React.CSSProperties = free
    ? { left: `${brand.logoX}%`, top: `${brand.logoY}%`, transform: 'translate(-50%, -50%)' }
    : { [brand.logoPos.startsWith('top') ? 'top' : 'bottom']: pad, [brand.logoPos.endsWith('left') ? 'left' : 'right']: pad };
  return (
    <>
      {brand.logo && <Img data-el="logo" src={brand.logo} style={{ position: 'absolute', width: `${brand.logoSize}%`, height: 'auto', opacity: brand.logoOpacity ?? 1, ...pos }} />}
      {brand.watermark && (
        <div data-el="watermark" style={{
          position: 'absolute', left: `${brand.watermarkX ?? 50}%`, top: `${brand.watermarkY ?? 97.6}%`, transform: 'translate(-50%, -50%)', whiteSpace: 'nowrap',
          fontFamily: fontStack('Inter'), fontWeight: 600, fontSize: (brand.watermarkSize ?? 28) * u, color: '#fff', opacity: brand.watermarkOpacity ?? 0.62,
          textShadow: '0 1px 4px rgba(0,0,0,.7)', letterSpacing: '0.04em',
        }}>{brand.watermark}</div>
      )}
    </>
  );
};

const HeaderLayer: React.FC<{ spec: ShortSpec; u: number }> = ({ spec, u }) => {
  const h = spec.header;
  if (!h || !(h.name || h.avatar)) return null;
  const size = 150 * u;
  return (
    <div data-el="header" style={{ position: 'absolute', left: '50%', top: `${h.y}%`, transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: 22 * u, width: 'max-content', maxWidth: '92%' }}>
      {h.avatar && <Img src={h.avatar} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: `${3 * u}px solid #eaffff`, boxShadow: `0 0 ${26 * u}px rgba(80,160,255,.55)` }} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 * u }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 * u, fontFamily: fontStack('Poppins'), fontWeight: 800, fontSize: 48 * u, color: '#fff', lineHeight: 1.1 }}>
          {h.name}
          {h.verified && (
            <svg width={40 * u} height={40 * u} viewBox="0 0 24 24"><path fill="#2f8fff" d="M12 1.5 14.6 3.6l3.3-.3.9 3.2 2.9 1.6-1.2 3.1 1.2 3.1-2.9 1.6-.9 3.2-3.3-.3L12 20.9l-2.6-2.1-3.3.3-.9-3.2-2.9-1.6 1.2-3.1-1.2-3.1 2.9-1.6.9-3.2 3.3.3z" /><path fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m8 11.4 2.7 2.7L16 8.9" /></svg>
          )}
        </div>
        {h.handle && <div style={{ fontFamily: fontStack('Poppins'), fontWeight: 700, fontStyle: 'italic', fontSize: 32 * u, color: '#aaaaaa' }}>{h.handle}</div>}
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- transitions between shots */

type Fx = { style: React.CSSProperties; under?: { cut: Cut; style: React.CSSProperties }; wash?: { color: string; opacity: number } };
const smooth = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
const noise = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };   // repeatable per frame

/** What a transition does to the picture at this frame, or null when none is playing. */
function transitionFx(cuts: Cut[], frame: number, u: number): Fx | null {
  for (const c of cuts) {
    const d = frame - c.frame;
    if (c.type === 'fade' || c.type === 'slide' || c.type === 'push') {
      // the new shot arrives over the old shot's last frame, so nothing that was cut out is ever shown
      if (d < 0 || d >= c.frames) continue;
      const p = smooth((d + 1) / (c.frames + 1));
      if (c.type === 'fade') return { style: { opacity: p }, under: { cut: c, style: {} } };
      if (c.type === 'slide') return { style: { transform: `translateX(${(1 - p) * 100}%)`, boxShadow: `${-40 * u}px 0 ${90 * u}px rgba(0,0,0,.6)` }, under: { cut: c, style: { filter: `brightness(${1 - 0.4 * p})` } } };
      return { style: { transform: `translateX(${(1 - p) * 100}%)` }, under: { cut: c, style: { transform: `translateX(${-p * 100}%)` } } };
    }
    // the rest build up on the outgoing shot, peak on the cut and settle on the incoming one
    const half = Math.max(1, Math.round(c.frames / 2));
    if (d < -half || d >= half) continue;
    const k = d < 0 ? (d + half + 1) / (half + 1) : 1 - d / half;
    const kk = k * k;
    const dir = d < 0 ? -1 : 1;
    switch (c.type) {
      case 'zoom': return { style: { transform: `scale(${1 + 0.6 * kk})`, filter: `blur(${14 * kk * u}px)` } };
      case 'whip': return { style: { transform: `translateX(${dir * 22 * kk}%) scale(${1 + 0.5 * kk}, ${1 + 0.12 * kk})`, filter: `blur(${12 * kk * u}px)` } };
      case 'spin': return { style: { transform: `rotate(${-dir * 14 * kk}deg) scale(${1 + 0.55 * kk})`, filter: `blur(${9 * kk * u}px)` } };
      case 'blur': return { style: { transform: `scale(${1 + 0.08 * k})`, filter: `blur(${26 * kk * u}px)` } };
      case 'flash': return { style: {}, wash: { color: '#fff', opacity: Math.pow(k, 1.5) } };
      case 'dip': return { style: {}, wash: { color: '#000', opacity: smooth(k) } };
      case 'glitch': {
        const a = noise(frame), b = noise(frame + 31), g = noise(frame + 67);
        return { style: { transform: `translateX(${(a * 2 - 1) * 5 * k}%) skewX(${(b * 2 - 1) * 8 * k}deg) scale(${1 + 0.12 * k})`, filter: `hue-rotate(${g * 120 * k}deg) saturate(${1 + 1.6 * k}) contrast(${1 + 0.3 * k})` } };
      }
      default: return null;
    }
  }
  return null;
}

/** Film grain: a small noise field stretched over the frame, redrawn every frame. */
const Grain: React.FC<{ amount: number }> = ({ amount }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const w = Math.ceil(width / 3), h = Math.ceil(height / 3);
  return (
    <AbsoluteFill style={{ opacity: Math.min(1, amount) * 0.55, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <svg width={w} height={h} style={{ width: '100%', height: '100%' }} preserveAspectRatio="none" viewBox={`0 0 ${w} ${h}`}>
        <filter id="cutroom-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={frame % 61} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={w} height={h} filter="url(#cutroom-grain)" />
      </svg>
    </AbsoluteFill>
  );
};

const FULL_FRAME = new Set(['spotlight', 'flash', 'dip']);

export const Short: React.FC<{ spec: ShortSpec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const u = width / 1080;
  const plan = useMemo(() => buildPlan(spec), [spec.segments, spec.shots, spec.freezes, spec.speeds, spec.in, spec.out, spec.fps]);
  const cuts = useMemo(() => transitionCuts(plan, spec.shots, fps), [plan, spec.shots, fps]);
  const fx = transitionFx(cuts, frame, u);
  // fades at the two ends of the short: 1 = fully visible
  const fadeIn = spec.look.fadeIn ? Math.min(1, frame / Math.max(1, spec.look.fadeIn * fps)) : 1;
  const fadeOut = spec.look.fadeOut ? Math.min(1, (durationInFrames - 1 - frame) / Math.max(1, spec.look.fadeOut * fps)) : 1;
  const ends = Math.max(0, Math.min(fadeIn, fadeOut));
  const t = srcTimeAt(plan, frame, fps);
  const envelope = useMemo(() => (spec.audio.music?.duck ? speechEnvelope(plan, spec.words, fps) : null), [plan, spec.words, fps, spec.audio.music?.duck]);

  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    fontsReady().then(() => continueRender(handle));
  }, [handle]);

  const broll = spec.graphics.filter((g) => g.type === 'broll');
  const overlays = spec.graphics.filter((g) => g.type !== 'broll' && !FULL_FRAME.has(g.type));
  const effects = spec.graphics.filter((g) => FULL_FRAME.has(g.type));   // dim, flash and dip sit over the picture, under the text
  // a full-screen card owns the frame; captions underneath would only show through as noise
  const coveredByGraphic = overlays.some((g) => {
    if (g.zone !== 'full') return false;
    const { from, frames } = graphicFrames(plan, g, fps);
    return frame >= from && frame < from + frames;
  });
  const music = spec.audio.music;
  const vo = spec.audio.voiceover;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ filter: lookFilter(spec.look) }}>
        {cuts.filter((c) => c.type === 'fade' || c.type === 'slide' || c.type === 'push').map((c) => (
          // the outgoing shot's last frame, held underneath while the new shot arrives
          <Sequence key={`under-${c.frame}`} from={c.frame} durationInFrames={c.frames} premountFor={fps}>
            <AbsoluteFill style={{ ...(fx?.under?.cut === c ? fx.under.style : {}), ...(spec.look.flip ? { transform: `${(fx?.under?.cut === c && fx.under.style.transform) || ''} scaleX(-1)` } : {}) }}>
              <Panes spec={spec} piece={{ srcStart: c.prevTime, srcEnd: c.prevTime, from: c.frame, frames: c.frames, shot: c.prevShot, rate: 1, hold: true }} />
            </AbsoluteFill>
          </Sequence>
        ))}
        <AbsoluteFill style={fx?.style}>
          <AbsoluteFill style={spec.look.flip ? { transform: 'scaleX(-1)' } : undefined}>
          {plan.map((piece) => (
            <Sequence key={`${piece.from}-${piece.srcStart}`} from={piece.from} durationInFrames={piece.frames} premountFor={fps}>
              <Panes spec={spec} piece={piece} />
            </Sequence>
          ))}
          </AbsoluteFill>
        </AbsoluteFill>
        {broll.map((g) => {
          const { from, frames } = graphicFrames(plan, g, fps);
          return (
            <Sequence key={g.id} from={from} durationInFrames={frames} premountFor={fps}>
              <GraphicLayer g={g} brand={spec.brand} u={u} frames={frames} fxVolume={spec.audio.fx} sfxBase={spec.sfxBase} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {fx?.wash && <AbsoluteFill style={{ background: fx.wash.color, opacity: fx.wash.opacity }} />}
      {spec.look.vignette && <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,.62) 100%)' }} />}
      {(spec.look.grain ?? 0) > 0 && <Grain amount={spec.look.grain!} />}
      {(spec.look.bars ?? 0) > 0 && (
        <>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${spec.look.bars}%`, background: '#000' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${spec.look.bars}%`, background: '#000' }} />
        </>
      )}
      {effects.filter((g) => g.type === 'spotlight').map((g) => {
        const { from, frames } = graphicFrames(plan, g, fps);
        return (
          <Sequence key={g.id} from={from} durationInFrames={frames}>
            <GraphicLayer g={g} brand={spec.brand} u={u} frames={frames} fxVolume={spec.audio.fx} sfxBase={spec.sfxBase} />
          </Sequence>
        );
      })}
      {!coveredByGraphic && <CaptionLayer spec={spec.captions} words={spec.words} t={t} u={u} />}
      {overlays.map((g) => {
        const { from, frames } = graphicFrames(plan, g, fps);
        return (
          <Sequence key={g.id} from={from} durationInFrames={frames}>
            <GraphicLayer g={g} brand={spec.brand} u={u} frames={frames} fxVolume={spec.audio.fx} sfxBase={spec.sfxBase} />
          </Sequence>
        );
      })}
      <HookTitle spec={spec} u={u} />
      <HeaderLayer spec={spec} u={u} />
      {effects.filter((g) => g.type !== 'spotlight').map((g) => {
        const { from, frames } = graphicFrames(plan, g, fps);
        return (
          <Sequence key={g.id} from={from} durationInFrames={frames}>
            <GraphicLayer g={g} brand={spec.brand} u={u} frames={frames} fxVolume={spec.audio.fx} sfxBase={spec.sfxBase} />
          </Sequence>
        );
      })}
      <BrandLayer spec={spec} u={u} />
      {spec.look.progressBar && (
        <div style={{ position: 'absolute', left: 0, bottom: 0, height: 10 * u, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`, background: spec.brand.accent }} />
      )}
      {ends < 1 && <AbsoluteFill style={{ background: '#000', opacity: 1 - ends }} />}
      {music?.src && music.volume > 0 && (
        <Audio src={music.src} loop trimBefore={Math.round((music.start || 0) * fps)}
          volume={(f) => music.volume * (envelope ? 1 - 0.72 * (envelope[Math.min(envelope.length - 1, f)] ?? 0) : 1)
            * (spec.look.fadeOut ? Math.max(0, Math.min(1, (durationInFrames - 1 - f) / Math.max(1, spec.look.fadeOut * fps))) : 1)} />
      )}
      {vo?.src && vo.volume > 0 && (
        <Sequence from={Math.round((vo.at || 0) * fps)}>
          <Audio src={vo.src} volume={vo.volume} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

export const shortDuration = (spec: ShortSpec) => totalFrames(buildPlan(spec));
