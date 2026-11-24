import { AddToFormat } from '../AddToFormat';
import { engineName } from '../../lib/breakdown';
import {
  clock,
  judgedBy,
  kindName,
  mixRows,
  stageProblem,
  type TeardownView,
} from '../../lib/teardown';
import { ReadyPrompt } from '../ReadyPrompt';
import {
  DataTable,
  Points,
  SubHeading,
  TeardownAdds,
  TeardownImage,
  TeardownSection,
} from './TeardownBits';

type Props = { readonly view: TeardownView; readonly videoId: string; readonly title: string };

/** 5. Chapters with their measured pace, the techniques with quotes, and the hammer lines. */
export function StorySection({ view }: { readonly view: TeardownView }) {
  const note =
    view.chapters.from === 'engine'
      ? "Chapters are the AI's reading; every number beside them is counted in code."
      : 'No chapters were named, so the video is cut evenly in code.';
  return (
    <TeardownSection
      id="td-story"
      title="5. Structure and storytelling"
      note={note}
      adds={
        <TeardownAdds
          videoId={view.videoId}
          measured={view.measured !== null}
          sections={[{ section: 'structure', label: 'Add structure' }]}
        />
      }
    >
      <DataTable
        label="Chapters"
        head={[
          '#',
          'Chapter',
          'Time',
          'Role',
          'Cuts/min',
          'Median shot',
          'Words/min',
          'Transitions',
          'Animations',
        ]}
        rows={view.chapters.items.map((row) => [
          row.index,
          row.title,
          `${clock(row.start)}–${clock(row.end)}`,
          row.role,
          row.cutsPerMinute,
          `${row.medianShotSeconds} s`,
          row.wordsPerMinute ?? '—',
          row.transitions,
          row.animations,
        ])}
      />
      <SubHeading>Techniques</SubHeading>
      {stageProblem(view, 'techniques') ? (
        <p className="text-body-sm text-outline">Not made: {stageProblem(view, 'techniques')}</p>
      ) : null}
      <Points
        items={view.techniques.map((item) => (
          <>
            <span className="font-semibold text-on-surface">{item.name}:</span> {item.description}
            {item.quotes.map((quote) => (
              <span key={`${quote.at}${quote.text}`} className="block text-body-sm">
                {clock(quote.at)} “{quote.text}”{' '}
                {quote.found
                  ? '(found in the transcript)'
                  : '(not found word for word in the transcript)'}
              </span>
            ))}
          </>
        ))}
      />
      <SubHeading>Hammer lines (2 to 5 words, found in code)</SubHeading>
      <Points
        items={(view.transcript.words?.hammers ?? []).map(
          (line) => `${clock(line.at)} “${line.text}”`,
        )}
      />
    </TeardownSection>
  );
}

/** 6. Motion and transitions: the measured mixes, then the vocabulary with its strips. */
export function MotionSection({ view, videoId }: Props) {
  const motion = view.measured?.motion;
  return (
    <TeardownSection
      id="td-motion"
      title="6. Motion and transitions"
      adds={
        <TeardownAdds
          videoId={videoId}
          measured={Boolean(motion)}
          sections={[{ section: 'transitions', label: 'Add transitions' }]}
        />
      }
      note={judgedBy(view, 'motion', engineName)}
      problem={
        motion ? stageProblem(view, 'motion') : 'its frames could not be gone through one by one.'
      }
    >
      {motion ? (
        <>
          <p className="text-body-md text-on-surface-variant">
            {motion.frames} frames at {motion.fps} fps gone through in code · {motion.holds.count}{' '}
            holds ({motion.holds.totalSeconds} s) · {motion.animations.length} on-screen animations
          </p>
          <div className="grid min-w-0 gap-space-md md:grid-cols-2">
            <DataTable
              label="Transition mix"
              head={['Transition', 'Count']}
              rows={mixRows(motion.transitionCounts).map((row) => [row.kind, row.count])}
            />
            <DataTable
              label="Camera mix"
              head={['Camera, per shot', 'Shots']}
              rows={mixRows(motion.cameraCounts).map((row) => [row.kind, row.count])}
            />
          </div>
          <p className="text-body-sm text-outline">Measured: {motion.method}</p>
        </>
      ) : null}
      <SubHeading>Animation and transition vocabulary</SubHeading>
      <ul className="grid min-w-0 gap-space-md lg:grid-cols-2">
        {view.animations.map((item, index) => (
          <li
            key={`${item.name}${index}`}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-subtle bg-surface-card p-space-md"
          >
            <p className="text-title-md font-semibold text-on-surface">{item.name}</p>
            {item.shown.map((strip) => (
              <TeardownImage
                key={strip.id}
                videoId={videoId}
                name={strip.file}
                caption={`${kindName(strip.kind)} at ${clock(strip.start)}: ${strip.frames} frames, ${strip.durationSeconds} s measured; every ${strip.step === 1 ? '' : `${strip.step}th `}frame shown`}
              />
            ))}
            {item.easing ? (
              <p className="text-body-sm text-on-surface-variant">Easing: {item.easing}</p>
            ) : null}
            <p className="text-body-sm text-on-surface-variant">
              <span className="font-semibold">Rebuild ({item.rebuild.method}):</span>{' '}
              {item.rebuild.recipe}
            </p>
            {view.measured !== null && (
              <AddToFormat source={{ kind: 'teardown', videoId, section: 'motion', index }} />
            )}
          </li>
        ))}
      </ul>
    </TeardownSection>
  );
}

