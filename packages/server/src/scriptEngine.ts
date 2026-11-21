/**
 * The script writer for one concept: a voice measured from a channel's own
 * captions, a length taken from this map's winners, and three stages an
 * engine writes, each reading the concept and the earlier stages only
 * through read-only tools. What an engine writes is stored as written; what
 * it could not know it was told to mark, and nothing here unmarks it.
 */
import {
  HOOK_LIBRARY_VIDEOS,
  LONG_HOOK_SECONDS,
  SHORTS_HOOK_SECONDS,
  SHORTS_LIMIT_SECONDS,
  SHORTS_TARGET_SECONDS,
  VOICE_VIDEOS,
  countWords,
  lengthRange,
  mapChannelIds,
  namedVideoIds,
  parseHooksAndBeats,
  pickBreakdownVideos,
  pickHookVideos,
  scriptBody,
  voiceProfile,
  type LengthRange,
  type ScriptFields,
  type StoredScript,
  type VideoTranscript,
} from '@jgtube/core';
import type { AnalysisId } from './analyses';
import { findConceptOf, type FoundConcept } from './ideaEngine';
import { cleanMessage } from './jobs';
import { storedChannel, type LabDeps } from './labDeps';
import { CLOSING } from './running';
import type { ScriptEngine, ScriptPlan, ScriptStage, ScriptView, VoiceView } from './scriptTypes';

const SECONDS_PER_MINUTE = 60;
const NOT_THIS_CHANNELS = 'That concept is not one of this channel’s concepts.';
const NOT_ON_MAP = 'That channel is not on this channel’s map, so it cannot be the voice.';
const NO_RATE =
  'The script has no speaking rate yet. Choose a voice whose captions have been read, or type a rate.';
const NO_LENGTH = 'The script has no length yet. Choose how long the video is to be.';

const ANALYSIS: Readonly<Record<ScriptStage, AnalysisId>> = {
  hooks: 'script-hooks',
  draft: 'script-draft',
  tighten: 'script-tighten',
};

const WORKING: Readonly<Record<ScriptStage, string>> = {
  hooks: 'Asking the AI for three hooks and a beat sheet',
  draft: 'Asking the AI to write the draft',
  tighten: 'Asking the AI to tighten the draft',
};

/** The best videos of a channel: the ones its voice is measured over. */
function bestVideoIds(deps: LabDeps, channelId: string): readonly string[] {
  return pickBreakdownVideos(deps.repos.videos.listByChannel(channelId), deps.now())
    .top.slice(0, VOICE_VIDEOS)
    .map((video) => video.videoId);
}

function voiceView(
  deps: LabDeps,
  centerChannelId: string,
  voiceChannelId: string,
): VoiceView | null {
  const onMap = mapChannelIds(deps.repos.maps, centerChannelId);
  const channel = deps.repos.channels.findById(voiceChannelId);
  if (!onMap?.has(voiceChannelId) || !channel) return null;
  const best = bestVideoIds(deps, voiceChannelId);
  const stored = best.map((videoId) => deps.repos.pages.find(videoId));
  const transcripts = stored.flatMap((entry): VideoTranscript[] =>
    entry?.transcript ? [entry.transcript] : [],
  );
  return {
    channelId: voiceChannelId,
    title: channel.title,
    profile: voiceProfile(transcripts),
    toRead: stored.filter((entry) => entry === null).length,
    noCaptions: stored.filter((entry) => entry !== null && entry.transcript === null).length,
    frameStudies: best.filter((videoId) => deps.repos.studies.find(videoId, 'frames') !== null),
  };
}

/** How long the look-alikes' winners on this map run, from their stored lengths. */
function winnersRange(deps: LabDeps, centerChannelId: string): LengthRange | null {
  const breakouts = deps.findSnapshot(centerChannelId)?.breakouts ?? [];
  const winners = pickHookVideos(breakouts, breakouts.length);
  return lengthRange(winners.flatMap((video) => video.durationSeconds ?? []));
}

function planOf(found: FoundConcept, script: StoredScript | null): ScriptPlan {
  const hookSeconds = found.batch.length === 'shorts' ? SHORTS_HOOK_SECONDS : LONG_HOOK_SECONDS;
  const rate = script?.wordsPerMinute ?? null;
  const words = (seconds: number | null): number | null =>
    rate === null || seconds === null ? null : Math.round((rate * seconds) / SECONDS_PER_MINUTE);
  return {
    hookSeconds,
    hookWords: words(hookSeconds),
    targetWords: words(script?.targetSeconds ?? null),
  };
}

