// The complete, serialisable description of one short. The editor edits it, the Player previews it,
// and the renderer turns exactly the same object into an MP4. All times are seconds in the SOURCE video
// unless a field says otherwise.

export type Word = {
  id: number;
  text: string;
  start: number;
  end: number;
  removed?: boolean;   // cut out of the short (silence/filler/text edit)
  emphasis?: boolean;  // highlighted in captions, candidate for zooms
  emoji?: string;      // shown above the caption line
};

export type Segment = { start: number; end: number }; // a kept range of the source

export type Layout = 'single' | 'split' | 'trio' | 'fit';

export type Face = { cx: number; cy: number; w: number; score: number }; // 0..1 of the source frame

export type Shot = {
  start: number;                        // where this camera setup begins
  layout: Layout;
  x: number[];                          // horizontal crop position per pane, 0 (left) .. 100 (right)
  y?: number;                           // vertical crop position, default 50
  track?: { t: number; x: number }[];   // optional follow-the-speaker keyframes for pane 0
  transition: 'cut' | 'smooth';
  faces?: Face[];                       // detection result kept so layouts can be re-applied
};

export type Zoom = { id: string; at: number; duration: number; scale: number };

export type GraphicType = 'keyword' | 'cascade' | 'gauge' | 'counter' | 'lowerthird' | 'steps' | 'broll' | 'emoji';
export type Zone = 'full' | 'top' | 'center' | 'bottom' | 'overlay';
export type Anim = 'pop' | 'slam' | 'fade' | 'slide' | 'glitch' | 'type';

export type Graphic = {
  id: string;
  type: GraphicType;
  zone: Zone;
  at: number;          // source time it appears
  duration: number;    // seconds on screen
  animation: Anim;
  sfx: string;         // name of a file in the sfx library, '' for none
  primary: string;     // main word / value, e.g. "40%" or "SWAPPED"
  headline: string;    // small supporting line
  keywords: string[];  // for cascade / steps
  src?: string;        // media for b-roll
  dx?: number;         // moved from its zone's default spot, % of frame width / height
  dy?: number;
  scale?: number;      // resized, 1 = default
  mediaType?: 'image' | 'video' | 'gif';
};

export type Hook = {
  text: string; visible: boolean; duration: number;
  x?: number;      // centre, % of frame width (default 50)
  y?: number;      // top edge, % of frame height (default 11)
  scale?: number;  // 1 = default size
};

export type CaptionPreset = 'boldpop' | 'karaoke' | 'tape' | 'clean' | 'neon' | 'typeon';

export type Captions = {
  visible: boolean;
  preset: CaptionPreset;
  font: string;
  size: number;          // px at a 1080-wide frame
  color: string;
  highlight: string;
  position: number;      // % from the top of the frame
  x?: number;            // centre, % of frame width (default 50)
  uppercase: boolean;
  maxWords: number;
  emoji: boolean;
  mode: 'original' | 'translated' | 'bilingual';
  translations: { start: number; end: number; text: string }[];
};

export type LookPreset = 'none' | 'punchy' | 'warm' | 'cool' | 'cinematic' | 'vintage';
export type Look = { preset: LookPreset; bw: boolean; vignette: boolean; progressBar: boolean };

export type AudioMix = {
  voice: number;   // 0..1
  fx: number;      // 0..1
  cleanSrc?: string;      // cleaned-up voice track (replaces the video's own audio)
  cleanOffset?: number;   // source time at which cleanSrc starts
  music: { src: string; volume: number; duck: boolean; start: number } | null;
  voiceover: { src: string; volume: number; at: number; muteOriginal: boolean } | null; // `at` is seconds into the short
};

export type Brand = {
  accent: string;
  secondary: string;
  font: string;
  logo: string;
  logoPos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logoSize: number;   // % of frame width
  logoX?: number;     // free position of the logo's centre, % of frame; overrides logoPos when set
  logoY?: number;
  logoOpacity?: number;
  watermark: string;
  watermarkX?: number;        // centre, % of frame (default 50 / 97.6)
  watermarkY?: number;
  watermarkSize?: number;     // px at a 1080-wide frame (default 28)
  watermarkOpacity?: number;  // default 0.62
};

export type ShortSpec = {
  src: string;
  srcW: number;
  srcH: number;
  fps: number;
  width: number;
  height: number;
  in: number;
  out: number;
  segments: Segment[];
  words: Word[];
  shots: Shot[];
  zooms: Zoom[];
  graphics: Graphic[];
  hook: Hook;
  captions: Captions;
  look: Look;
  audio: AudioMix;
  brand: Brand;
  sfxBase: string;   // URL prefix of the sfx library, e.g. /media/assets/sfx/
};

export const ASPECTS = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
} as const;
export type Aspect = keyof typeof ASPECTS;

export const FONTS = ['Anton', 'Archivo Black', 'Bebas Neue', 'Montserrat', 'Inter', 'JetBrains Mono'] as const;