/** 7. Sound: whether it was heard, then the blueprint. */
export function SoundSection({ view }: { readonly view: TeardownView }) {
  const sound = view.stages.sound;
  const watch = view.stages.watch;
  return (
    <TeardownSection
      id="td-sound"
      title="7. Sound design and mix"
      adds={
        <TeardownAdds
          videoId={view.videoId}
          measured={view.measured !== null}
          sections={[{ section: 'sound', label: 'Add sound' }]}
        />
      }
      note={judgedBy(view, 'sound', engineName)}
      problem={stageProblem(view, 'sound')}
    >
      <p className="text-body-md text-on-surface">
        {view.soundHeard
          ? 'The sound was heard by the engine that watched the video.'
          : 'No engine heard the sound: this rests on the measured loudness only.'}
      </p>
      {sound.state === 'done' ? (
        <Points
          items={[
            `Voice: ${sound.data.voice}`,
            `Music: ${sound.data.music}`,
            `Mix: ${sound.data.mix}`,
            ...sound.data.sfx.map(
              (item) =>
                `${item.cue} (${item.at.map(clock).join(', ') || 'no time'}): ${item.description}`,
            ),
          ]}
        />
      ) : null}
      {watch.state === 'done' && watch.data.sync.length > 0 ? (
        <>
          <SubHeading>Sound synced to motion (heard)</SubHeading>
          <Points
            items={watch.data.sync.map(
              (item) => `${clock(item.at)} ${item.motion} with ${item.sound}`,
            )}
          />
        </>
      ) : null}
    </TeardownSection>
  );
}

/** 8. How to make videos like it: the pipeline, components, steps, prompts and what not to copy. */
export function PlanSection({ view, title }: Props) {
  const plan = view.stages.plan;
  const loudness = view.measured?.loudness?.integratedLufs ?? null;
  return (
    <TeardownSection
      id="td-plan"
      title="8. How to replicate it"
      note={judgedBy(view, 'plan', engineName)}
      problem={stageProblem(view, 'plan')}
    >
      {loudness !== null ? (
        <p className="text-body-md text-on-surface">
          Mix target, measured from this video: {loudness} LUFS integrated.
        </p>
      ) : null}
      {plan.state === 'done' ? (
        <>
          <DataTable
            label="Pipeline"
            head={['Layer', 'Tool type', 'What it makes']}
            rows={plan.data.layers.map((layer) => [layer.layer, layer.toolType, layer.produces])}
          />
          <SubHeading>Components to build</SubHeading>
          <DataTable
            label="Components"
            head={['Component', 'Template', 'Build with']}
            rows={plan.data.components.map((item) => [item.name, item.archetype, item.buildWith])}
          />
          <SubHeading>Step by step</SubHeading>
          <ol className="flex min-w-0 list-decimal flex-col gap-1 pl-5 text-body-md text-on-surface-variant">
            {plan.data.workflow.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
          <ReadyPrompt
            label="script prompt"
            text={plan.data.prompts.script}
            fileTitle={`${title} - script prompt`}
          />
          {plan.data.prompts.visuals.map((item) => (
            <ReadyPrompt
              key={item.archetype}
              label={`visual prompt: ${item.archetype}`}
              text={item.prompt}
              fileTitle={`${title} - ${item.archetype}`}
            />
          ))}
          <ReadyPrompt
            label="thumbnail prompt"
            text={plan.data.prompts.thumbnail}
            fileTitle={`${title} - thumbnail prompt`}
          />
          <SubHeading>What not to copy</SubHeading>
          <Points items={plan.data.avoid} />
        </>
      ) : null}
    </TeardownSection>
  );
}