/** Whether the owner has facts marked for checking; on unless they turned it off. */
const marksFacts = (deps: LabDeps): boolean => deps.markFacts?.() ?? true;

function viewOf(deps: LabDeps, found: FoundConcept): ScriptView {
  const center = found.batch.centerChannelId;
  const script = deps.repos.scripts.find(center, found.concept.id);
  return {
    concept: found.view,
    script,
    plan: planOf(found, script),
    lengthRange: winnersRange(deps, center),
    markFacts: marksFacts(deps),
    voice: script?.voiceChannelId ? voiceView(deps, center, script.voiceChannelId) : null,
  };
}

/** The ids of the videos this channel's hook library is built from. */
function libraryIds(deps: LabDeps, centerChannelId: string): readonly string[] {
  const breakouts = deps.findSnapshot(centerChannelId)?.breakouts ?? [];
  return pickHookVideos(breakouts, HOOK_LIBRARY_VIDEOS).map((video) => video.videoId);
}

/** What a new script starts with, taken from what is stored for this channel and this concept. */
function firstFields(deps: LabDeps, found: FoundConcept): Partial<ScriptFields> {
  const center = found.batch.centerChannelId;
  const voiceId = deps.findSnapshot(center)?.model?.id ?? center;
  const voice = voiceView(deps, center, voiceId);
  const shorts = found.batch.length === 'shorts';
  const typical = winnersRange(deps, center)?.typicalSeconds ?? null;
  return {
    voiceChannelId: voice ? voiceId : null,
    wordsPerMinute: voice?.profile.wordsPerMinute ?? null,
    targetGrade: voice?.profile.grade ?? null,
    targetSeconds: shorts ? SHORTS_TARGET_SECONDS : typical === null ? null : Math.round(typical),
    // The library hook the concept's opening follows becomes the first model for the script's.
    hookModels: namedVideoIds(found.concept.hookStyle ?? '', libraryIds(deps, center)).slice(0, 1),
  };
}

/** Why the owner's changes cannot be stored, or null when they can. */
function changeProblem(
  deps: LabDeps,
  found: FoundConcept,
  changes: Partial<ScriptFields>,
): string | null {
  const center = found.batch.centerChannelId;
  const { voiceChannelId, hookModels, targetSeconds } = changes;
  if (voiceChannelId && !mapChannelIds(deps.repos.maps, center)?.has(voiceChannelId)) {
    return NOT_ON_MAP;
  }
  const library = libraryIds(deps, center);
  if (hookModels?.some((id) => !library.includes(id))) {
    return 'A hook to model must be one of this channel’s hook library.';
  }
  const tooLong = found.batch.length === 'shorts' && (targetSeconds ?? 0) > SHORTS_LIMIT_SECONDS;
  return tooLong ? `A Short is under a minute: at most ${SHORTS_LIMIT_SECONDS} seconds.` : null;
}

/** A change of voice brings that voice's rate and grade with it, unless the owner set them too. */
function withVoiceNumbers(
  deps: LabDeps,
  center: string,
  changes: Partial<ScriptFields>,
): Partial<ScriptFields> {
  const voice = changes.voiceChannelId ? voiceView(deps, center, changes.voiceChannelId) : null;
  if (!voice) return changes;
  return {
    ...(voice.profile.wordsPerMinute === null
      ? {}
      : { wordsPerMinute: voice.profile.wordsPerMinute }),
    targetGrade: voice.profile.grade,
    ...changes,
  };
}

/** What a stage's answer becomes in the script; throws, in plain words, when it holds nothing usable. */
function fieldsFrom(stage: ScriptStage, answer: string): Partial<ScriptFields> {
  if (stage === 'hooks') {
    const { hooks, beats, problem } = parseHooksAndBeats(answer);
    if (problem) throw new Error(`The AI answered, but ${problem} Nothing was changed. Try again.`);
    return { hooks, beats: beats.join('\n'), status: 'drafting' };
  }
  const script = scriptBody(answer);
  if (countWords(script) === 0) {
    throw new Error('The AI answered, but not with a script. Nothing was changed. Try again.');
  }
  return stage === 'draft' ? { draft: script, status: 'drafting' } : { tightened: script };
}

