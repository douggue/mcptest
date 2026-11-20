import type { TransferFormat, TransferIdea, TransferList, TransferVersion } from '@jgtube/core';
import { capped, oneDecimal, withoutAbsent } from './results';

/** Versions listed per idea: the winner, the owner's own and a few others say enough. */
const VERSIONS_PER_IDEA = 5;
/** Subjects listed per format. */
const SUBJECTS_PER_FORMAT = 5;

export type TransferView = 'opportunities' | 'formats' | 'saved' | 'all';

export interface TransferSummaryOptions {
  readonly show: TransferView;
  readonly limit: number;
}

const PLACE_UNKNOWN =
  'The owner’s place could not be told from their channel. Pass place to judge the ideas for it.';

/** The verdict on an idea as one sentence with its numbers. */
function verdictText(idea: TransferIdea, list: TransferList): string {
  const { status, winner, own } = idea.verdict;
  const place = list.ownerPlace?.name ?? 'the owner’s place';
  const elsewhere = winner
    ? `the ${winner.place?.name ?? 'other'} version got ${winner.views}`
    : '';
  switch (status) {
    case 'open':
      return `Not done for ${place} yet; ${elsewhere} views.`;
    case 'weak':
      return `The ${place} version got ${own?.views ?? 0} views; ${elsewhere}.`;
    case 'done':
      return `Already done for ${place}: its version got ${own?.views ?? 0} views.`;
    case 'unproven':
      return 'No version took off anywhere.';
    case 'gone':
      return `Saved, but none of its videos is from the last ${list.windowDays} days any more.`;
    default:
      return 'Cannot be judged: the place of the owner or of a version is not known.';
  }
}

function versionEntry(version: TransferVersion): Record<string, unknown> {
  return withoutAbsent({
    video: version.videoId,
    place: version.place?.name ?? null,
    channel: version.channelTitle,
    subs: version.subscribers,
    views: version.views,
    score: version.score === null ? null : oneDecimal(version.score),
    ageDays: Math.round(version.ageDays),
    tookOff: version.strong ? true : null,
  });
}

function ideaEntry(idea: TransferIdea, list: TransferList): Record<string, unknown> {
  const shown = idea.versions.slice(0, VERSIONS_PER_IDEA);
  const unlisted = idea.versionCount - shown.length;
  return withoutAbsent({
    key: idea.key,
    title: idea.template,
    status: idea.verdict.status,
    verdict: verdictText(idea, list),
    places: idea.places.length > 0 ? idea.places.map((place) => place.name) : null,
    channels: idea.channelCount > 0 ? idea.channelCount : null,
    versions: shown.length > 0 ? shown.map(versionEntry) : null,
    moreVersions: unlisted > 0 ? unlisted : null,
    oneWordOff:
      idea.variants.length > 0
        ? idea.variants.map((variant) => ({
            video: variant.videoId,
            title: variant.title,
            channel: variant.channelTitle,
            views: variant.views,
            word: variant.word,
          }))
        : null,
    saved: idea.saved ? true : null,
  });
}

function formatEntry(format: TransferFormat): Record<string, unknown> {
  return withoutAbsent({
    title: format.template,
    subjects: format.subjectCount,
    channels: format.channelCount,
    videos: format.videoCount,
    bestViews: format.bestViews,
    medianViews: Math.round(format.medianViews),
    places: format.places.length > 0 ? format.places.map((place) => place.name) : null,
    top: format.subjects.slice(0, SUBJECTS_PER_FORMAT).map((subject) => ({
      subject: subject.subject,
      views: subject.bestViews,
      video: subject.videoId,
      uses: subject.videos,
    })),
  });
}

/** The ideas a view shows: the opportunities, the saved ones, or all of them. */
function ideasFor(list: TransferList, show: TransferView): readonly TransferIdea[] {
  if (show === 'saved') return list.ideas.filter((idea) => idea.saved);
  return show === 'all' ? list.ideas : list.ideas.filter((idea) => idea.opportunity);
}

/** The transfer list in as few characters as carry its meaning. */
export function summarizeTransfers(
  list: TransferList,
  options: TransferSummaryOptions,
): Record<string, unknown> {
  const entries =
    options.show === 'formats'
      ? list.formats.map(formatEntry)
      : ideasFor(list, options.show).map((idea) => ideaEntry(idea, list));
  const { shown, more } = capped(entries, options.limit);
  return {
    ...(list.ownerPlace
      ? { place: list.ownerPlace.name, placeFrom: list.ownerPlace.source }
      : { placeUnknown: PLACE_UNKNOWN }),
    windowDays: list.windowDays,
    videos: list.videosChecked,
    ideas: list.ideaCount,
    opportunities: list.opportunityCount,
    formats: list.formatCount,
    show: options.show,
    shown: shown.length,
    ...(more > 0 ? { more } : {}),
    list: shown,
  };
}
