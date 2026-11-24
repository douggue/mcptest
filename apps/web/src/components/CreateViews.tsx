import { usePlan } from './usePlan';
import type { ViewId } from '../lib/routes';
import { toggleModel } from '../lib/scriptWriter';
import { FormatView } from './FormatView';
import { Formulas } from './Formulas';
import { HookLibrary } from './HookLibrary';
import { IdeaLab } from './IdeaLab';
import { RiskCheck } from './RiskCheck';
import { ScriptWriter } from './ScriptWriter';
import { aiOf, withMap, type ViewDraw, type ViewParts } from './viewParts';

/** The hook library, which can also choose the open script's model openings. */
function Hooks({ work, centerTitle }: ViewParts & { readonly centerTitle: string }) {
  const { lab, script, asking } = work;
  const scriptModels = script.view?.script?.hookModels;
  return (
    <HookLibrary
      lab={lab}
      busy={asking}
      centerTitle={centerTitle}
      models={
        scriptModels && {
          chosen: scriptModels,
          toggle: (videoId) => script.change({ hookModels: toggleModel(scriptModels, videoId) }),
        }
      }
    />
  );
}

/** The script writer, told which kept concepts already have a script. */
function Script({ work, centerId }: ViewParts & { readonly centerId: string }) {
  const plan = usePlan(centerId, work.refresh.run.status);
  const view = plan.state.status === 'ready' ? plan.state.plan : null;
  const scripted = view
    ? new Set(
        [...view.linkable, ...view.linked].flatMap((row) => (row.hasScript ? [row.conceptId] : [])),
      )
    : null;
  return (
    <ScriptWriter
      script={work.script}
      research={work.research}
      lab={work.lab}
      busy={work.asking}
      voices={work.voices}
      scripted={scripted}
    />
  );
}

/** The views of the rail's Create group, each drawn on its own. */
export const CREATE_VIEWS: Partial<Record<ViewId, ViewDraw>> = {
  formats: withMap('formats', (snapshot, { work, path }) => (
    <Formulas
      lab={work.lab}
      busy={work.asking}
      centerTitle={snapshot.center.title}
      centerId={snapshot.center.id}
      onRemix={path.remix}
    />
  )),
  hooks: withMap('hooks', (snapshot, parts) => (
    <Hooks {...parts} centerTitle={snapshot.center.title} />
  )),
  ideas: withMap('ideas', (snapshot, { work, path }) => (
    <IdeaLab
      lab={work.lab}
      busy={work.asking}
      transfers={work.transfers.state.status === 'ready' ? work.transfers.state.list : null}
      centerTitle={snapshot.center.title}
      breakouts={snapshot.breakouts}
      onDraft={(concept) => path.draft(concept.id)}
      ai={aiOf(work)}
    />
  )),
  script: withMap('script', (snapshot, parts) => (
    <Script {...parts} centerId={snapshot.center.id} />
  )),
  format: ({ page, work }) => (
    <FormatView channelId={page.snapshot?.center.id ?? null} ai={aiOf(work)} />
  ),
  risk: ({ page, work }) => (
    <RiskCheck
      channelId={page.snapshot?.center.id ?? null}
      openConceptId={work.script.view?.concept.id ?? null}
      reloadKey={work.refresh.run.status}
    />
  ),
};
