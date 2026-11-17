import React, { useMemo } from 'react';
import { interpolate, spring, useVideoConfig } from 'remotion';

import { EMOJI_STACK, fontStack, fontWeight } from './fonts';
import { captionPages } from './timing';
import { Captions as CaptionsSpec, Word } from './types';

const outline = (px: number, color = '#000') =>
  ({ WebkitTextStroke: `${px}px ${color}`, paintOrder: 'stroke fill' }) as React.CSSProperties;

/** Captions for source time `t`. `u` is the frame-width unit (1 at 1080px wide). */
export const CaptionLayer: React.FC<{ spec: CaptionsSpec; words: Word[]; t: number; u: number }> = ({ spec, words, t, u }) => {
  const { fps } = useVideoConfig();
  const pages = useMemo(() => captionPages(words, spec.maxWords), [words, spec.maxWords]);
  if (!spec.visible) return null;
  const lead = spec.lead ?? 0.04;

  let page = null as (typeof pages)[number] | null;
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    if (t >= pages[i].start - lead && t < (next ? Math.min(next.start - lead, pages[i].end + 0.5) : pages[i].end + 0.5)) {
      page = pages[i];
      break;
    }
  }
  const translation = spec.mode !== 'original' ? spec.translations.find((l) => t >= l.start && t < l.end) : undefined;
  if (!page && !translation) return null;

  const size = spec.size * u;
  const family = fontStack(spec.font);
  const weight = fontWeight(spec.font);
  const wrap: React.CSSProperties = {
    position: 'absolute', left: `${spec.x ?? 50}%`, top: `${spec.position}%`, transform: 'translate(-50%, -50%)',
    width: 'max-content', maxWidth: '88%',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 0.18, textAlign: 'center',
  };
  const tr = (s: string) => {
    const t = spec.noPunct ? s.replace(/[.,;:…]+/g, '') : s;
    return spec.uppercase ? t.toUpperCase() : t;
  };
  const since = page ? Math.max(0, t - page.start) : 0;
  const enter = spring({ frame: since * fps, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });

  const translated = translation && (
    <div style={{
      fontFamily: fontStack('Inter'), fontWeight: 800, fontSize: (spec.mode === 'bilingual' ? 0.58 : 0.8) * size, color: spec.color,
      lineHeight: 1.15, textShadow: `0 ${3 * u}px ${10 * u}px rgba(0,0,0,.85)`, ...outline(6 * u),
    }}>{translation.text}</div>
  );
  if (spec.mode === 'translated') return <div style={wrap} data-el="captions">{translated}</div>;
  if (!page) return <div style={wrap} data-el="captions">{translated}</div>;

  const emojiWord = spec.emoji ? page.words.find((w) => w.emoji) : undefined;
  const emoji = emojiWord && (
    <div style={{ fontFamily: EMOJI_STACK, fontSize: size * 1.25, lineHeight: 1, transform: `scale(${enter}) rotate(${interpolate(enter, [0, 1], [-18, 0])}deg)` }}>
      {emojiWord.emoji}
    </div>
  );

  const line = (children: React.ReactNode, style: React.CSSProperties = {}) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: size * 0.26, rowGap: size * 0.1, fontFamily: family, fontWeight: weight, fontSize: size, lineHeight: 1.08, ...style }}>
      {children}
    </div>
  );
  const isActive = (w: Word) => t >= w.start - 0.02 && t < w.end + 0.06;
  const isSpoken = (w: Word) => t >= w.start - 0.02;

  const fill = (w: Word, fallback: string) => w.color ?? fallback;
  let body: React.ReactNode;
  switch (spec.preset) {
    case 'shadow': {   // heavy type on a soft dark shadow, no outline; pops 95 → 102 → 100
      const d = Math.max(0.2, page.end - page.start);
      const p = Math.min(1, since / d);
      const pop = p < 0.17 ? interpolate(p, [0, 0.17], [0.95, 1.02]) : p < 0.3 ? interpolate(p, [0.17, 0.3], [1.02, 1]) : 1;
      body = line(page.words.map((w) => (
        <span key={w.id} style={{ color: fill(w, w.emphasis ? spec.highlight : spec.color), textShadow: `0 0 ${7 * u}px #000, 0 0 ${14 * u}px #000, 0 ${4 * u}px ${18 * u}px rgba(0,0,0,.9)` }}>{tr(w.text)}</span>
      )), { transform: `scale(${pop})` });
      break;
    }
    case 'box':   // white text on a plain black rectangle
      body = (
        <div style={{ background: '#000', padding: `${size * 0.3}px ${size * 0.42}px` }}>
          {line(page.words.map((w) => (
            <span key={w.id} style={{ color: fill(w, w.emphasis ? spec.highlight : spec.color) }}>{tr(w.text)}</span>
          )), { fontSize: size * 0.72, columnGap: size * 0.2 })}
        </div>
      );
      break;
    case 'glow': {   // saturated fill, darker outline of the same hue, a wide tinted haze; colour changes clause by clause
      const cycle = [spec.highlight, '#08d600', '#ff6552'];
      const hue = page.words.some((w) => w.emphasis) ? '#ff6552' : cycle[pages.indexOf(page) % 2];
      const wob = Math.sin(t * 5) * 4 * u;
      body = line(page.words.map((w) => {
        const c = fill(w, hue);
        return <span key={w.id} style={{ color: c, WebkitTextStroke: `${5 * u}px color-mix(in srgb, ${c} 45%, #000)`, paintOrder: 'stroke fill', textShadow: `0 0 ${18 * u}px ${c}, 0 0 ${70 * u}px color-mix(in srgb, ${c} 40%, #000), 0 0 ${150 * u}px rgba(0,0,0,.9)` }}>{tr(w.text)}</span>;
      }), { transform: `translateY(${wob}px)`, opacity: Math.min(1, since * 10 + 0.3) });
      break;
    }
    case 'karaoke':
      body = line(page.words.map((w) => (
        <span key={w.id} style={{ color: isSpoken(w) ? spec.highlight : spec.color, opacity: isSpoken(w) ? 1 : 0.75, ...outline(9 * u), textShadow: `0 ${4 * u}px ${12 * u}px rgba(0,0,0,.6)` }}>{tr(w.text)}</span>
      )), { transform: `scale(${interpolate(enter, [0, 1], [0.9, 1])})` });
      break;
    case 'tape':
      body = line(page.words.map((w) => {
        const on = isActive(w) || (w.emphasis && isSpoken(w));
        return (
          <span key={w.id} style={{
            fontFamily: fontStack('JetBrains Mono'), fontWeight: 600, fontSize: size * 0.62, letterSpacing: '0.04em',
            padding: `${size * 0.1}px ${size * 0.2}px`, background: on ? spec.highlight : '#f4f1ea', color: on ? '#fff' : '#141414',
            boxShadow: `0 ${3 * u}px ${8 * u}px rgba(0,0,0,.45)`, transform: `rotate(${(w.id % 3) - 1}deg)`,
          }}>{tr(w.text)}</span>
        );
      }), { columnGap: size * 0.1, rowGap: size * 0.14 });
      break;
    case 'clean':
      body = (
        <div style={{ background: 'rgba(10,10,12,.62)', borderRadius: size * 0.28, padding: `${size * 0.22}px ${size * 0.4}px`, opacity: enter }}>
          {line(page.words.map((w) => (
            <span key={w.id} style={{ color: fill(w, isActive(w) ? spec.highlight : spec.color) }}>{tr(w.text)}</span>
          )), { fontFamily: fontStack('Inter'), fontWeight: 600, fontSize: size * 0.66, columnGap: size * 0.18 })}
        </div>
      );
      break;
    case 'neon':
      body = line(page.words.map((w) => {
        const on = isActive(w);
        return (
          <span key={w.id} style={{
            color: on ? '#fff' : spec.highlight,
            textShadow: `0 0 ${10 * u}px ${spec.highlight}, 0 0 ${28 * u}px ${spec.highlight}, 0 0 ${60 * u}px ${spec.highlight}, 0 ${3 * u}px ${6 * u}px rgba(0,0,0,.8)`,
            transform: on ? 'scale(1.08)' : undefined, display: 'inline-block',
          }}>{tr(w.text)}</span>
        );
      }), { opacity: interpolate(enter, [0, 1], [0.3, 1]) });
      break;
    case 'typeon':
      body = line(
        <>
          {page.words.filter(isSpoken).map((w) => (
            <span key={w.id} style={{ color: w.emphasis ? spec.highlight : spec.color, ...outline(8 * u) }}>{tr(w.text)}</span>
          ))}
          <span style={{ width: size * 0.09, height: size * 0.9, background: spec.highlight, opacity: Math.floor(t * 4) % 2 ? 1 : 0.2 }} />
        </>,
        { alignItems: 'center' },
      );
      break;
    case 'boldpop':
    default:
      body = line(page.words.map((w) => {
        const on = isActive(w);
        const pop = on ? spring({ frame: (t - w.start) * fps, fps, config: { damping: 9, stiffness: 260, mass: 0.5 } }) : 0;
        return (
          <span key={w.id} style={{
            display: 'inline-block', color: fill(w, on || (w.emphasis && isSpoken(w)) ? spec.highlight : spec.color),
            transform: `scale(${1 + 0.14 * pop}) rotate(${on ? -2 * pop : 0}deg)`,
            ...outline(11 * u), textShadow: `0 ${6 * u}px ${0}px rgba(0,0,0,.55)`,
          }}>{tr(w.text)}</span>
        );
      }), { transform: `scale(${interpolate(enter, [0, 1], [0.78, 1])})` });
  }

  return (
    <div style={wrap} data-el="captions">
      {emoji}
      {body}
      {spec.mode === 'bilingual' && translated}
    </div>
  );
};
