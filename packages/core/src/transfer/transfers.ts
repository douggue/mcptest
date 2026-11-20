import { buildVideoReport } from '../report';
import type { FactsRepo, MapRepo, SavedIdea, TransferRepo, VideoRepo } from '../repos/types';
import { groupFormats, indexBySubject, oneWordVariants, type SubjectIndex } from './formats';
import { groupIdeas, isShared, type Idea, type TitledVideo } from './ideas';
import { isStrong, judge } from './opportunity';
import { inferOwnerPlace, placeOfChannel, type CentreChannel } from './ownerPlace';
import { placeForCountry, type Place } from './places';
import { placeResults } from './results';
import type {
  OwnerPlace,
  RecentVideo,
  TransferIdea,
  TransferList,
  TransferVariant,
  TransferVersion,
  VersionPlace,
} from './types';

/**
 * Niche transfer opportunities: ideas that are winning somewhere and are
 * open, weak or untried for the owner. Every recent video in the store is
 * grouped by its title template; a group made by several channels is one idea
 * with its versions side by side, and a title format used for several
 * subjects is listed as a format.
 */

/**
 * How far back videos are considered. Three months is what the owner counts
 * as "now" for a niche, and it bounds the work: a store keeps growing, the
 * last ninety days of it does not.
 */
export const TRANSFER_WINDOW_DAYS = 90;
/** Versions listed per idea: more than a card can show, so the rest are only counted. */
export const TRANSFER_VERSIONS_SHOWN = 12;
/** One-word-different titles listed beside an open idea: enough to judge, not a second list. */
export const TRANSFER_VARIANTS_SHOWN = 3;
/** The most ideas and formats handed over at once; the counts still cover them all. */
export const TRANSFER_MAX_IDEAS = 200;
export const TRANSFER_MAX_FORMATS = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TransferInput {
  /** Every recent video in the store. */
  readonly videos: readonly RecentVideo[];
  /** The place the owner makes videos for; null when it is not known. */
  readonly ownerPlace: OwnerPlace | null;
  /**
   * A channel's outlier scores by video id. Asked for once for each channel
   * that takes part in a shared idea, and for no other.
   */
  readonly scoresOf: (channelId: string) => ReadonlyMap<string, number | null>;
  readonly savedIdeas: readonly SavedIdea[];
}

type Scores = ReadonlyMap<string, ReadonlyMap<string, number | null>>;

/** The place a video was made for: the one its title names, else its channel's country. */
function placeOfVideo(entry: TitledVideo): VersionPlace | null {
  const named = entry.template.places[0];
  if (named) return { ...named, source: 'title' };
  const home = placeForCountry(entry.video.country);
  return home ? { ...home, source: 'channel' } : null;
}

function toVersion(entry: TitledVideo, scores: Scores, now: Date): TransferVersion {
  const { video } = entry;
  const score = scores.get(video.channelId)?.get(video.id) ?? null;
  return {
    videoId: video.id,
    title: video.title,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    subscribers: video.subscribers,
    place: placeOfVideo(entry),
    views: video.views,
    score,
    ageDays: Math.max(0, (now.getTime() - video.publishedAt.getTime()) / DAY_MS),
    durationSeconds: video.durationSeconds,
    strong: isStrong(video.views, score, video.subscribers),
  };
}

/** The titles one word away from an idea that were made for the owner's place. */
function ownVariants(
  index: SubjectIndex,
  idea: Idea,
  ownerPlace: Place,
): readonly TransferVariant[] {
  return oneWordVariants(index, idea.key)
    .filter((variant) => placeOfVideo(variant)?.key === ownerPlace.key)
    .slice(0, TRANSFER_VARIANTS_SHOWN)
    .map(({ video, word }) => ({
      videoId: video.id,
      title: video.title,
      channelTitle: video.channelTitle,
      views: video.views,
      word,
    }));
}

