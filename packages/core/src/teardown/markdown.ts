import type { TeardownReport } from './report';

/**
 * The teardown as one Markdown file, laid out as a production teardown and
 * style bible: measured numbers in tables with their method, the AI's reading
 * marked as such with its evidence, pictures linked relative to the file so
 * the exported folder opens anywhere.
 */

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
const cell = (text: string | number | null | undefined): string =>
  String(text ?? '—')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim() || '—';
const table = (
  head: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string =>
  rows.length === 0
    ? '_Nothing to show._'
    : [
        `| ${head.join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n');
const percent = (share: number): string => `${Math.round(share * 1000) / 10}%`;
const fenced = (text: string): string => ['```text', text.replace(/```/g, "'''"), '```'].join('\n');
const times = (values: readonly number[]): string => values.map(clock).join(', ');

type Report = TeardownReport;

function judgedNote(report: Report, stage: keyof Report['stages']): string {
  const state = report.stages[stage];
  return state.state === 'done'
    ? `_AI's reading (${state.engine})._`
    : `_Not made: ${state.reason}_`;
}

function metrics(report: Report, image: (file: string) => string): string {
  const m = report.measured;
  if (m === null) return `_Nothing was measured: ${report.measuredProblem ?? 'no file'}_`;
  const words = report.transcript.words;
  const rows: (string | number | null)[][] = [
    ['Runtime', `${clock(m.video.durationSeconds)} (${m.video.durationSeconds} s)`, m.video.method],
    [
      'Picture',
      `${m.video.width ?? '?'}×${m.video.height ?? '?'}, ${m.video.fps ?? '?'} fps`,
      m.video.method,
    ],
    [
      'Shot pacing',
      `${m.shots.cutCount} cuts, median shot ${m.shots.medianSeconds} s, average ${m.shots.averageSeconds} s, ${m.shots.cutsPerMinute} cuts/min`,
      m.shots.method,
    ],
  ];
  if (words) {
    rows.push([
      'Words',
      `${words.wordCount} words, ${words.wordsPerMinute} WPM, median sentence ${words.medianSentenceWords} words`,
      `counted in code from the ${report.transcript.source === 'heard' ? 'words an engine heard' : 'captions'}`,
    ]);
  }
  if (m.loudness) {
    rows.push([
      'Loudness (EBU R128)',
      `${m.loudness.integratedLufs ?? '?'} LUFS integrated, ${m.loudness.lraLu ?? '?'} LU range, ${m.loudness.truePeakDbfs ?? '?'} dBFS true peak`,
      m.loudness.method,
    ]);
  }
  if (m.quietDips) rows.push(['Quiet dips', `${m.quietDips.items.length}`, m.quietDips.method]);
  if (m.peaks) rows.push(['Peak impacts', `${m.peaks.items.length}`, m.peaks.method]);
  const format =
    report.stages.structure.state === 'done'
      ? `**Format (AI's reading):** ${report.stages.structure.data.format}\n\n`
      : '';
  const problems = m.problems.length === 0 ? '' : `\n\nNot measured: ${m.problems.join(' ')}`;
  return `${format}${table(['Metric', 'Measured value', 'Method'], rows)}${problems}${image('')}`;
}

function design(report: Report): string {
  const m = report.measured;
  const palette = m
    ? `${table(
        ['Colour', 'Share of runtime'],
        m.palette.items.map((colour) => [`\`${colour.hex}\``, percent(colour.share)]),
      )}\n\n_Measured: ${m.palette.method}._`
    : '_No palette measured._';
  const modes = report.colourModes.map(
    (mode) =>
      `- **${mode.name}** (${mode.hexes.map((hex) => `\`${hex}\``).join(', ') || 'no measured colour'}): ${mode.use}${mode.unmeasured.length > 0 ? ` _(named but not measured, left out: ${mode.unmeasured.join(', ')})_` : ''}`,
  );
  const design = report.stages.design;
  const type =
    design.state === 'done'
      ? design.data.typography.map(
          (item) =>
            `- **${item.role}:** ${item.style}${item.casing ? `, ${item.casing}` : ''}${item.examples.length ? ` — e.g. ${item.examples.map((e) => `“${e}”`).join(', ')}` : ''}`,
        )
      : [];
  const motion =
    design.state === 'done'
      ? design.data.motion.map(
          (item) => `- **${item.name}** (${times(item.at)}): ${item.description}`,
        )
      : [];
  return [
    '### Measured palette',
    palette,
    '### Colour modes',
    judgedNote(report, 'design'),
    modes.join('\n') || '_None named._',
    '### Typography',
    type.join('\n') || '_None named._',
    '### Motion signatures',
    motion.join('\n') || '_None named._',
  ].join('\n\n');
}

function components(report: Report, image: (file: string) => string): string {
  const items = report.archetypes.map((item, index) =>
    [
      `### ${String(index + 1).padStart(2, '0')}: ${item.name} (${times(item.at)})`,
      item.image ? image(item.image) : '_No keyframe._',
      `${item.description} — **build with:** ${item.buildWith}`,
    ].join('\n\n'),
  );
  return [judgedNote(report, 'archetypes'), ...items].join('\n\n');
}

