/**
 * The hook library of one channel's map: the first minute of what the map's
 * top breakout videos say, cut in code from stored captions. Building it
 * reads from YouTube the captions the store lacks, one video at a time,
 * through the same reader and rate limiter as every other caption read. An
 * engine is asked only to name the way each opening works.
 */
import {
  HOOK_LIBRARY_VIDEOS,
  HOOK_SECONDS,
  NO_MAP,
  buildHookLibrary,
  parseHookLabels,
  pickHookVideos,
  type HookSource,
  type MapSnapshot,
} from '@jgtube/core';
import { cleanMessage } from './jobs';
import type { LabDeps } from './labDeps';
import type { HookLibrary, LabEngine } from './labTypes';
import { CLOSING } from './running';

type HookParts = Pick<LabEngine, 'hookLibrary' | 'buildHookLibrary' | 'labelHooks'>;

const NOTHING_TO_NAME =
  'No opening words are stored for this map yet. Build the hook library first.';

/** The videos the library is built from: the map's top breakouts, with their stored numbers. */
function sourcesOf(snapshot: MapSnapshot): readonly HookSource[] {
  return pickHookVideos(snapshot.breakouts, HOOK_LIBRARY_VIDEOS).map((breakout) => ({
    videoId: breakout.videoId,
    title: breakout.title,
    channelId: breakout.channelId,
    channelTitle: breakout.channelTitle,
    views: breakout.views,
    score: breakout.score,
  }));
}

function libraryOf(deps: LabDeps, channel: string): HookLibrary | null {
  const snapshot = deps.findSnapshot(channel);
  if (!snapshot) return null;
  const centerChannelId = snapshot.center.id;
  return {
    centerChannelId,
    seconds: HOOK_SECONDS,
    cap: HOOK_LIBRARY_VIDEOS,
    hooks: buildHookLibrary(
      sourcesOf(snapshot),
      (videoId) => deps.repos.pages.find(videoId),
      deps.repos.hookLabels.list(centerChannelId),
    ),
  };
}

/** The hook library side of the idea lab, on this engine's store and engines. */
export function hookEngine(deps: LabDeps): HookParts {
  const required = (centerChannelId: string): HookLibrary => {
    const library = libraryOf(deps, centerChannelId);
    if (library === null) throw new Error(NO_MAP);
    return library;
  };
  return {
    hookLibrary: (channel) => libraryOf(deps, channel),

    async buildHookLibrary(centerChannelId, onProgress) {
      const missing = required(centerChannelId).hooks.filter(
        (hook) => hook.captions === 'not-read',
      );
      let failed: readonly { readonly videoId: string; readonly reason: string }[] = [];
      for (const [index, hook] of missing.entries()) {
        if (deps.isClosing()) throw new Error(CLOSING);
        onProgress({
          step: 'captions',
          text: `Reading the captions of video ${index + 1} of ${missing.length}: “${hook.title}”`,
        });
        try {
          await deps.readTranscript(hook.videoId);
        } catch (error) {
          failed = [...failed, { videoId: hook.videoId, reason: cleanMessage(error) }];
        }
      }
      return {
        kind: 'hooks-built',
        library: required(centerChannelId),
        read: missing.length - failed.length,
        failed,
      };
    },

    async labelHooks(centerChannelId, only, onProgress) {
      const sent = required(centerChannelId)
        .hooks.filter((hook) => hook.text !== null)
        .map((hook) => hook.videoId);
      if (sent.length === 0) throw new Error(NOTHING_TO_NAME);
      onProgress({
        step: 'asking',
        text: `Asking the AI to name the way each of ${sent.length} openings works`,
      });
      const answer = await deps.analyse('hook-styles', centerChannelId, only);
      const { labels, unread } = parseHookLabels(answer.text, sent);
      if (labels.length === 0) {
        throw new Error(
          'The AI answered, but not with a style for any of the hooks it was sent. Nothing was changed. Try again.',
        );
      }
      deps.repos.hookLabels.saveMany(centerChannelId, labels, answer.engine, deps.now());
      return {
        kind: 'hooks-labelled',
        library: required(centerChannelId),
        labelled: labels.length,
        unread,
        engine: answer.engine,
        skipped: answer.skipped,
      };
    },
  };
}
