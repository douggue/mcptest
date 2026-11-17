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
  color?: string;      // overrides the caption colour for this word (per-speaker colours)
};

export type Segment = { start: number; end: number }; // a kept range of the source
export type Freeze = { id: string; at: number; duration: number };               // hold the picture at a source time
export type Speed = { id: string; start: number; end: number; rate: number };    // play a source range faster or slower
export type FrameMode = {
  mode: 'full' | 'panel';       // panel = the video sits in a box on a background
  shape: 'square' | 'rounded' | 'squircle';
  corner?: number;              // corner size, % of the box width (defaults: rounded 6, squircle 20.6)
  width: number;                // % of frame width
  aspect: number;               // box width / height
  y: number;                    // box centre, % of frame height
  bg: 'blur' | 'black';
};
export type Header = { name: string; handle: string; avatar: string; verified: boolean; y: number };

export type Layout = 'single' | 'split' | 'trio' | 'fit';

export type Face = { cx: number; cy: number; w: number; score: number; seen?: number }; // 0..1 of the source frame; seen = share of sampled frames

export type Shot = {
  start: number;                        // where this camera setup begins
  layout: Layout;
  x: number[];                          // horizontal crop position per pane, 0 (left) .. 100 (right)
  y?: number;                           // vertical crop position, default 50
  track?: { t: number; x: number }[];   // optional follow-the-speaker keyframes for pane 0
  transition: Transition;                // how this shot arrives
  tdur?: number;                         // transition length in seconds (default 0.4)
  faces?: Face[];                       // detection result kept so layouts can be re-applied
};

/** How a shot arrives. 'smooth' slides the crop; the rest are picture transitions played around the cut. */
export type Transition = 'cut' | 'smooth' | 'fade' | 'slide' | 'push' | 'zoom' | 'whip' | 'spin' | 'blur' | 'flash' | 'dip' | 'glitch';
export const TRANSITIONS: { value: Transition; label: string; hint: string }[] = [
  { value: 'cut', label: 'Hard cut', hint: 'No effect' },
  { value: 'smooth', label: 'Smooth pan', hint: 'The crop glides to its new position' },
  { value: 'fade', label: 'Cross-fade', hint: 'The new shot fades in over the last frame of the old one' },
  { value: 'slide', label: 'Slide over', hint: 'The new shot slides in from the right' },
  { value: 'push', label: 'Push', hint: 'The new shot pushes the old one off to the left' },
  { value: 'zoom', label: 'Zoom through', hint: 'Punches in through a blur into the new shot' },
  { value: 'whip', label: 'Whip pan', hint: 'A fast sideways smear between the shots' },
  { value: 'spin', label: 'Spin', hint: 'A quick twist through a blur' },
  { value: 'blur', label: 'Blur', hint: 'Out of focus, then back in' },
  { value: 'flash', label: 'Flash', hint: 'A white flash on the cut' },
  { value: 'dip', label: 'Dip to black', hint: 'Fades down to black and back up' },
  { value: 'glitch', label: 'Glitch', hint: 'A few frames of digital jitter' },
];

export type Zoom = { id: string; at: number; duration: number; scale: number };

export type GraphicType =
  | 'keyword' | 'cascade' | 'gauge' | 'counter' | 'lowerthird' | 'steps' | 'broll' | 'emoji'
  // free elements: placed anywhere, not tied to speech
  | 'label' | 'nametag' | 'circle' | 'arrow' | 'spotlight' | 'flash' | 'dip' | 'heart' | 'image' | 'blurbox';
