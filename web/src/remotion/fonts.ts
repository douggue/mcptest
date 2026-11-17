// Fonts are bundled (no network needed at render time).
import '@fontsource/anton/400.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/poppins/900.css';
import '@fontsource/poppins/900-italic.css';
import '@fontsource/cinzel/900.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/600.css';

const LOAD = [
  '400 40px "Anton"', '400 40px "Archivo Black"', '400 40px "Bebas Neue"', '700 40px "Montserrat"',
  '900 40px "Montserrat"', '700 40px "Poppins"', '800 40px "Poppins"', '900 40px "Poppins"', 'italic 900 40px "Poppins"', '900 40px "Cinzel"', '600 40px "Inter"', '800 40px "Inter"', '600 40px "JetBrains Mono"',
];

let ready: Promise<unknown> | null = null;
/** Resolves when every bundled face is usable; text measured before that would reflow. */
export function fontsReady(): Promise<unknown> {
  if (!ready) {
    ready = typeof document === 'undefined' || !document.fonts
      ? Promise.resolve()
      : Promise.all(LOAD.map((f) => document.fonts.load(f).catch(() => null)));
  }
  return ready;
}

// Emoji come from the operating system's own colour font (a bundled web font rendered blank in headless Chromium).
export const EMOJI_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

export function fontStack(font: string): string {
  return `"${font}", "Inter", system-ui, sans-serif, ${EMOJI_STACK}`;
}

export function fontWeight(font: string): number {
  if (font === 'Montserrat' || font === 'Poppins' || font === 'Cinzel') return 900;
  if (font === 'Inter') return 800;
  if (font === 'JetBrains Mono') return 600;
  return 400;
}
