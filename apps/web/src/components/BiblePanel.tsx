import { BookOpen, Download } from 'lucide-react';
import { AUTOMATIC } from '../lib/analyses';
import { bibleUrl, filledCount, writtenBy, type FormatView } from '../lib/formatBuilder';
import type { AiChoice } from './AiEngines';
import { Details } from './layout/Details';
import { Notice } from './layout/Notice';
import { PanelAction } from './layout/PanelAction';
import type { FormatBuilder } from './useFormatBuilder';

const LINK =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-highest';
const PREVIEW_RULES = 6;

/** The measured palette as swatches, each with its code and share of the runtime. */
function Palette({ format }: { readonly format: FormatView }) {
  const palette = format.bible?.facts.palette ?? [];
  if (palette.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-label text-outline">Palette, measured</p>
      <ul className="flex min-w-0 flex-wrap gap-2" aria-label="Measured palette">
        {palette.map((colour) => (
          <li
            key={colour.hex}
            className="flex items-center gap-1.5 text-body-sm text-on-surface-variant"
          >
            <span
              aria-hidden="true"
              className="h-5 w-5 flex-none rounded border border-border-subtle"
              style={{ backgroundColor: colour.hex }}
            />
            {colour.hex} · {Math.round(colour.share * 100)}%
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The kept Bible: who wrote it, the measured palette, its rules and the downloads. */
function Written({ format }: { readonly format: FormatView }) {
  const { bible } = format;
  if (bible === null) return null;
  const rules = bible.written.coreRules;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <p className="text-body-sm text-outline">
        AI’s reading, by {writtenBy(bible.engine)} · written {bible.writtenAt.slice(0, 10)} from{' '}
        {bible.facts.slots.length} slots · numbers in its tables measured in code
      </p>
      <Palette format={format} />
      <Details summary={`Core rules (${rules.length})`}>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm text-on-surface-variant">
          {rules.slice(0, PREVIEW_RULES).map((rule) => (
            <li key={rule} className="break-words">
              {rule}
            </li>
          ))}
        </ul>
      </Details>
      {bible.unbacked.length > 0 && (
        <p className="break-words text-body-sm text-metric-amber">
          {bible.unbacked.length} number{bible.unbacked.length === 1 ? '' : 's'} in the AI’s text
          {bible.unbacked.length === 1 ? ' is' : ' are'} not from a measurement; the Bible lists
          them at its end.
        </p>
      )}
      {bible.dropped.length > 0 && (
        <Details summary={`Shortened or left out by the checks (${bible.dropped.length})`}>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm text-on-surface-variant">
            {bible.dropped.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </Details>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={bibleUrl(format.id, 'md')} download className={LINK}>
          <Download aria-hidden="true" className="h-4 w-4" />
          Bible (.md)
        </a>
        <a href={bibleUrl(format.id, 'zip')} download className={LINK}>
          <Download aria-hidden="true" className="h-4 w-4" />
          Everything (.zip)
        </a>
      </div>
    </div>
  );
}

interface Props {
  readonly format: FormatView;
  readonly builder: FormatBuilder;
  readonly channelId: string | null;
  readonly ai?: AiChoice;
}

/** "Write my Format Bible": an AI writes the format's production bible from its filled slots. */
export function BiblePanel({ format, builder, channelId, ai }: Props) {
  const { bible: run, mix } = builder;
  const running = run.status === 'running';
  const engine = ai === undefined || ai.choice === AUTOMATIC ? null : ai.choice;
  const blocked =
    filledCount(format.slots) === 0
      ? 'Fill a few slots first.'
      : (ai?.busy || mix.status === 'running') && !running
        ? 'Another AI run is under way.'
        : null;
  return (
    <section aria-labelledby="format-bible-title" className="flex min-w-0 flex-col gap-space-sm">
      <h3 id="format-bible-title" className="text-title-md text-on-surface">
        Format Bible
      </h3>
      <PanelAction
        icon={BookOpen}
        onClick={() => builder.writeBible(channelId, engine)}
        disabled={running}
        blocked={blocked}
        quiet={format.bible !== null}
        note="Written from your filled slots; every number in it was measured in code. Takes a few minutes."
      >
        {format.bible === null ? 'Write my Format Bible' : 'Write it again'}
      </PanelAction>
      {running && <Notice tone="working">{run.text ?? 'Starting the AI'}</Notice>}
      {run.status === 'failed' && <Notice tone="problem">{run.message}</Notice>}
      <Written format={format} />
    </section>
  );
}
