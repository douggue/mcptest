import type { TeardownMeasurements, TeardownStage } from '@jgtube/core';

/** A valid answer for every stage, as an engine would give it. */
export const STAGE_ANSWERS: Readonly<Record<TeardownStage, unknown>> = {
  structure: {
    format: 'A dark explainer',
    summary: 'Hook, build, payoff.',
    chapters: [
      { title: 'Hook', role: 'hook', summary: 'Opens cold', start: 0, end: 20 },
      { title: 'Build', role: 'build', summary: 'The middle', start: 20, end: 60 },
    ],
  },
  watch: {
    voice: 'Calm narrator',
    chapters: [{ start: 0, end: 20, sound: 'Low drone and ticks', visuals: 'Dark grid' }],
    hook: [{ start: 0, end: 3, sound: 'Sub drop' }],
    sync: [{ at: 2, motion: 'Text decodes', sound: 'Ticks' }],
    transcript: [{ at: 1, text: 'This is how it starts.' }],
  },
  hook: {
    summary: 'A cold open.',
    rows: [{ start: 0, end: 3, visual: 'A plane', onScreenText: 'BOXCAR' }],
  },
  design: {
    colourModes: [{ name: 'Void', hexes: ['#0A0B0E'], use: 'Most scenes' }],
    typography: [{ role: 'Titles', style: 'Geometric sans' }],
    motion: [{ name: 'Scramble', description: 'Letters lock in', at: [2] }],
  },
  archetypes: {
    items: [{ name: 'Grid', description: 'A grid', keyframe: 'k-001', at: [2], buildWith: 'code' }],
  },
  motion: {
    items: [
      {
        name: 'Text decode',
        kind: 'text',
        strips: ['s-001'],
        at: [2],
        easing: 'ease-out',
        rebuild: { method: 'code', recipe: 'Swap glyphs for 12 frames, left to right.' },
      },
    ],
  },
  techniques: {
    items: [
      { name: 'Hammer', description: 'Short line', quotes: [{ text: 'how it starts', at: 1 }] },
    ],
  },
  sound: { voice: 'Close mic', music: 'Pulse', sfx: [], mix: 'Voice on top' },
  plan: {
    layers: [{ layer: 'Graphics', toolType: 'code-animated motion graphics', produces: 'HUD' }],
    components: [{ name: 'Grid', archetype: 'Grid', buildWith: 'code' }],
    workflow: ['Write the script'],
    prompts: {
      script: 'Write about [TOPIC]',
      visuals: [],
      thumbnail: 'A [SUBJECT] with [OVERLAY TEXT]',
    },
    avoid: ['Their logo'],
  },
};

export const MEASURED: TeardownMeasurements = {
  version: 1,
  measuredAt: '2026-11-22T10:00:00.000Z',
  video: {
    durationSeconds: 60,
    width: 1280,
    height: 720,
    fps: 25,
    hasAudio: true,
    method: 'ffprobe',
  },
  shots: {
    threshold: 0.3,
    cuts: [10, 30],
    cutCount: 2,
    shotCount: 3,
    medianSeconds: 20,
    averageSeconds: 20,
    cutsPerMinute: 2,
    method: 'scene',
  },
  loudness: { integratedLufs: -16, lraLu: 4, truePeakDbfs: -1, method: 'ebur128' },
  quietDips: { thresholdDb: -32, minSeconds: 0.4, items: [], method: 'silencedetect' },
  peaks: { thresholdDb: -12, windowSeconds: 0.5, items: [], method: 'astats' },
  palette: { items: [{ hex: '#0A0B0E', share: 0.9 }], method: 'k-means' },
  keyframes: [
    { id: 'k-001', at: 5, shot: 0, covers: 10, file: 'k-001.jpg' },
    { id: 'k-002', at: 45, shot: 2, covers: 30, file: 'k-002.jpg' },
  ],
  hookSheet: {
    file: 'hook.jpg',
    fromSeconds: 0,
    toSeconds: 36,
    columns: 6,
    rows: 6,
    method: 'sheet',
  },
  motion: {
    method: 'every frame',
    fps: 25,
    frames: 1500,
    transitions: [],
    transitionCounts: { cut: 2, dissolve: 0, 'fade-black': 0, 'fade-white': 0, flash: 0, whip: 0 },
    holds: { count: 0, totalSeconds: 0 },
    animations: [],
    shots: [],
    cameraCounts: {
      static: 3,
      'push-in': 0,
      'pull-out': 0,
      'pan-left': 0,
      'pan-right': 0,
      'tilt-up': 0,
      'tilt-down': 0,
      shake: 0,
    },
    strips: [
      {
        id: 's-001',
        kind: 'animation',
        file: 's-001.jpg',
        start: 2,
        end: 2.5,
        startFrame: 50,
        endFrame: 62,
        frames: 13,
        fromFrame: 50,
        step: 2,
        shownFrames: 10,
        durationSeconds: 0.5,
      },
    ],
  },
  problems: [],
};
