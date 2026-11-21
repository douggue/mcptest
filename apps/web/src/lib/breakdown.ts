import type { AnyEngineId } from './analyses';
import type { BreakdownView, PartRun } from './breakdownParts';

/**
 * A channel breakdown as the page reads it: the job's steps while it runs,
 * and, when it is done, the text with how each studied video went. The shapes
 * are the server's.
 */

/** A video whose file could not be had, which the owner can supply themselves. */
export interface VideoToSupply {
  readonly videoId: string;
  readonly title: string;
  readonly reason: string;
}

export interface BreakdownProgress {
  readonly step: string;
  /** The step in plain words. */
  readonly text: string;
  readonly supply: readonly VideoToSupply[];
}

export type StudyResult =
  | { readonly done: true; readonly by: string; readonly kept: boolean }
  | { readonly done: false; readonly reason: string };

export type FrameStudyResult =
  | {
      readonly done: true;
      readonly by: string;
      readonly kept: boolean;
      readonly source: 'file' | 'preview' | null;
      readonly available: number | null;
    }
  | { readonly done: false; readonly reason: string };

export interface StudiedVideo {
  readonly videoId: string;
  readonly title: string;
  readonly file:
    { readonly used: 'own' | 'downloaded' } | { readonly used: 'none'; readonly reason: string };
  readonly watch: StudyResult;
  readonly frames: FrameStudyResult;
}

export interface TopVideo {
  readonly videoId: string;
  readonly title: string;
  readonly captions: 'read' | 'none' | 'failed';
  /** The words its captions hold, counted by the server; null without captions. */
  readonly words: number | null;
  readonly wordsPerMinute: number | null;
}

export interface BreakdownOutcome {
  readonly channel: { readonly id: string; readonly title: string };
  readonly storedVideos: number;
  readonly top: readonly TopVideo[];
  readonly deep: readonly StudiedVideo[];
  readonly supply: readonly VideoToSupply[];
  /** The folder the owner's own files go in; null when there is nowhere to save. */
  readonly ownVideosFolder: string | null;
  /** How many titles the title study rests on. */
  readonly titles: number;
  /** How writing each part went in this run. */
  readonly parts: readonly PartRun[];
  /** The breakdown as it is now stored. */
  readonly breakdown: BreakdownView;
  /** Why the text files could not be saved; null when they were. */
  readonly notSaved: string | null;
}

export interface BreakdownJobState {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: BreakdownProgress | null;
  readonly result: BreakdownOutcome | null;
  readonly error: string | null;
}

/** Where one video file sent from the page was saved. */
export interface UploadedVideo {
  readonly video: string;
  readonly bytes: number;
  readonly file: string;
  readonly folder: string;
}

/** Where a channel's transcripts were saved on this computer, and how it went. */
export interface TranscriptsSaved {
  readonly channel: string;
  readonly folder: string;
  readonly indexFile: string;
  readonly saved: number;
  readonly noCaptions: number;
  readonly failed: number;
}

/** Said beside the button, before it is pressed: a breakdown is not a quick answer. */
export const SLOW_NOTE =
  'This is slow. It studies the titles and the top five videos, three of them in depth, then writes the seven parts, and can take half an hour or more. Keep this page open.';

/** Where a channel offered for a breakdown comes from; the list is set out under these. */
export const CHOICE_GROUPS = [
  { id: 'map', label: 'This map' },
  { id: 'saved', label: 'Your other channels' },
  { id: 'watched', label: 'Niches you are watching' },
  { id: 'niches', label: 'New niches' },
] as const;
export type ChoiceGroup = (typeof CHOICE_GROUPS)[number]['id'];

/** One channel the owner can pick to break down. */
export interface ChannelChoice {
  readonly id: string;
  /** The channel's own name. */
  readonly title: string;
  /** The name as the list shows it, saying which channel is the owner's or their model. */
  readonly label: string;
  readonly group: ChoiceGroup;
}

/** The channels from outside the map on screen that can be broken down too. */
export interface OtherChannels {
  /** Every channel a map was made for. */
  readonly saved: readonly Named[];
  /** The niche list: new or small channels with a video that took off. */
  readonly niches: ReadonlyArray<Named & { readonly watched: boolean }>;
}

interface Named {
  readonly id: string;
  readonly title: string;
}

/** The parts of the map on screen the choices are made from. */
export interface MapChannels {
  readonly center: Named;
  readonly model: Named | null;
  readonly channels: ReadonlyArray<Named & { readonly peer: boolean; readonly removed: boolean }>;
}

const NO_OTHERS: OtherChannels = { saved: [], niches: [] };

/** Channels as choices of one group, by name. */
const choicesOf = (channels: readonly Named[], group: ChoiceGroup): readonly ChannelChoice[] =>
  channels
    .map(({ id, title }) => ({ id, title, label: title, group }))
    .sort((a, b) => a.label.localeCompare(b.label));

/**
 * The channels offered for a breakdown. From the map on screen: the model
 * channel when the owner named one, the owner's own channel, then the
 * look-alikes by name. Then the owner's other saved channels, the niches
 * they are watching, and the rest of the niche list. A channel is listed
 * once, under the first of those it is.
 */
