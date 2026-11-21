import { Quote } from 'lucide-react';
import { useState } from 'react';
import {
  filterHooks,
  hookStyles,
  libraryState,
  type LibraryHook,
  type LibraryState,
} from '../lib/hookLibrary';
import { HookCard } from './HookCard';
import { HookFilters } from './HookFilters';
import { Details } from './layout/Details';
import { ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { LabStatus, NOTE, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import type { Lab } from './useLab';

interface Models {
  readonly chosen: readonly string[];
  readonly toggle: (videoId: string) => void;
}

interface Props {
  readonly lab: Lab;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  readonly centerTitle: string;
  /** The hooks chosen as models for the open script, and the way to choose; absent when none is open. */
  readonly models?: Models | undefined;
}

interface StateProps {
  readonly lab: Lab;
  readonly busy: boolean;
  readonly state: LibraryState;
}

/** Building the library and naming its styles: the one needed next is the primary one. */
function Actions({ lab, busy, state }: StateProps) {
  const running = lab.jobs.state.status === 'running';
  // Only the step needed next is primary; naming the styles again is a quiet choice.
  const nameFirst = state.toRead === 0 && state.unnamed > 0;
  const again = state.unnamed === 0 && state.withWords > 0;
  return (
    <>
      {state.toRead > 0 && (
        <button
          type="button"
          disabled={running}
          onClick={lab.buildHooks}
          className={PRIMARY_BUTTON}
        >
          {state.built ? 'Read the missing captions' : 'Build the hook library'}
        </button>
      )}
      {state.withWords > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={lab.nameHooks}
          className={nameFirst ? PRIMARY_BUTTON : QUIET_BUTTON}
        >
          {again ? 'Name the styles again' : 'Name the styles'}
        </button>
      )}
      {(running || busy) && (
        <span className="text-body-sm text-outline">Waits for the AI run under way.</span>
      )}
    </>
  );
}

function HowItWorks({ seconds, toRead }: { readonly seconds: number; readonly toRead: number }) {
  return (
    <Details summary="How this works">
      <div className="flex max-w-3xl flex-col gap-2 text-body-sm text-on-surface-variant">
        <p>
          The first {seconds} seconds of each video are taken from its captions: no AI writes them.
          Use a hook as a model for a way of opening, never as text to reuse.
        </p>
        <p>
          {toRead > 0
            ? `Building reads the captions of ${toRead} videos from YouTube, a request or two each. `
            : ''}
          Naming the styles is an AI run of a minute or two.
        </p>
      </div>
    </Details>
  );
}

interface EmptyProps {
  readonly total: number;
  readonly state: LibraryState;
  readonly shown: number;
}

/** Said in the place of the cards when there are none to show. */
function Empty({ total, state, shown }: EmptyProps) {
  if (total > 0 && !state.built && state.toRead > 0) {
    return (
      <p className={NOTE}>
        The library has not been built yet. It will hold the openings of the {total} strongest
        breakout videos on this map.
      </p>
    );
  }
  if (state.built && shown === 0) return <p className={NOTE}>No hook matches that.</p>;
  return null;
}

interface GridProps {
  readonly lab: Lab;
  readonly hooks: readonly LibraryHook[];
  readonly seconds: number;
  readonly models: Models | undefined;
}

/** The hooks as roomy cards, two to a row on a wide screen. */
function HookGrid({ lab, hooks, seconds, models }: GridProps) {
  return (
    <ul className="grid grid-cols-1 gap-space-md xl:grid-cols-2">
      {hooks.map((hook) => (
        <li key={hook.videoId} className="min-w-0">
          <HookCard
            hook={hook}
            seconds={seconds}
            picked={lab.picks.some((pick) => pick.videoId === hook.videoId)}
            onUse={() =>
              lab.pick({
                videoId: hook.videoId,
                title: hook.title,
                channelTitle: hook.channelTitle,
                modelOpening: true,
                from: 'hook',
              })
            }
            onModel={models ? () => models.toggle(hook.videoId) : undefined}
            modelled={models?.chosen.includes(hook.videoId)}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * How the top breakout videos on this map open: the first minute of what
 * each says, in its own words from its captions. The only part an AI adds is
 * a name for the way of opening, and the filters are the names that came back.
 */
export function HookLibrary({ lab, busy, centerTitle, models }: Props) {
  const [query, setQuery] = useState('');
  const [style, setStyle] = useState<string | null>(null);
  const hooks = lab.library?.hooks ?? [];
  const state = libraryState(hooks);
  const styles = hookStyles(hooks);
  const chosenStyle = styles.some((entry) => entry.style === style) ? style : null;
  const shown = filterHooks(hooks, query, chosenStyle);
  const seconds = lab.library?.seconds ?? 60;
  return (
    <ViewPage id="hook-library" labelledBy="hook-library-title">
      <ViewHeader
        titleId="hook-library-title"
        title="Hook library"
        icon={Quote}
        count={state.withWords > 0 ? state.withWords : undefined}
        lead={<>How the top breakout videos around {centerTitle} open, word for word.</>}
        actions={<Actions lab={lab} busy={busy} state={state} />}
      />
      <HowItWorks seconds={seconds} toRead={state.toRead} />
      <LabStatus
        state={lab.jobs.state}
        kinds={['hooks-build', 'hooks-label']}
        working="Working on the hook library"
        takes="Keep this page open."
      />
      {state.built && (
        <HookFilters
          query={query}
          onQuery={setQuery}
          styles={[{ style: null, count: hooks.length }, ...styles]}
          chosen={chosenStyle}
          onChoose={setStyle}
        />
      )}
      {lab.library !== null && hooks.length === 0 && (
        <p className={NOTE}>This map has no breakout video to take an opening from yet.</p>
      )}
      <Empty total={hooks.length} state={state} shown={shown.length} />
      {(state.built || state.toRead === 0) && shown.length > 0 && (
        <HookGrid lab={lab} hooks={shown} seconds={seconds} models={models} />
      )}
    </ViewPage>
  );
}
