import React from 'react';
import { Composition } from 'remotion';

import { Short, shortDuration } from './Short';
import { ShortSpec } from './types';

const EMPTY: ShortSpec = {
  src: '', srcW: 1920, srcH: 1080, fps: 30, width: 1080, height: 1920, in: 0, out: 1, segments: [], words: [],
  shots: [{ start: 0, layout: 'single', x: [50], transition: 'cut' }], zooms: [], graphics: [],
  hook: { text: '', visible: false, duration: 2.4 },
  captions: { visible: true, preset: 'boldpop', font: 'Anton', size: 84, color: '#ffffff', highlight: '#ffb224', position: 70, uppercase: true, maxWords: 3, emoji: true, mode: 'original', translations: [] },
  look: { preset: 'none', bw: false, vignette: false, progressBar: false },
  audio: { voice: 1, fx: 0.5, music: null, voiceover: null },
  brand: { accent: '#ffb224', secondary: '#ffffff', font: 'Anton', logo: '', logoPos: 'top-right', logoSize: 12, watermark: '' },
  sfxBase: '/media/assets/sfx/',
};

export const Root: React.FC = () => (
  <Composition
    id="Short"
    component={Short as unknown as React.FC<Record<string, unknown>>}
    defaultProps={{ spec: EMPTY }}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={30}
    calculateMetadata={({ props }) => {
      const spec = (props as { spec: ShortSpec }).spec;
      return { fps: spec.fps, width: spec.width, height: spec.height, durationInFrames: shortDuration(spec) };
    }}
  />
);
