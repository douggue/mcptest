import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { CaptionLayer } from './Captions';
import { GraphicLayer } from './Graphics';
import { fontStack, fontWeight, fontsReady } from './fonts';
import { Piece, buildPlan, graphicFrames, paneXAt, speechEnvelope, srcTimeAt, totalFrames, zoomAt } from './timing';
import { Look, ShortSpec, Shot } from './types';

const LOOKS: Record<Look['preset'], string> = {
  none: '',
  punchy: 'contrast(1.16) saturate(1.28)',
  warm: 'sepia(0.16) saturate(1.22) contrast(1.05)',
  cool: 'hue-rotate(-10deg) saturate(1.12) brightness(1.03) contrast(1.05)',
  cinematic: 'contrast(1.14) saturate(0.86) brightness(0.96)',
  vintage: 'sepia(0.34) contrast(0.94) saturate(0.9) brightness(1.04)',
};

export function lookFilter(look: Look): string {
  return [LOOKS[look.preset] ?? '', look.bw ? 'grayscale(1) contrast(1.12)' : ''].filter(Boolean).join(' ') || 'none';
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
  return (
    <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', background: '#000' }}>
      <OffthreadVideo
        src={spec.src}
        trimBefore={Math.round(piece.srcStart * fps)}
        muted={!audible || useClean || volume <= 0}
        volume={volume}
        pauseWhenBuffering
        style={{ position: 'absolute', left, top, width: dw, height: dh, maxWidth: 'none', objectFit: 'fill', filter: mode === 'blur' ? 'blur(34px) brightness(0.55)' : undefined }}
      />
    </div>
  );
};

const Panes: React.FC<{ spec: ShortSpec; piece: Piece }> = ({ spec, piece }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = piece.srcStart + frame / fps;
  const shot: Shot = spec.shots[piece.shot] ?? { start: 0, layout: 'single', x: [50], transition: 'cut' };
  const xs = paneXAt(spec.shots, t);
  const zoom = zoomAt(spec.zooms, t);
  const y = shot.y ?? 50;
  const cleanVolume = spec.audio.voiceover?.muteOriginal ? 0 : spec.audio.voice;
  const clean = spec.audio.cleanSrc && cleanVolume > 0 && (
    <Audio src={spec.audio.cleanSrc} trimBefore={Math.max(0, Math.round((piece.srcStart - (spec.audio.cleanOffset ?? 0)) * fps))} volume={cleanVolume} />
  );
  if (shot.layout === 'fit') {
    return (
      <AbsoluteFill>
        {clean}
        <AbsoluteFill><Pane spec={spec} piece={piece} w={width} h={height} x={50} y={50} zoom={1} audible={false} mode="blur" /></AbsoluteFill>
        <AbsoluteFill><div style={{ position: 'absolute', inset: 0 }}><Pane spec={spec} piece={piece} w={width} h={height} x={50} y={50} zoom={zoom} audible mode="contain" /></div></AbsoluteFill>
      </AbsoluteFill>
    );
  }
  const n = shot.layout === 'split' ? 2 : shot.layout === 'trio' ? 3 : 1;
  const landscape = width > height;
  const gap = n > 1 ? Math.round(width * 0.006) : 0;
  const pw = landscape ? (width - gap * (n - 1)) / n : width;
  const ph = landscape ? height : (height - gap * (n - 1)) / n;
  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: landscape ? 'row' : 'column', gap, background: '#000' }}>
      {clean}
      {Array.from({ length: n }, (_, i) => (
        <Pane key={i} spec={spec} piece={piece} w={pw} h={ph} x={xs[i] ?? 50} y={y} zoom={zoom} audible={i === 0} mode="cover" />
      ))}
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
  const size = 96 * u * Math.min(1, 26 / Math.max(14, spec.hook.text.length)) + 22 * u;
  return (
    <div style={{ position: 'absolute', left: '7%', right: '7%', top: '11%', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: size * 0.24, rowGap: size * 0.04, opacity: exit, transform: `scale(${interpolate(enter, [0, 1], [0.7, 1])})` }}>
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
  const pos: React.CSSProperties = {
    [brand.logoPos.startsWith('top') ? 'top' : 'bottom']: pad,
    [brand.logoPos.endsWith('left') ? 'left' : 'right']: pad,
  };
  return (
    <>
      {brand.logo && <Img src={brand.logo} style={{ position: 'absolute', width: `${brand.logoSize}%`, height: 'auto', ...pos }} />}
      {brand.watermark && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 26 * u, textAlign: 'center', fontFamily: fontStack('Inter'), fontWeight: 600, fontSize: 28 * u, color: 'rgba(255,255,255,.62)', textShadow: '0 1px 4px rgba(0,0,0,.7)', letterSpacing: '0.04em' }}>{brand.watermark}</div>
      )}
    </>
  );
};

export const Short: React.FC<{ spec: ShortSpec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const { fps, width, durationInFrames } = useVideoConfig();
  const u = width / 1080;
  const plan = useMemo(() => buildPlan(spec), [spec.segments, spec.shots, spec.in, spec.out, spec.fps]);
  const t = srcTimeAt(plan, frame, fps);
  const envelope = useMemo(() => (spec.audio.music?.duck ? speechEnvelope(plan, spec.words, fps) : null), [plan, spec.words, fps, spec.audio.music?.duck]);

  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    fontsReady().then(() => continueRender(handle));
  }, [handle]);

  const broll = spec.graphics.filter((g) => g.type === 'broll');
  const overlays = spec.graphics.filter((g) => g.type !== 'broll');
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
        {plan.map((piece) => (
          <Sequence key={`${piece.from}-${piece.srcStart}`} from={piece.from} durationInFrames={piece.frames} premountFor={fps}>
            <Panes spec={spec} piece={piece} />
          </Sequence>
        ))}
        {broll.map((g) => {
          const { from, frames } = graphicFrames(plan, g, fps);
          return (
            <Sequence key={g.id} from={from} durationInFrames={frames} premountFor={fps}>
              <GraphicLayer g={g} brand={spec.brand} u={u} frames={frames} fxVolume={spec.audio.fx} sfxBase={spec.sfxBase} />
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {spec.look.vignette && <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,.62) 100%)' }} />}
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
      <BrandLayer spec={spec} u={u} />
      {spec.look.progressBar && (
        <div style={{ position: 'absolute', left: 0, bottom: 0, height: 10 * u, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`, background: spec.brand.accent }} />
      )}
      {music?.src && music.volume > 0 && (
        <Audio src={music.src} loop trimBefore={Math.round((music.start || 0) * fps)}
          volume={(f) => music.volume * (envelope ? 1 - 0.72 * (envelope[Math.min(envelope.length - 1, f)] ?? 0) : 1)} />
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
