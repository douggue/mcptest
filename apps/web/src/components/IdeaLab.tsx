import type { BreakoutVideo, TransferList } from '@jgtube/core';
import { Lightbulb, Trash2 } from 'lucide-react';
import { thumbnailFor, type ConceptView } from '../lib/ideaLab';
import type { AiChoice } from './AiEngines';
import { ConceptCard } from './ConceptCard';
import { FeedPreview } from './FeedPreview';
import { IdeaLabPanel } from './IdeaLabPanel';
import { Card } from './layout/Card';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { LabStatus, NOTE, QUIET_BUTTON } from './LabStatus';
import type { Lab } from './useLab';

interface Props {
  readonly lab: Lab;
  readonly busy: boolean;
  readonly transfers: TransferList | null;
  readonly centerTitle: string;
  /** The breakouts of the map on screen, for the feed preview. */
  readonly breakouts: readonly BreakoutVideo[];
  /** Opens the script writer for a concept; absent where there is none. */
  readonly onDraft?: ((concept: ConceptView) => void) | undefined;
  /** Which AI writes the concepts; absent where the choice is made elsewhere. */
  readonly ai?: AiChoice;
}

/** Said before the first batch: where to start. */
function NoConcepts() {
  return (
    <Card>
      <Lightbulb aria-hidden="true" className="h-6 w-6 text-metric-amber" />
      <p className="text-body-md text-on-surface">No concepts yet.</p>
      <p className="text-body-sm text-on-surface-variant">
        Pick up to four videos on the left, add your angle if you have one, and press Write 10
        concepts. Each concept is a title, a thumbnail, its words and an opening sentence.
      </p>
    </Card>
  );
}

/**
 * The idea lab: the controls in a side panel that stays in view, and the
 * concepts in one roomy column, the first set in a feed beside real breakouts
 * of the map. The kept ones stay; the rest go when the next batch comes or
 * on request.
 */
export function IdeaLab(props: Props) {
  const { lab, busy, transfers, centerTitle, breakouts, onDraft, ai } = props;
  const concepts = lab.concepts ?? [];
  const unkept = concepts.filter((concept) => !concept.kept).length;
  const hooks = lab.library?.hooks ?? [];
  const [first] = concepts;
  return (
    <ViewPage id="idea-lab" labelledBy="idea-lab-title">
      <SplitView
        sideLabel="What the concepts rest on"
        side={
          <IdeaLabPanel
            lab={lab}
            busy={busy}
            transfers={transfers}
            centerTitle={centerTitle}
            ai={ai}
          />
        }
      >
        <ViewHeader
          title="Concepts"
          count={concepts.length}
          lead={
            concepts.length > 0
              ? `${concepts.length - unkept} kept, ${unkept} not kept. A new batch replaces the ones not kept.`
              : undefined
          }
          actions={
            unkept > 0 && (
              <button
                type="button"
                onClick={lab.clear}
                className={`flex items-center gap-1.5 ${QUIET_BUTTON}`}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                Clear unkept ({unkept})
              </button>
            )
          }
        />
        <LabStatus
          state={lab.jobs.state}
          kinds={['batch', 'twist', 'more', 'thumbnail']}
          working="Asking the AI"
          takes="This usually takes two to four minutes."
        />
        {lab.problem && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            {lab.problem}
          </p>
        )}
        {lab.conceptNote && <p className={NOTE}>{lab.conceptNote}</p>}
        {first ? (
          <FeedPreview concept={first} title={first.title} breakouts={breakouts} />
        ) : (
          <NoConcepts />
        )}
        {concepts.length > 0 && (
          <ol className="flex flex-col gap-space-lg">
            {concepts.map((concept, index) => (
              <li key={concept.id}>
                <ConceptCard
                  number={index + 1}
                  concept={concept}
                  hooks={hooks}
                  breakouts={breakouts}
                  busy={busy}
                  onKeep={(kept) => lab.keep(concept.id, kept)}
                  onGrow={(kind) => lab.grow(kind, concept.id)}
                  thumbnail={thumbnailFor(lab.thumbnails, concept.id)}
                  onThumbnail={() => lab.writeThumbnail(concept.id)}
                  onDraft={onDraft ? () => onDraft(concept) : undefined}
                />
              </li>
            ))}
          </ol>
        )}
      </SplitView>
    </ViewPage>
  );
}
