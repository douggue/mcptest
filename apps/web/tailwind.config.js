import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** Theme tokens from design/DESIGN.md ("Obsidian Radar"). */
export default {
  content: [here('./index.html'), here('./src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      // The redesign's palette (design/redesign): a navy-black ground, cyan for the one
      // main action and "you are here", amber for breakout scores only.
      colors: {
        ground: '#05070E',
        'ground-2': '#0A0E18',
        card: '#0F1626',
        'card-2': '#141D31',
        line: 'rgba(148, 178, 214, 0.13)',
        'line-2': 'rgba(148, 178, 214, 0.26)',
        ink: '#E8EAF3',
        muted: '#9EABBB',
        dim: '#73819A',
        signal: '#00D2FF',
        'on-signal': '#02141B',
        link: '#38BDF8',
        score: '#FBBF24',
        good: '#34D399',
        bad: '#F87171',
        mid: '#A78BFA',
        // The names the older screens use, set to the same palette.
        'space-deep': '#05070E',
        'space-canvas': '#0A0E18',
        'surface-card': '#0F1626',
        surface: '#0A0E18',
        'surface-container-low': '#0F1626',
        'surface-container': '#121A2C',
        'surface-container-high': '#141D31',
        'surface-container-highest': '#1B2740',
        'surface-variant': '#1B2740',
        'on-surface': '#E8EAF3',
        'on-surface-variant': '#9EABBB',
        outline: '#73819A',
        'outline-variant': '#2A3852',
        primary: '#38BDF8',
        'on-primary': '#02141B',
        'primary-container': '#00D2FF',
        'on-primary-container': '#00566a',
        'primary-fixed-dim': '#47d6ff',
        secondary: '#7bd0ff',
        tertiary: '#ffd6a7',
        'metric-amber': '#FBBF24',
        'metric-amber-bg': 'rgba(251, 191, 36, 0.12)',
        'border-subtle': 'rgba(148, 178, 214, 0.13)',
        'border-highlight': 'rgba(0, 210, 255, 0.4)',
        'radar-arc': 'rgba(0, 210, 255, 0.18)',
        error: '#F87171',
      },
      // Controls 12px, cards 16px, sheets 24px; `rounded-full` only for chips, avatars and small buttons.
      borderRadius: { DEFAULT: '0.75rem', md: '0.625rem', lg: '1rem', xl: '1.5rem' },
      spacing: {
        gutter: '1rem',
        'gutter-desktop': '1.5rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2.5rem',
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'Geist', 'system-ui', 'sans-serif'],
      },
      // A readable scale: body 16px, meta 14px, labels in sentence case (docs/UI_DESIGN.md).
      fontSize: {
        display: ['40px', { lineHeight: '48px', letterSpacing: '-0.02em', fontWeight: '650' }],
        'headline-lg': [
          '30px',
          { lineHeight: '38px', letterSpacing: '-0.02em', fontWeight: '650' },
        ],
        'headline-md': [
          '22px',
          { lineHeight: '30px', letterSpacing: '-0.012em', fontWeight: '620' },
        ],
        'title-md': ['18px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
        // An AI's answer: larger than body, with room between lines.
        answer: ['18px', { lineHeight: '29px', fontWeight: '400' }],
        'body-md': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        label: ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'metric-badge': [
          '13px',
          { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '700' },
        ],
      },
    },
  },
  plugins: [],
};
