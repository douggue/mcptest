/**
 * What the idea lab's parts are built from: the store, the engines that
 * answer a fixed question, and the readers the rest of the engine already has.
 */
import {
  parseChannelRef,
  type BreakdownRepo,
  type ResearchRepo,
  type ChannelRepo,
  type ConceptRepo,
  type FormulaRepo,
  type HookLabelRepo,
  type MapVideoDeps,
  type ScriptRepo,
  type StoredChannel,
  type StoredTranscript,
  type VideoStudyRepo,
} from '@jgtube/core';
import type { Engine } from './app';

export interface LabDeps {
  readonly now: () => Date;
  readonly repos: MapVideoDeps & {
    readonly channels: Pick<ChannelRepo, 'findById' | 'findByHandle'>;
    readonly concepts: ConceptRepo;
    readonly formulas: FormulaRepo;
    readonly hookLabels: HookLabelRepo;
    readonly scripts: ScriptRepo;
    /** Stored studies of videos; a frame study says how often a video's picture changes. */
    readonly studies: Pick<VideoStudyRepo, 'find'>;
    /** Stored captions; null for a video whose captions were never asked for. */
    readonly pages: { find(videoId: string): StoredTranscript | null };
    /** Stored breakdowns, for title formulas taken from one; absent where none are kept. */
    readonly breakdowns?: Pick<BreakdownRepo, 'find'>;
    /** The lengths the owner typed; absent where none are kept. */
    readonly research?: Pick<ResearchRepo, 'findLength' | 'saveLength'>;
  };
  readonly analyse: Engine['analyse'];
  readonly listTransfers: Engine['listTransfers'];
  readonly findSnapshot: Engine['findSnapshot'];
  readonly readTranscript: Engine['readTranscript'];
  /** Whether a script's writer is asked to mark facts to check, as the owner has it set now; absent means yes. */
  readonly markFacts?: () => boolean;
  /** Whether Jgtube is closing, so a job of several steps stops between them. */
  readonly isClosing: () => boolean;
}

/** The stored channel a handle, link or id refers to; null when it is not stored or not a channel. */
export function storedChannel(deps: LabDeps, channel: string): StoredChannel | null {
  try {
    const ref = parseChannelRef(channel);
    return ref.kind === 'id'
      ? deps.repos.channels.findById(ref.id)
      : deps.repos.channels.findByHandle(ref.handle);
  } catch {
    return null;
  }
}
