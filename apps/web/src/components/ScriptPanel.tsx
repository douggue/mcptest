import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { thumbnailFor } from '../lib/ideaLab';
import { viewHref } from '../lib/routes';
import {
  scriptStats,
  type ScriptStage,
  type ScriptView,
  type VoiceChoice,
} from '../lib/scriptWriter';
import { ClaimsCheck } from './ClaimsCheck';
import { ConceptThumbnail } from './ConceptThumbnail';
import { Field } from './layout/Card';
import { Details } from './layout/Details';
import { RiskCheckLink } from './RiskParts';
import { Checklist, Counts } from './ScriptChecks';
import { ScriptOrigins } from './ScriptOrigins';
import { ScriptResearch } from './ScriptResearch';
import { ScriptSetup } from './ScriptSetup';
import type { Lab } from './useLab';
import type { Research } from './useResearch';
import type { Script } from './useScript';

interface Props {
  readonly script: Script;
  readonly research: Research;
  readonly lab: Lab;
  readonly busy: boolean;
  readonly voices: readonly VoiceChoice[];
  readonly view: ScriptView;
  readonly stage: ScriptStage;
  /** The text in the editor, and which one it is. */
  readonly text: string;
  readonly field: 'draft' | 'tightened';
  readonly onChange: (text: string) => void;
}

/** The one warning every script carries, in a line. */
function FactsWarning({ markFacts }: { readonly markFacts: boolean }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-metric-amber-bg p-space-sm text-body-sm text-on-surface">
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-metric-amber" />
      {markFacts
        ? 'Some facts may be wrong. Each one the AI could not vouch for is followed by [CHECK: …]: check them before you record. Invented facts stated as true break YouTube’s rules on misleading content.'
        : 'Some facts may be wrong, and marking facts to check is off in Settings: check every name, number and date yourself before you record.'}
    </p>
  );
}

/** What the script rests on and what is checked about it, beside the main area. */
function Checks({ view, stage, text, research, busy, field, onChange }: Props) {
  if (stage === 'hooks') return null;
  const markFacts = view.markFacts ?? true;
  const stats = scriptStats(text, view.script?.wordsPerMinute ?? null, markFacts);
  return (
    <>
      <Details summary={`Facts to check (${stats.markers.length})`}>
        <Counts stats={stats} view={view} />
      </Details>
      <Details summary="Claims check">
        <ClaimsCheck
          research={research}
          text={text}
          which={field}
          busy={busy}
          onChange={onChange}
        />
      </Details>
    </>
  );
}

/**
 * The script writer's side panel: the way back to the concepts, the voice
 * and length, where the concept came from, the retention checklist, the
 * fact sheet, the checks and the thumbnail prompt.
 */
export function ScriptPanel(props: Props) {
  const { script, research, lab, busy, voices, view, text } = props;
  const thumbnail = thumbnailFor(lab.thumbnails, view.concept.id);
  const beats = view.script?.beats ?? '';
  return (
    <>
      <a
        href={viewHref('ideas')}
        className="flex w-fit items-center gap-1.5 text-body-sm text-on-surface-variant hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Concepts
      </a>
      <h2 id="script-writer-title" className="text-headline-md font-bold text-on-surface">
        Script writer
      </h2>
      <FactsWarning markFacts={view.markFacts ?? true} />
      <ScriptSetup script={script} view={view} busy={busy} voices={voices} />
      <Field label="Inspiration">
        <ScriptOrigins conceptId={view.concept.id} />
      </Field>
      {beats.trim() !== '' && (
        <div className="rounded-lg border border-border-subtle bg-space-deep p-space-sm">
          <Checklist beats={beats} text={text} />
        </div>
      )}
      <ScriptResearch research={research} text={text} busy={busy} />
      <Checks {...props} />
      <Details summary="Thumbnail prompt">
        <ConceptThumbnail
          title={view.concept.title}
          thumbnail={thumbnail}
          busy={busy}
          onWrite={() => lab.writeThumbnail(view.concept.id)}
        />
      </Details>
      <RiskCheckLink />
    </>
  );
}