/** The script writer, on this engine's store and engines. */
export function scriptEngine(deps: LabDeps): ScriptEngine {
  const { scripts } = deps.repos;
  const found = (center: string, conceptId: number): FoundConcept | null =>
    findConceptOf(deps, center, conceptId);
  const stageProblem: ScriptEngine['stageProblem'] = (stage, center, conceptId) => {
    const script = scripts.find(center, conceptId);
    if (!found(center, conceptId) || !script) return NOT_THIS_CHANNELS;
    if (script.wordsPerMinute === null) return NO_RATE;
    if (script.targetSeconds === null) return NO_LENGTH;
    if (stage === 'draft' && (script.chosenHook.trim() === '' || script.beats.trim() === '')) {
      return 'Choose a hook and keep a beat sheet first: the draft is written from them.';
    }
    return stage === 'tighten' && script.draft.trim() === ''
      ? 'There is no draft to tighten yet.'
      : null;
  };
  return {
    stageProblem,

    findScriptView(center, conceptId) {
      const concept = found(center, conceptId);
      return concept ? viewOf(deps, concept) : null;
    },

    openScript(center, conceptId) {
      const concept = found(center, conceptId);
      if (!concept) return null;
      if (!scripts.find(center, conceptId)) {
        scripts.save(center, conceptId, firstFields(deps, concept), deps.now());
      }
      return viewOf(deps, findConceptOf(deps, center, conceptId) ?? concept);
    },

    scriptChangeProblem(center, conceptId, changes) {
      const concept = found(center, conceptId);
      return concept ? changeProblem(deps, concept, changes) : NOT_THIS_CHANNELS;
    },

    saveScript(center, conceptId, changes) {
      const concept = found(center, conceptId);
      if (!concept) return null;
      const problem = changeProblem(deps, concept, changes);
      if (problem) throw new Error(problem);
      scripts.save(center, conceptId, withVoiceNumbers(deps, center, changes), deps.now());
      return viewOf(deps, findConceptOf(deps, center, conceptId) ?? concept);
    },

    async runScriptStage(stage, center, conceptId, only, onProgress) {
      const problem = stageProblem(stage, center, conceptId);
      if (problem) throw new Error(problem);
      onProgress({ step: 'asking', text: WORKING[stage] });
      const answer = await deps.analyse(ANALYSIS[stage], center, only, {
        kind: 'script',
        conceptId,
        ...(marksFacts(deps) ? {} : { markFacts: false }),
      });
      onProgress({ step: 'reading', text: 'Reading what the AI wrote' });
      scripts.save(center, conceptId, fieldsFrom(stage, answer.text), deps.now());
      const concept = found(center, conceptId);
      if (!concept) throw new Error(NOT_THIS_CHANNELS);
      return {
        kind: 'script',
        stage,
        view: viewOf(deps, concept),
        engine: answer.engine,
        skipped: answer.skipped,
      };
    },

    voiceOf: (center, voiceChannelId) => voiceView(deps, center, voiceChannelId),

    async readVoice(center, voiceChannelId, onProgress) {
      if (!voiceView(deps, center, voiceChannelId)) throw new Error(NOT_ON_MAP);
      const missing = bestVideoIds(deps, voiceChannelId).filter(
        (videoId) => deps.repos.pages.find(videoId) === null,
      );
      let failed: readonly { readonly videoId: string; readonly reason: string }[] = [];
      for (const [index, videoId] of missing.entries()) {
        if (deps.isClosing()) throw new Error(CLOSING);
        onProgress({
          step: 'captions',
          text: `Reading the captions of video ${index + 1} of ${missing.length} of this channel’s best`,
        });
        try {
          await deps.readTranscript(videoId);
        } catch (error) {
          failed = [...failed, { videoId, reason: cleanMessage(error) }];
        }
      }
      const voice = voiceView(deps, center, voiceChannelId);
      if (!voice) throw new Error(NOT_ON_MAP);
      return { kind: 'voice', voice, read: missing.length - failed.length, failed };
    },

    findScript(channel, conceptId) {
      const stored = storedChannel(deps, channel);
      const concept = stored ? found(stored.id, conceptId) : null;
      if (!concept) return null;
      const view = viewOf(deps, concept);
      return {
        concept: concept.concept,
        batch: concept.batch,
        picked: concept.picked,
        script: view.script,
        plan: view.plan,
        voice: view.voice,
      };
    },
  };
}
