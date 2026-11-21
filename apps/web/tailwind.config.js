import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** Theme tokens from design/DESIGN.md ("Obsidian Radar"). */
export default {
  content: [here('./index.html'), here('./src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        'space-deep': '#05070E',
        'space-canvas': '#0B0F19',
        'surface-card': '#0F1626',
        surface: '#11131b',
        'surface-container-low': '#191b23',
        'surface-container': '#1d1f27',
        'surface-container-high': '#272a32',
        'surface-container-highest': '#32343d',
        'surface-variant': '#32343d',
        'on-surface': '#e1e2ed',
        'on-surface-variant': '#bbc9cf',
        outline: '#859399',
        'outline-variant': '#3c494e',
        primary: '#a5e7ff',
        'on-primary': '#003543',
        'primary-container': '#00d2ff',
        'on-primary-container': '#00566a',
        'primary-fixed-dim': '#47d6ff',
        secondary: '#7bd0ff',
        tertiary: '#ffd6a7',
        'metric-amber': '#FBBF24',
        'metric-amber-bg': 'rgba(245, 158, 11, 0.12)',
        'border-subtle': 'rgba(56, 189, 248, 0.12)',
        'border-highlight': 'rgba(0, 210, 255, 0.4)',
        'radar-arc': 'rgba(0, 210, 255, 0.18)',
        error: '#ffb4ab',
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
        display: ['40px', { lineHeight: '48px', letterSpacing: '-0.025em', fontWeight: '700' }],
        'headline-lg': [
          '30px',
          { lineHeight: '38px', letterSpacing: '-0.02em', fontWeight: '600' },
        ],
        'headline-md': [
          '22px',
          { lineHeight: '30px', letterSpacing: '-0.015em', fontWeight: '600' },
        ],
        'title-md': ['18px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', fontWeight: '400' }],
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
