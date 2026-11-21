import type { MapSnapshot, TransferIdea } from '@jgtube/core';
import { ideaFromTransfer } from '../lib/flow';
import type { Connections, NamedChannel } from './Connections';
import { useFlow } from './useFlow';
import type { Workspace } from './useWorkspace';

/** The sections a link brings into view. */
export const SECTION_IDS = {
  askAi: 'ask-claude',
  ideaLab: 'idea-lab',
  scriptWriter: 'script-writer',
} as const;

const scrollTo = (id: string): void =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/**
 * The path from research to a script: the counts of the flow strip, and the
 * links that take a thing from one section into another and bring it into view.
 */
export function usePagePath(snapshot: MapSnapshot | null, work: Workspace) {
  const { lab, script, voices, analysis, breakdown, labJobs } = work;
  // Read again whenever a run ends or a script changes, so the strip's counts stay true.
  const flow = useFlow(
    snapshot?.center.id ?? null,
    [
      labJobs.state.status,
      analysis.state.status,
      breakdown.state.status,
      script.view?.concept.id,
    ].join('|'),
  );
  const connections: Connections = {
    useVoice: (channel) => {
      script.change({ voiceChannelId: channel.id });
      scrollTo(SECTION_IDS.scriptWriter);
    },
    voiceProblem: (channelId) =>
      script.view === null
        ? 'Open a script first: press “Write the script” on a concept in the idea lab.'
        : voices.some((voice) => voice.id === channelId)
          ? null
          : 'This channel is not on the map on screen, so its voice cannot be measured for this script.',
    useFormulas: (channel) => {
      lab.choose({ formulasFrom: channel });
      scrollTo(SECTION_IDS.ideaLab);
    },
    useStyleLock: (channel) => flow.useStyleLock(channel.id),
    styleLock: flow.styleLock,
    stopStyleLock: flow.stopStyleLock,
    useReviewStyle: () => scrollTo(SECTION_IDS.ideaLab),
  };
  /** Opens a concept's script; starting a script keeps its concept. */
  const draft = (conceptId: number) => {
    lab.keep(conceptId, true);
    script.open(conceptId);
    scrollTo(SECTION_IDS.scriptWriter);
  };
  const remix = (formulaId: number) => {
    lab.choose({ format: `formula:${formulaId}` });
    scrollTo(SECTION_IDS.ideaLab);
  };
  /** Takes an idea of the transfer list into the idea lab: its best version on this map, and its template. */
  const conceptsFrom = (idea: TransferIdea): void => {
    if (!snapshot) return;
    const onMap = new Set([snapshot.center.id, ...snapshot.channels.map((channel) => channel.id)]);
    const taken = ideaFromTransfer(idea, onMap);
    if (taken.pick && !lab.picks.some((pick) => pick.videoId === taken.pick?.videoId)) {
      lab.pick(taken.pick);
    }
    lab.choose({ format: taken.format, fromIdea: taken.idea });
    scrollTo(SECTION_IDS.ideaLab);
  };
  /** Starts a breakdown of any stored channel and brings Ask AI, where it reports, into view. */
  const breakDown = (channel: NamedChannel): void => {
    breakdown.start({ id: channel.id, title: channel.title }, analysis.choice, false);
    scrollTo(SECTION_IDS.askAi);
  };
  return { flow, connections, draft, remix, conceptsFrom, breakDown };
}