/**
 * The idea's title as shown: the template of its most viewed video that has
 * exactly the idea's words, so a tag one copy added is not shown as the idea.
 */
function shownTemplate(idea: Idea): string {
  const untagged = idea.videos.find((entry) => entry.template.words.join(' ') === idea.key);
  return untagged?.template.text ?? idea.key;
}

interface Context {
  readonly index: SubjectIndex;
  readonly scores: Scores;
  readonly ownerPlace: OwnerPlace | null;
  readonly savedKeys: ReadonlySet<string>;
  readonly now: Date;
}

function describeIdea(idea: Idea, context: Context): TransferIdea {
  const { ownerPlace } = context;
  const versions = idea.videos.map((entry) => toVersion(entry, context.scores, context.now));
  const verdict = judge(versions, ownerPlace);
  const placed = versions.flatMap((version) =>
    version.place ? [{ place: version.place, views: version.views }] : [],
  );
  return {
    key: idea.key,
    template: shownTemplate(idea),
    verdict,
    opportunity: verdict.status === 'open' || verdict.status === 'weak',
    versions: versions.slice(0, TRANSFER_VERSIONS_SHOWN),
    versionCount: versions.length,
    channelCount: new Set(versions.map((version) => version.channelId)).size,
    best: versions[0] ?? null,
    worst: versions.at(-1) ?? null,
    places: placeResults(placed),
    variants:
      verdict.status === 'open' && ownerPlace ? ownVariants(context.index, idea, ownerPlace) : [],
    saved: context.savedKeys.has(idea.key),
  };
}

/** A saved idea none of whose videos is recent enough to be listed any more. */
function goneIdea(saved: SavedIdea): TransferIdea {
  return {
    key: saved.key,
    template: saved.template,
    verdict: { status: 'gone', winner: null, own: null },
    opportunity: false,
    versions: [],
    versionCount: 0,
    channelCount: 0,
    best: null,
    worst: null,
    places: [],
    variants: [],
    saved: true,
  };
}

/**
 * An idea made for at least this many places has been shown to travel. One
 * made twice for the same place is a copy: it may be about that place (a news
 * story) and not carry over at all.
 */
export const TRAVELLED_MIN_PLACES = 2;

/**
 * Opportunities first: those shown to travel ahead of plain copies, the
 * biggest winner leading. Then the rest by their best result.
 */
function byPromise(a: TransferIdea, b: TransferIdea): number {
  const travelled = (idea: TransferIdea): number =>
    Number(idea.opportunity && idea.places.length >= TRAVELLED_MIN_PLACES);
  const lead = (idea: TransferIdea): number =>
    idea.opportunity ? (idea.verdict.winner?.views ?? 0) : (idea.best?.views ?? 0);
  return (
    Number(b.opportunity) - Number(a.opportunity) ||
    travelled(b) - travelled(a) ||
    lead(b) - lead(a) ||
    (a.key < b.key ? -1 : 1)
  );
}

/** Each taking-part channel's scores, asked for once. */
function scoresFor(ideas: readonly Idea[], input: TransferInput): Scores {
  const channelIds = new Set(ideas.flatMap((idea) => idea.videos.map((e) => e.video.channelId)));
  return new Map([...channelIds].map((id) => [id, input.scoresOf(id)]));
}

