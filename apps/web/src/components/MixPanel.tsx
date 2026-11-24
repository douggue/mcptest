import { Sparkles } from 'lucide-react';
import { AUTOMATIC } from '../lib/analyses';
import { applySuggestion, writtenBy, type FormatView } from '../lib/formatBuilder';
import type { AiChoice } from './AiEngines';
import { AiLine } from './AiLine';
import { Details } from './layout/Details';
import { Notice } from './layout/Notice';
import { PanelAction } from './layout/PanelAction';
import type { FormatBuilder } from './useFormatBuilder';

const SMALL =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1 text-body-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-highest';

/** The last suggested mix: the AI's reading of it, what was left out, and "Use the whole mix". */
function LastMix({
  format,
  builder,
}: {
  readonly format: FormatView;
  readonly builder: FormatBuilder;
}) {
  const { suggestion } = format;
  if (suggestion === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <p className="text-body-sm text-outline">
        AI’s reading, by {writtenBy(suggestion.engine)} · {suggestion.slots.length} slots suggested
      </p>
      {suggestion.summary !== '' && (
        <p className="break-words text-body-md text-on-surface-variant">{suggestion.summary}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void builder.change({ slots: applySuggestion(format.slots, suggestion) })}
          className={SMALL}
        >
          Use the whole mix
        </button>
      </div>
      {suggestion.dropped.length > 0 && (
        <Details summary={`Left out by the checks (${suggestion.dropped.length})`}>
          <ul className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
            {suggestion.dropped.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </Details>
      )}
    </div>
  );
}

interface Props {
  readonly format: FormatView;
  readonly builder: FormatBuilder;
  readonly shelfSize: number;
  readonly channelId: string | null;
  readonly ai?: AiChoice;
}

/** "Suggest a mix": an AI reads the shelf and the map's winners and fills every slot it can. */
export function MixPanel({ format, builder, shelfSize, channelId, ai }: Props) {
  const { mix, bible } = builder;
  const running = mix.status === 'running';
  const engine = ai === undefined || ai.choice === AUTOMATIC ? null : ai.choice;
  const blocked =
    shelfSize === 0
      ? 'Put a few ingredients on the shelf first.'
      : (ai?.busy || bible.status === 'running') && !running
        ? 'Another AI run is under way.'
        : null;
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      {ai && <AiLine choice={ai.choice} engines={ai.engines} />}
      <PanelAction
        icon={Sparkles}
        onClick={() => builder.suggest(channelId, engine)}
        disabled={running}
        blocked={blocked}
        quiet={format.suggestion !== null}
        note={
          channelId === null
            ? 'Reads your shelf. Open a map to have it read the map’s winners too.'
            : 'Reads your shelf and the winners on your map. Takes a minute or two.'
        }
      >
        {format.suggestion === null ? 'Suggest a mix' : 'Suggest a new mix'}
      </PanelAction>
      {running && <Notice tone="working">{mix.text ?? 'Starting the AI'}</Notice>}
      {mix.status === 'failed' && <Notice tone="problem">{mix.message}</Notice>}
      <LastMix format={format} builder={builder} />
    </div>
  );
}