function hook(report: Report, image: (file: string) => string): string {
  const sheet = report.measured?.hookSheet;
  const rows = report.hookRows.map((row) => [
    `${clock(row.start)}–${clock(row.end)}`,
    `${row.visual}${row.camera ? ` (${row.camera})` : ''}`,
    row.onScreenText,
    row.narration ? `“${row.narration}”` : '',
    row.sound ? `${row.sound} _(${row.soundFrom})_` : 'not heard',
  ]);
  return [
    sheet ? image(sheet.file) : '',
    sheet ? `_${sheet.method}._` : '',
    judgedNote(report, 'hook'),
    report.stages.hook.state === 'done' ? report.stages.hook.data.summary : '',
    table(['Time', 'Visual & camera', 'On-screen text', 'Narration (transcript)', 'Sound'], rows),
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

function story(report: Report): string {
  const chapters = table(
    [
      '#',
      'Chapter',
      'Time',
      'Role',
      'Cuts/min',
      'Median shot',
      'WPM',
      'Transitions',
      'Animations',
      'Motion',
    ],
    report.chapters.items.map((row) => [
      row.index,
      row.title,
      `${clock(row.start)}–${clock(row.end)}`,
      row.role,
      row.cutsPerMinute,
      `${row.medianShotSeconds} s`,
      row.wordsPerMinute,
      row.transitions,
      row.animations,
      row.motionIntensity === null ? null : `${row.motionIntensity}%`,
    ]),
  );
  const from =
    report.chapters.from === 'engine'
      ? "_Chapters: AI's reading; every number in the table counted in code._"
      : '_No chapters were named, so the video is cut evenly in code._';
  const techniques = report.techniques.map((item) =>
    [
      `- **${item.name}:** ${item.description}`,
      ...item.quotes.map(
        (quote) =>
          `  - ${clock(quote.at)} “${quote.text}” ${quote.found ? '_(found in the transcript)_' : '_(not found word for word in the transcript)_'}`,
      ),
    ].join('\n'),
  );
  const hammers =
    report.transcript.words?.hammers.map((line) => `- ${clock(line.at)} “${line.text}”`) ?? [];
  return [
    from,
    chapters,
    '### Techniques',
    judgedNote(report, 'techniques'),
    techniques.join('\n') || '_None named._',
    '### Hammer lines (2–5 words, found in code)',
    hammers.join('\n') || '_None found._',
  ].join('\n\n');
}

function motionSection(report: Report, image: (file: string) => string): string {
  const motion = report.measured?.motion;
  if (!motion) return '_The frames could not be gone through one by one._';
  const mix = table(
    ['Transition', 'Count'],
    Object.entries(motion.transitionCounts).map(([kind, count]) => [kind, count]),
  );
  const camera = table(
    ['Camera (per shot)', 'Shots'],
    Object.entries(motion.cameraCounts).map(([kind, count]) => [kind, count]),
  );
  const vocabulary = report.animations.map((item) =>
    [
      `### ${item.name} (${item.kind})`,
      ...item.shown.map(
        (strip) =>
          `${image(strip.file)}\n\n_${clock(strip.start)}, ${strip.frames} frames, ${strip.durationSeconds} s measured; strip shows every ${strip.step === 1 ? '' : `${strip.step}th `}frame._`,
      ),
      `${item.easing ? `**Easing:** ${item.easing}. ` : ''}**Rebuild (${item.rebuild.method}):** ${item.rebuild.recipe}`,
    ].join('\n\n'),
  );
  return [
    `_Measured: ${motion.method}_`,
    `${motion.frames} frames at ${motion.fps} fps gone through; ${motion.holds.count} holds (${motion.holds.totalSeconds} s); ${motion.animations.length} on-screen animations.`,
    mix,
    camera,
    '### Animation and transition vocabulary',
    judgedNote(report, 'motion'),
    ...vocabulary,
  ].join('\n\n');
}

function sound(report: Report): string {
  const state = report.stages.sound;
  const heard = report.soundHeard
    ? '_The sound was heard by the engine that watched the video._'
    : '_The sound was not heard by any engine: what follows rests on the measured loudness only._';
  const sync =
    report.stages.watch.state === 'done'
      ? report.stages.watch.data.sync.map(
          (item) => `- ${clock(item.at)} ${item.motion} ↔ ${item.sound}`,
        )
      : [];
  if (state.state !== 'done') return `${heard}\n\n_Not made: ${state.reason}_`;
  return [
    heard,
    judgedNote(report, 'sound'),
    `- **Voice:** ${state.data.voice}`,
    `- **Music:** ${state.data.music}`,
    `- **Mix:** ${state.data.mix}`,
    ...state.data.sfx.map((item) => `- **${item.cue}** (${times(item.at)}): ${item.description}`),
    sync.length > 0 ? `### Sound synced to motion (heard)\n\n${sync.join('\n')}` : '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

function plan(report: Report): string {
  const state = report.stages.plan;
  if (state.state !== 'done') return `_Not made: ${state.reason}_`;
  const loudness = report.measured?.loudness?.integratedLufs;
  const data = state.data;
  return [
    judgedNote(report, 'plan'),
    loudness === null || loudness === undefined
      ? ''
      : `**Mix target (measured from this video):** ${loudness} LUFS integrated.`,
    table(
      ['Layer', 'Tool type', 'What it produces'],
      data.layers.map((layer) => [layer.layer, layer.toolType, layer.produces]),
    ),
    '### Components to build',
    table(
      ['Component', 'Archetype', 'Build with'],
      data.components.map((item) => [item.name, item.archetype, item.buildWith]),
    ),
    '### Workflow',
    data.workflow.map((step, index) => `${index + 1}. ${step}`).join('\n'),
    '### Script prompt',
    fenced(data.prompts.script),
    ...data.prompts.visuals.flatMap((item) => [
      `### Visual prompt: ${item.archetype}`,
      fenced(item.prompt),
    ]),
    '### Thumbnail prompt',
    fenced(data.prompts.thumbnail),
    '### What not to copy',
    data.avoid.map((line) => `- ${line}`).join('\n'),
  ]
    .filter((part) => part !== '')
    .join('\n\n');
}

/** The whole teardown as Markdown; pictures are linked under `imageFolder`. */
export function teardownMarkdown(report: Report, imageFolder = 'images'): string {
  const image = (file: string): string =>
    file === '' ? '' : `\n\n![${file}](${imageFolder}/${file})`;
  const title = report.about?.title ?? `Video ${report.videoId}`;
  return [
    `# Production teardown & style bible: ${title}`,
    `> Numbers come from code, each with its method. Everything else is an AI's reading, marked as such, with the times and quotes it rests on.${report.about?.seen.length ? `\n> ${report.about.seen.join(' ')}` : ''}`,
    '## 1. Core style DNA & measured metrics',
    metrics(report, () => ''),
    '## 2. Visual design system',
    design(report),
    '## 3. Component library',
    components(report, image),
    '## 4. Hook, frame by frame',
    hook(report, image),
    '## 5. Structure, storytelling & rhetoric',
    story(report),
    '## 6. Motion & transitions',
    motionSection(report, image),
    '## 7. Sound design & mix',
    sound(report),
    '## 8. How to replicate it',
    plan(report),
    '',
  ].join('\n\n');
}