export type LabelStyle = 'neon' | 'plain' | 'box' | 'quoted' | 'outline' | 'flat';
export type Zone = 'full' | 'top' | 'center' | 'bottom' | 'overlay' | 'free';   // free = measured from the frame centre
export type Anim = 'pop' | 'slam' | 'fade' | 'slide' | 'glitch' | 'type' | 'none';

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
  color?: string;      // label / circle / arrow / flash colour
  style?: LabelStyle;  // label look
  rotate?: number;     // degrees (arrow)
  ratio?: number;      // height / width of a blur box or a spotlight
  dim?: number;        // spotlight: how dark the surround goes, 0..1 (default 0.68)
  soft?: number;       // spotlight: edge softness, the fade's width as a share of the spot (default 0.3)
  outline?: { t: number; pts: [number, number][] }[];   // spotlight fitted to a subject: its outline over time, source time and 0..1 of the source frame
  tag?: string;        // small speaker tag above a boxed label, e.g. "Cyclist:"
  origin?: 'style' | 'ai';   // who placed it, so re-applying a style or re-planning replaces only its own
  mediaType?: 'image' | 'video' | 'gif';
};

export type Hook = {
  text: string; visible: boolean; duration: number;
  x?: number;      // centre, % of frame width (default 50)
  y?: number;      // top edge, % of frame height (default 11)
  scale?: number;  // 1 = default size
};

export type CaptionPreset = 'boldpop' | 'karaoke' | 'tape' | 'clean' | 'neon' | 'typeon' | 'shadow' | 'box' | 'glow';

export type Captions = {
  visible: boolean;
  preset: CaptionPreset;
  font: string;
  size: number;          // px at a 1080-wide frame
  color: string;
  highlight: string;
  position: number;      // % from the top of the frame
  x?: number;            // centre, % of frame width (default 50)
  lead?: number;         // seconds a caption appears before its word (default 0.04)
  uppercase: boolean;
  noPunct?: boolean;     // drop full stops, commas and the like; keep ? ! and apostrophes
  maxWords: number;
  emoji: boolean;
  mode: 'original' | 'translated' | 'bilingual';
  translations: { start: number; end: number; text: string }[];
};

export type LookPreset = 'none' | 'punchy' | 'warm' | 'cool' | 'cinematic' | 'vintage';
export type Look = {
  preset: LookPreset; bw: boolean; vignette: boolean; progressBar: boolean;
  brightness?: number; contrast?: number; saturation?: number;   // fine tuning, 1 = unchanged
  grain?: number;        // film grain strength, 0..1
  bars?: number;         // letterbox bars, each as % of the frame height (0 = none)
  drift?: number;        // slow push-in across each shot: extra scale reached by the end (0.08 = 8%)
  fadeIn?: number;       // seconds the picture takes to come up from black at the start
  fadeOut?: number;      // seconds the picture and music take to go down at the end
  flip?: boolean;        // mirror the picture left to right
};

export type AudioMix = {
  voice: number;   // 0..1
  fx: number;      // 0..1
  cleanSrc?: string;      // cleaned-up voice track (replaces the video's own audio)
  cleanOffset?: number;   // source time at which cleanSrc starts
  /** start: seconds into the song at the short's first frame; replaces: the original sound is muted while it plays. */
  music: { src: string; volume: number; duck: boolean; start: number; fadeIn?: number; fadeOut?: number; replaces?: boolean; length?: number } | null;
  voiceover: { src: string; volume: number; at: number; muteOriginal: boolean } | null; // `at` is seconds into the short
  lufs?: number;   // loudness the export is evened out to (set by a style), e.g. -16
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
  ranges?: Segment[];     // the clip's own source ranges when it is made of several parts (merged clips, recaps): gaps between them stay cut
  freezes?: Freeze[];
  speeds?: Speed[];
  frame?: FrameMode;
  header?: Header;
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
  '3:4': { width: 1080, height: 1440 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
} as const;
export type Aspect = keyof typeof ASPECTS;

export const FONTS = ['Anton', 'Archivo Black', 'Bebas Neue', 'Montserrat', 'Poppins', 'Cinzel', 'Inter', 'JetBrains Mono'] as const;

export const DEFAULT_FRAME: FrameMode = { mode: 'full', shape: 'rounded', width: 100, aspect: 1, y: 50, bg: 'blur' };