/** The transfer list from every recent video in the store. Nothing passed in is changed. */
export function buildTransferList(input: TransferInput, now: Date): TransferList {
  const all = groupIdeas(input.videos);
  const savedKeys = new Set(input.savedIdeas.map((saved) => saved.key));
  const shared = all.filter(isShared);
  const listed = all.filter((idea) => isShared(idea) || savedKeys.has(idea.key));
  const index = indexBySubject(all);
  const context: Context = {
    index,
    scores: scoresFor(listed, input),
    ownerPlace: input.ownerPlace,
    savedKeys,
    now,
  };
  const ideas = listed.map((idea) => describeIdea(idea, context)).sort(byPromise);
  const found = new Set(all.map((idea) => idea.key));
  const formats = groupFormats(index);
  return {
    ownerPlace: input.ownerPlace,
    windowDays: TRANSFER_WINDOW_DAYS,
    videosChecked: input.videos.length,
    ideas: [
      ...ideas.filter((idea, position) => position < TRANSFER_MAX_IDEAS || idea.saved),
      ...input.savedIdeas.filter((saved) => !found.has(saved.key)).map(goneIdea),
    ],
    ideaCount: shared.length,
    opportunityCount: ideas.filter((idea) => idea.opportunity).length,
    formats: formats.slice(0, TRANSFER_MAX_FORMATS),
    formatCount: formats.length,
  };
}

export interface TransferDeps {
  readonly transfers: TransferRepo;
  readonly videos: VideoRepo;
  readonly maps: MapRepo;
  /** Where channel countries from the official API are kept. Without it none is known. */
  readonly facts?: FactsRepo;
}

export interface TransferOptions {
  /** The owner's place, when they say it themselves; otherwise it is worked out. */
  readonly ownerPlace?: Place | null;
  /** The channel on screen: when its own place can be told, that is the owner's place. */
  readonly centerChannelId?: string | null;
}

/** The owner's place: the one given, else the channel on screen's, else the map centres'. */
function ownerPlaceOf(deps: TransferDeps, options: TransferOptions): OwnerPlace | null {
  if (options.ownerPlace) return { ...options.ownerPlace, source: 'given' };
  const describe = (channelId: string): CentreChannel => ({
    titles: deps.videos.listByChannel(channelId).map((video) => video.title),
    country: deps.facts?.find(channelId)?.country ?? null,
  });
  const onScreen = options.centerChannelId
    ? placeOfChannel(describe(options.centerChannelId))
    : null;
  if (onScreen) return onScreen;
  const madeAt = (channelId: string): number =>
    deps.maps.latestForCenter(channelId)?.createdAt.getTime() ?? 0;
  // The centre of the most recent map first: it decides when the centres disagree evenly.
  const centres = [...deps.maps.listCenterIds()].sort((a, b) => madeAt(b) - madeAt(a));
  return inferOwnerPlace(centres.map(describe));
}

/**
 * The transfer list over everything in the store, as it stands now. Only the
 * last 90 days of videos are read, as light rows; a channel's full video list
 * is loaded, for its scores, only when it takes part in a shared idea.
 */
export function loadTransferList(
  deps: TransferDeps,
  now: Date,
  options: TransferOptions = {},
): TransferList {
  const since = new Date(now.getTime() - TRANSFER_WINDOW_DAYS * DAY_MS);
  const scoresOf = (channelId: string): ReadonlyMap<string, number | null> =>
    new Map(
      buildVideoReport(deps.videos.listByChannel(channelId), now).map((row) => [row.id, row.score]),
    );
  return buildTransferList(
    {
      videos: deps.transfers.listRecentVideos(since),
      ownerPlace: ownerPlaceOf(deps, options),
      scoresOf,
      savedIdeas: deps.transfers.listSaved(),
    },
    now,
  );
}

/** An idea as it is saved: the key it is kept by and its title as shown. */
export interface RecentIdea {
  readonly key: string;
  readonly template: string;
}

/**
 * The idea with this key among the recent videos, or null when no recent
 * video has it. Used to check an idea exists before it is saved, and to keep
 * its title with the save.
 */
export function findRecentIdea(
  deps: Pick<TransferDeps, 'transfers'>,
  now: Date,
  key: string,
): RecentIdea | null {
  const since = new Date(now.getTime() - TRANSFER_WINDOW_DAYS * DAY_MS);
  const idea = groupIdeas(deps.transfers.listRecentVideos(since)).find(
    (candidate) => candidate.key === key,
  );
  return idea ? { key, template: shownTemplate(idea) } : null;
}
