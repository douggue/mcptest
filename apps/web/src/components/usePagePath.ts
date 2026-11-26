import type { MapSnapshot, TransferIdea } from '@jgtube/core';
import { ideaFromTransfer } from '../lib/flow';
import type { ViewId } from '../lib/routes';
import type { Connections, NamedChannel } from './Connections';
import { useFlow } from './useFlow';
import type { Go } from './useRoute';
import type { Workspace } from './useWorkspace';

/**
 * The path from research to a script: the counts of the flow strip, and the
 * links that take a thing from one view into another and open that view.
 */
export function usePagePath(
  snapshot: MapSnapshot | null,
  work: Workspace,
  go: Go,
  /** The flow strip's counts are read only once a screen that shows them has opened. */
  showsFlow = true,
) {
  const open = (view: ViewId): void => go({ view, channelId: null, anchor: null });
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
    showsFlow,
  );
  const connections: Connections = {
    useVoice: (channel) => {
      script.change({ voiceChannelId: channel.id });
      open('script');
    },
    voiceProblem: (channelId) =>
      script.view === null
        ? 'Open a script first: press Write on an idea in Ideas.'
        : voices.some((voice) => voice.id === channelId)
          ? null
          : 'This channel is not on the map on screen, so its voice cannot be measured for this script.',
    useFormulas: (channel) => {
      lab.choose({ formulasFrom: channel });
      open('ideas');
    },
    useStyleLock: (channel) => flow.useStyleLock(channel.id),
    styleLock: flow.styleLock,
    stopStyleLock: flow.stopStyleLock,
    useReviewStyle: () => open('ideas'),
  };
  /** Opens a concept's script; starting a script keeps its concept. */
  const draft = (conceptId: number) => {
    lab.keep(conceptId, true);
    script.open(conceptId);
    open('script');
  };
  const remix = (formulaId: number) => {
    lab.choose({ format: `formula:${formulaId}` });
    open('ideas');
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
    open('ideas');
  };
  /** Opens the Breakdown tab of a channel's page, where the owner presses Break it down. */
  const breakDown = (channel: NamedChannel): void => {
    go({ view: 'channel', channelId: channel.id, anchor: null, tab: 'breakdown' });
  };
  return { flow, connections, draft, remix, conceptsFrom, breakDown };
}

export type PagePath = ReturnType<typeof usePagePath>;
