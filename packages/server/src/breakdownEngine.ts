/**
 * A channel breakdown, as one job of several steps.
 *
 * In code, by one rule for every channel: the channel's five videos furthest
 * above its usual views are chosen, their captions are read, and the three
 * best are studied in depth. For each of those a video file is looked for
 * (the owner's own, else a download), an engine watches it for sound and
 * editing, and an engine goes through its frames, cut from the file one a
 * second or, with no file, YouTube's own preview frames. What each engine
 * wrote is stored per video and reused the next time (`breakdownStudies.ts`).
 * Then the breakdown is written in seven parts, one engine run each, through
 * read-only tools (`breakdownWriting.ts`), and saved as text files.
 *
 * Nothing that could not be done fails the job: it is recorded with a plain
 * reason, and the breakdown says what is unknown instead of guessing.
 */
import {
  frameStudyNumbers,
  pickBreakdownVideos,
  transcriptPace,
  type BreakdownPicks,
  type BreakdownRepo,
  type BreakdownVideo,
  type FrameSheetCut,
  type StoredVideo,
  type StudiedFrames,
  type TimedLine,
  type TranscriptResult,
  type VideoStudyRepo,
} from '@jgtube/core';
import type { MeasureOutcome } from './channelMeasure';
import type { Engine } from './app';
import { basisText } from './breakdownBasis';
import type { BreakdownStore } from './breakdownStore';
import { measureContrast, reasonOf, stopIfClosing, studyDeep, teller } from './breakdownStudies';
import type {
  BreakdownChoices,
  BreakdownOutcome,
  BreakdownProgress,
  PartRun,
  StudiedVideo,
  TopVideo,
} from './breakdownTypes';
import { writeParts, type WritingDeps } from './breakdownWriting';
import type { EngineAnswer } from './engines/fallback';
import type { EngineId } from './engines/types';
import type { DownloadVideo, VideoDownload } from './engines/videoWatch';

/** The file operations a breakdown needs, so tests can stand in for the disk and the network. */
export interface BreakdownFiles {
  /** Where the owner's own files go; null when there is nowhere to save. */
  ownFolder(): string | null;
  /** The owner's own file for a video, or null. Never deleted by Jgtube. */
  own(videoId: string): Promise<string | null>;
  /** Fetches a copy, which comes with the way to remove it. */
  readonly fetch: DownloadVideo;
  /** Whether frames can be cut from a file: ffmpeg is installed. */
  canCut(): Promise<boolean>;
  cut(videoId: string, path: string): Promise<FrameSheetCut>;
  removeFrames(videoId: string): Promise<void>;
  /** The file as the engine that watches can open it: itself, or a smaller copy made for the watch. */
  forWatching(videoId: string, path: string): Promise<VideoDownload>;
}

export interface BreakdownDeps {
  readonly now: () => Date;
  /** Aborted when Jgtube is closing. */
  readonly stop: AbortSignal;
  readonly studies: VideoStudyRepo;
  /** The stored parts of each channel's breakdown. */
  readonly parts: BreakdownRepo;
  /** The stored breakdown read back, and its text files. */
  readonly stored: Pick<BreakdownStore, 'view' | 'save'>;
  /** A clock that only moves forward, in milliseconds, to time each part; the wall clock when absent. */
  readonly tick?: () => number;
  readonly files: BreakdownFiles;
  /** The channel, read from YouTube first when it is not stored. */
  readChannel(channel: string): Promise<{ readonly id: string; readonly title: string }>;
  listVideos(channelId: string): readonly StoredVideo[];
  readTranscript(videoId: string): Promise<TranscriptResult>;
  /** The frames there are to look at for a video, and where they come from; null when none. */
  framesAvailable(videoId: string): Promise<StudiedFrames | null>;
  /** Whether an engine here would watch a video from a file. */
  watchesFiles(): Promise<boolean>;
  readonly watchVideo: Engine['watchVideo'];
  studyFrames(videoId: string, only?: EngineId): Promise<EngineAnswer<EngineId>>;
  /** Has an engine write one part of the breakdown, for the videos chosen in code. */
  readonly write: WritingDeps['write'];
  /** Measures a video file in code into the teardown store; absent, nothing is measured. */
  readonly measure?: (
    videoId: string,
    path: string,
    fresh: boolean,
    captions: readonly TimedLine[] | null,
    onStep: (text: string) => void,
  ) => Promise<MeasureOutcome>;
  /** Whether a video's measurements are kept. */
  readonly isMeasured?: (videoId: string) => boolean;
}

const NO_VIDEOS =
  'Jgtube has no videos stored for this channel, so there is nothing to break down.';
const NO_FOLDER = 'There is no downloads folder to save the text files in.';

/** Each top video's captions: whether they could be read and what they come to; a video without any is a normal answer. */
async function readCaptions(
  deps: BreakdownDeps,
  top: readonly BreakdownVideo[],
): Promise<readonly TopVideo[]> {
  let read: readonly TopVideo[] = [];
  for (const { videoId, title } of top) {
    stopIfClosing(deps);
    try {
      const { transcript } = await deps.readTranscript(videoId);
      const pace = transcript === null ? null : transcriptPace(transcript.segments);
      read = [
        ...read,
        {
          videoId,
          title,
          captions: transcript === null ? 'none' : 'read',
          words: pace?.words ?? null,
          wordsPerMinute: pace?.wordsPerMinute ?? null,
        },
      ];
    } catch {
      // The writing engine's own tool asks again, and says so if it still cannot be read.
      stopIfClosing(deps);
      read = [...read, { videoId, title, captions: 'failed', words: null, wordsPerMinute: null }];
    }
  }
  return read;
}

