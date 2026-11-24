import { AddToFormat } from '../AddToFormat';
import { engineName } from '../../lib/breakdown';
import {
  clock,
  judgedBy,
  metricRows,
  percent,
  stageProblem,
  type TeardownView,
} from '../../lib/teardown';
import {
  DataTable,
  Points,
  SubHeading,
  TeardownAdds,
  TeardownImage,
  TeardownSection,
} from './TeardownBits';

type Props = { readonly view: TeardownView };

/** 1. The measured numbers, each with its method. */
export function MetricsSection({ view }: Props) {
  const rows = metricRows(view);
  const structure = view.stages.structure;
  return (
    <TeardownSection
      id="td-metrics"
      title="1. Core style and measured numbers"
      adds={
        <TeardownAdds
          videoId={view.videoId}
          measured={view.measured !== null}
          sections={[{ section: 'metrics', label: 'Add pacing to format' }]}
        />
      }
      problem={view.measured === null ? view.measuredProblem : null}
    >
      {structure.state === 'done' ? (
        <p className="text-body-lg text-on-surface">
          <span className="font-semibold">Format (the AI&apos;s reading):</span>{' '}
          {structure.data.format}
        </p>
      ) : null}
      <DataTable
        label="Measured numbers"
        head={['Measure', 'Value', 'How it was measured']}
        rows={rows.map((row) => [
          row.label,
          row.value,
          <span className="text-outline">{row.method}</span>,
        ])}
      />
      {view.measured && view.measured.problems.length > 0 ? (
        <p className="text-body-sm text-outline">
          Not measured: {view.measured.problems.join(' ')}
        </p>
      ) : null}
    </TeardownSection>
  );
}

/** 2. The palette as swatches, then the colour modes, type and motion signatures. */
export function DesignSection({ view }: Props) {
  const palette = view.measured?.palette;
  const design = view.stages.design;
  return (
    <TeardownSection
      id="td-design"
      title="2. Visual design system"
      adds={
        <TeardownAdds
          videoId={view.videoId}
          measured={view.measured !== null}
          sections={[
            { section: 'palette', label: 'Add palette' },
            ...(design.state === 'done'
              ? [{ section: 'typography', label: 'Add typography' }]
              : []),
          ]}
        />
      }
      note={judgedBy(view, 'design', engineName)}
      problem={stageProblem(view, 'design')}
    >
      {palette ? (
        <>
          <SubHeading>Measured palette</SubHeading>
          <ul
            className="grid min-w-0 grid-cols-2 gap-space-sm sm:grid-cols-4"
            aria-label="Measured palette"
          >
            {palette.items.map((colour) => (
              <li key={colour.hex} className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-10 w-10 flex-none rounded border border-border-subtle"
                  style={{ backgroundColor: colour.hex }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-body-sm text-on-surface">{colour.hex}</span>
                  <span className="text-body-sm text-outline">
                    {percent(colour.share)} of runtime
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-body-sm text-outline">Measured: {palette.method}.</p>
        </>
      ) : null}
      <SubHeading>Colour modes</SubHeading>
      <Points
        items={view.colourModes.map((mode) => (
          <>
            <span className="font-semibold text-on-surface">{mode.name}</span> (
            {mode.hexes.join(', ') || 'no measured colour'}): {mode.use}
          </>
        ))}
      />
      <SubHeading>Typography</SubHeading>
      <Points
        items={
          design.state === 'done'
            ? design.data.typography.map(
                (item) =>
                  `${item.role}: ${item.style}${item.casing ? `, ${item.casing}` : ''}${item.examples.length ? ` (“${item.examples.join('”, “')}”)` : ''}`,
              )
            : []
        }
      />
      <SubHeading>Motion signatures</SubHeading>
      <Points
        items={
          design.state === 'done'
            ? design.data.motion.map(
                (item) =>
                  `${item.name} (${item.at.map(clock).join(', ') || 'no time'}): ${item.description}`,
              )
            : []
        }
      />
    </TeardownSection>
  );
}

/** 3. The component library, each card with its keyframe. */
export function ComponentsSection({ view, videoId }: Props & { readonly videoId: string }) {
  return (
    <TeardownSection
      id="td-components"
      title="3. Component library"
      note={judgedBy(view, 'archetypes', engineName)}
      problem={stageProblem(view, 'archetypes')}
    >
      <ul className="grid min-w-0 gap-space-md sm:grid-cols-2 xl:grid-cols-3">
        {view.archetypes.map((item, index) => (
          <li
            key={`${item.name}${index}`}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-subtle bg-surface-card p-space-md"
          >
            {item.image ? (
              <TeardownImage
                videoId={videoId}
                name={item.image}
                caption={`${item.keyframe ?? ''} at ${item.at.map(clock).join(', ') || '?'}`}
              />
            ) : null}
            <p className="text-title-md font-semibold text-on-surface">
              {String(index + 1).padStart(2, '0')}: {item.name}
            </p>
            <p className="text-body-sm text-on-surface-variant">{item.description}</p>
            <p className="text-body-sm text-outline">Build with: {item.buildWith}</p>
            {view.measured !== null && (
              <AddToFormat source={{ kind: 'teardown', videoId, section: 'component', index }} />
            )}
          </li>
        ))}
      </ul>
    </TeardownSection>
  );
}

/** 4. The opening, frame by frame: the sheet and the table. */
export function HookSection({ view, videoId }: Props & { readonly videoId: string }) {
  const sheet = view.measured?.hookSheet;
  const hook = view.stages.hook;
  return (
    <TeardownSection
      id="td-hook"
      adds={
        <TeardownAdds
          videoId={videoId}
          measured={view.measured !== null}
          sections={[{ section: 'hook', label: 'Add hook beats' }]}
        />
      }
      title="4. The hook, frame by frame"
      note={judgedBy(view, 'hook', engineName)}
      problem={stageProblem(view, 'hook')}
    >
      {sheet ? (
        <TeardownImage
          videoId={videoId}
          name={sheet.file}
          caption={`${clock(sheet.fromSeconds)}–${clock(sheet.toSeconds)}, one frame a second, left to right`}
        />
      ) : null}
      {hook.state === 'done' ? (
        <p className="text-body-lg text-on-surface">{hook.data.summary}</p>
      ) : null}
      <DataTable
        label="The hook beat by beat"
        head={['Time', 'Visual and camera', 'On-screen text', 'Narration (transcript)', 'Sound']}
        rows={view.hookRows.map((row) => [
          `${clock(row.start)}–${clock(row.end)}`,
          `${row.visual}${row.camera ? ` (${row.camera})` : ''}`,
          row.onScreenText || '—',
          row.narration ? `“${row.narration}”` : '—',
          row.sound ? `${row.sound} (${row.soundFrom})` : 'Not heard',
        ])}
      />
    </TeardownSection>
  );
}