export function breakdownChoices(
  map: MapChannels,
  others: OtherChannels = NO_OTHERS,
): readonly ChannelChoice[] {
  const { center, model } = map;
  const lookalikes = map.channels.filter((channel) => channel.peer && !channel.removed);
  const own = (channel: Named, label: string): ChannelChoice => ({
    id: channel.id,
    title: channel.title,
    label,
    group: 'map',
  });
  const all: readonly ChannelChoice[] = [
    ...(model ? [own(model, `Your model: ${model.title}`)] : []),
    own(center, `Your channel: ${center.title}`),
    ...choicesOf(lookalikes, 'map'),
    ...choicesOf(others.saved, 'saved'),
    ...choicesOf(
      others.niches.filter((channel) => channel.watched),
      'watched',
    ),
    ...choicesOf(
      others.niches.filter((channel) => !channel.watched),
      'niches',
    ),
  ];
  return all.filter((choice, index) => all.findIndex((other) => other.id === choice.id) === index);
}

/** The choices set out under the groups that have any, in the groups' order. */
export function groupChoices(
  choices: readonly ChannelChoice[],
): ReadonlyArray<{ readonly label: string; readonly choices: readonly ChannelChoice[] }> {
  return CHOICE_GROUPS.map((group) => ({
    label: group.label,
    choices: choices.filter((choice) => choice.group === group.id),
  })).filter((group) => group.choices.length > 0);
}

/** The names a creator knows the engines by. */
const ENGINE_NAMES: Readonly<Record<AnyEngineId, string>> = {
  agy: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  'gemini-api': 'the Gemini API',
};

/** An engine by the name a creator knows it by; an id nobody has named is given as it is. */
export const engineName = (id: string): string =>
  (ENGINE_NAMES as Record<string, string>)[id] ?? id;
const nameOf = engineName;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** What the breakdown rests on, in one line: how many titles and videos out of how many, and their captions. */
export function restsOn(outcome: BreakdownOutcome): string {
  const { top, deep, storedVideos } = outcome;
  if (top.length === 0) return 'Jgtube has no videos stored for this channel.';
  const silent = top.filter((video) => video.captions === 'none').length;
  const unread = top.filter((video) => video.captions === 'failed').length;
  return [
    `Rests on ${plural(outcome.titles, 'title')} and the channel’s top ${plural(top.length, 'video')} out of ${storedVideos} stored, ${deep.length} of them studied in depth.`,
    ...(silent > 0
      ? [`${silent} of the ${top.length} ${silent === 1 ? 'has' : 'have'} no captions.`]
      : []),
    ...(unread > 0 ? [`The captions of ${unread} could not be read this time.`] : []),
  ].join(' ');
}

const kept = (wasKept: boolean): string => (wasKept ? ', kept from an earlier breakdown' : '');

function watchedPart(watch: StudyResult): string {
  return watch.done
    ? `Watched by ${nameOf(watch.by)}${kept(watch.kept)}.`
    : `Not watched: ${watch.reason}`;
}

function framesPart(frames: FrameStudyResult): string {
  if (!frames.done) return `Frames not studied: ${frames.reason}`;
  const count = frames.available === null ? 'its frames' : `${frames.available} frames`;
  const from =
    frames.source === 'file'
      ? ' cut from the video file, one a second'
      : frames.source === 'preview'
        ? ' from YouTube’s own preview (small, several seconds apart)'
        : '';
  return `Frames studied by ${nameOf(frames.by)}: ${count}${from}${kept(frames.kept)}.`;
}

/** One line for each video studied in depth: whether it was watched and by whom, and its frames. */
export function studiedLines(outcome: BreakdownOutcome): readonly string[] {
  return outcome.deep.map(
    (video) => `“${video.title}”. ${watchedPart(video.watch)} ${framesPart(video.frames)}`,
  );
}

/** Where the owner's own files go, for someone who would sooner copy a file there by hand. */
export function folderNote(folder: string | null): string {
  return folder === null
    ? ''
    : `Or copy the file yourself into ${folder}, with the video’s id (the letters after “v=” in its link) somewhere in the file’s name.`;
}

const BYTES_PER_MB = 1_000_000;
const BYTES_PER_GB = 1_000_000_000;

/** A file's size as a person reads it: "850 KB", "12.4 MB", "1.3 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= BYTES_PER_GB) return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
  if (bytes >= BYTES_PER_MB) return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** How far a file being sent has got, in words. */
export function sendingText(fraction: number): string {
  const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)));
  return percent >= 100 ? 'Sent. Checking the file…' : `Sending the file: ${percent}%`;
}

/** What to say once a file has been saved. */
export const savedText = (saved: UploadedVideo): string =>
  `Saved (${formatBytes(saved.bytes)}). Jgtube keeps it until you delete it. Run the breakdown again to use it.`;

/** Where a channel's transcripts were saved and how it went, for the owner to read. */
export function describeTranscripts(result: TranscriptsSaved): string {
  const { saved, noCaptions, failed } = result;
  if (saved === 0 && noCaptions === 0 && failed === 0) {
    return 'None of this channel’s videos has taken off yet, so there are no transcripts to save.';
  }
  const where =
    saved === 0
      ? 'No transcript could be saved.'
      : `${plural(saved, 'transcript')} saved in ${result.folder}, with an index.json saying what each one is.`;
  const silent =
    noCaptions === 0
      ? ''
      : ` ${plural(noCaptions, 'video')} ${noCaptions === 1 ? 'has' : 'have'} no captions.`;
  const missed = failed === 0 ? '' : ` ${failed} could not be read; press again to try once more.`;
  return `${where}${silent}${missed}`;
}