/** What code works out from a deep video's stored frame study; null when it has none. */
function frameNumbersOf(deps: BreakdownDeps, picks: BreakdownPicks) {
  return (videoId: string) => {
    const study = deps.studies.find(videoId, 'frames');
    const video = picks.deep.find((entry) => entry.videoId === videoId);
    return study === null
      ? null
      : frameStudyNumbers(study.text, study.frames, video?.durationSeconds ?? null);
  };
}

/** Saves the text files; why they could not be saved comes back in plain words, never as a failure. */
async function saveTexts(
  deps: BreakdownDeps,
  channel: { readonly id: string; readonly title: string },
): Promise<string | null> {
  try {
    await deps.stored.save(channel);
    return null;
  } catch (error) {
    return deps.files.ownFolder() === null ? NO_FOLDER : reasonOf(error);
  }
}

/** What was read and studied before the writing starts. */
interface Studied {
  readonly channel: { readonly id: string; readonly title: string };
  readonly picks: BreakdownPicks;
  readonly top: readonly TopVideo[];
  readonly deep: readonly StudiedVideo[];
}

const NOT_STUDIED_AGAIN = 'Not studied again: only chosen parts were written.';

/** The deep videos as their stored studies left them, for a run that writes chosen parts only. */
function storedStudies(deps: BreakdownDeps, picks: BreakdownPicks): readonly StudiedVideo[] {
  return picks.deep.map(({ videoId, title }) => {
    const watch = deps.studies.find(videoId, 'watch');
    const frames = deps.studies.find(videoId, 'frames');
    return {
      videoId,
      title,
      file: { used: 'none', reason: NOT_STUDIED_AGAIN },
      watch:
        watch === null
          ? { done: false, reason: NOT_STUDIED_AGAIN }
          : { done: true, by: watch.engine, kept: true },
      frames:
        frames === null
          ? { done: false, reason: NOT_STUDIED_AGAIN }
          : {
              done: true,
              by: frames.engine,
              kept: true,
              source: frames.frames?.source ?? null,
              available: frames.frames?.available ?? null,
            },
      ...(deps.isMeasured?.(videoId) ? { measured: { state: 'kept' as const } } : {}),
    };
  });
}

const idsOf = (videos: readonly BreakdownVideo[]): readonly string[] =>
  videos.map((video) => video.videoId);

/** Has the seven parts written. Rejects when not one of them could be. */
async function writeAll(
  deps: BreakdownDeps,
  studied: Studied,
  choices: BreakdownChoices,
  say: (text: string) => void,
): Promise<readonly PartRun[]> {
  const { channel, picks, top, deep } = studied;
  const parts = await writeParts(
    { ...deps, tick: deps.tick ?? Date.now },
    {
      channelId: channel.id,
      focus: {
        top: idsOf(picks.top),
        deep: idsOf(picks.deep),
        titles: idsOf(picks.titles),
        ordinary: idsOf(picks.ordinary),
        storedVideos: picks.storedVideos,
      },
      basis: basisText({ channel, picks, top, deep, frameNumbers: frameNumbersOf(deps, picks) }),
      choices,
      say,
    },
  );
  const failed = parts.find((part) => part.outcome === 'failed');
  if (failed?.outcome === 'failed' && parts.every((part) => part.outcome === 'failed')) {
    throw new Error(`No part of the breakdown could be written. ${failed.reason}`);
  }
  return parts;
}

/**
 * Breaks one channel down and resolves with the stored breakdown and how
 * each step went. Rejects when the channel cannot be read or has no videos
 * stored, when no part at all could be written, or when Jgtube is closing.
 */
export async function breakDown(
  deps: BreakdownDeps,
  channel: string,
  report: (progress: BreakdownProgress) => void,
  choices: BreakdownChoices = {},
): Promise<BreakdownOutcome> {
  const tell = teller(report);
  tell.say('reading', 'Reading the channel and its top videos');
  const stored = await deps.readChannel(channel);
  const picks = pickBreakdownVideos(deps.listVideos(stored.id), deps.now(), choices.videos);
  if (picks.top.length === 0) throw new Error(NO_VIDEOS);
  const top = await readCaptions(deps, picks.top);
  // Writing chosen parts again rests on what is stored: nothing is downloaded, watched or measured.
  const deep =
    choices.parts === undefined
      ? await studyDeep(deps, picks, choices, tell)
      : storedStudies(deps, picks);
  if (choices.parts === undefined) await measureContrast(deps, picks, choices, tell);
  stopIfClosing(deps);
  const parts = await writeAll(deps, { channel: stored, picks, top, deep }, choices, (text) =>
    tell.say('writing', text),
  );
  tell.say('saving', 'Saving the breakdown as text files');
  const notSaved = await saveTexts(deps, stored);
  const breakdown = await deps.stored.view(stored);
  if (breakdown === null) throw new Error('The breakdown was written but could not be read back.');
  return {
    channel: { id: stored.id, title: stored.title },
    storedVideos: picks.storedVideos,
    top,
    deep,
    supply: tell.supplied(),
    ownVideosFolder: deps.files.ownFolder(),
    titles: picks.titles.length,
    parts,
    breakdown,
    notSaved,
  };
}
