import type {
  BoardVideo,
  OwnerPlace,
  TransferFormat,
  TransferIdea,
  TransferList,
  TransferStatus,
  TransferVersion,
} from '@jgtube/core';
import { formatAge, formatCount } from './format';

/** 'opportunities': ideas open or weak for the owner's place. 'saved': the ones the owner kept. */
export type TransferFilter = 'opportunities' | 'formats' | 'saved';

export const TRANSFER_FILTERS: readonly {
  readonly id: TransferFilter;
  readonly label: string;
}[] = [
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'formats', label: 'Formats' },
  { id: 'saved', label: 'Saved' },
];

/**
 * The name of a view on its button. Saved carries how many ideas are in it,
 * so an idea that leaves the list when it is saved is seen to have gone there.
 */
export function filterLabel(
  filter: TransferFilter,
  list: { readonly ideas: ReadonlyArray<Pick<TransferIdea, 'saved'>> } | null,
): string {
  const label = TRANSFER_FILTERS.find((option) => option.id === filter)?.label ?? '';
  const saved = filter === 'saved' ? (list?.ideas.filter((idea) => idea.saved).length ?? 0) : 0;
  return saved > 0 ? `${label} · ${saved}` : label;
}

/** Ideas and formats shown before "show more". */
export const TRANSFER_PAGE_SIZE = 6;

/**
 * The ideas a view shows; the formats view shows none. An idea the owner saved
 * is shown under "Saved" and nowhere else: they have already taken it up, so
 * the opportunities are what they have not decided on yet. Unsaving brings it back.
 */
export function ideasFor(list: TransferList, filter: TransferFilter): readonly TransferIdea[] {
  if (filter === 'formats') return [];
  return list.ideas.filter((idea) =>
    filter === 'saved' ? idea.saved : idea.opportunity && !idea.saved,
  );
}

/**
 * The formats the formats view shows: each without the subjects whose ideas
 * the owner has all saved, and with its counts lowered to match. A format with
 * no subject left is not shown. Every saved idea is in `list.ideas`, so none
 * is missed. The channel count is left as it is: which channels made the
 * subjects taken out cannot be told from here.
 */
export function formatsFor(list: TransferList): readonly TransferFormat[] {
  const savedKeys = new Set(list.ideas.filter((idea) => idea.saved).map((idea) => idea.key));
  if (savedKeys.size === 0) return list.formats;
  return list.formats.flatMap((format): TransferFormat[] => {
    const isSaved = (subject: TransferFormat['subjects'][number]): boolean =>
      subject.ideaKeys.length > 0 && subject.ideaKeys.every((key) => savedKeys.has(key));
    const hidden = format.subjects.filter(isSaved);
    if (hidden.length === 0) return [format];
    if (hidden.length === format.subjects.length) return [];
    return [
      {
        ...format,
        subjects: format.subjects.filter((subject) => !isSaved(subject)),
        subjectCount: format.subjectCount - hidden.length,
        videoCount: format.videoCount - hidden.reduce((sum, subject) => sum + subject.videos, 0),
      },
    ];
  });
}

/** The same list with one idea marked as saved or not. */
export function withSaved(list: TransferList, key: string, saved: boolean): TransferList {
  return {
    ...list,
    ideas: list.ideas.map((idea) => (idea.key === key ? { ...idea, saved } : idea)),
  };
}

const STATUS_LABEL: Readonly<Record<TransferStatus, string>> = {
  open: 'Untried',
  weak: 'Weak version',
  done: 'Already done',
  unproven: 'Unproven',
  unplaced: 'Cannot tell',
  gone: 'No longer recent',
};

export const statusLabel = (status: TransferStatus): string => STATUS_LABEL[status];

const possessive = (name: string): string => (name.endsWith('s') ? `${name}’` : `${name}’s`);
const NO_OWNER_PLACE =
  'Jgtube cannot tell which country your channel is for, so it cannot say whether this is open to you.';

/** An untried or weak idea in words, by titles' places or by the channels' countries. */
function describeOpening(
  own: TransferVersion | null,
  winner: TransferVersion,
  place: string,
): string {
  const elsewhere = winner.place?.name ?? 'another country';
  const views = formatCount(winner.views);
  if (winner.place?.source === 'channel') {
    return own
      ? `A channel from ${place} got ${formatCount(own.views)} views with it; one from ${elsewhere} got ${views}.`
      : `No channel from ${place} has made it yet. One from ${elsewhere} got ${views} views.`;
  }
  return own
    ? `The ${place} version got ${formatCount(own.views)} views; ${possessive(elsewhere)} got ${views}.`
    : `Not done for ${place} yet. ${possessive(elsewhere)} got ${views} views.`;
}

/** Where an idea stands for the owner's place, in a sentence with its numbers. */
export function describeVerdict(idea: TransferIdea, ownerPlace: OwnerPlace | null): string {
  const { status, winner, own } = idea.verdict;
  if (status === 'gone') return 'None of its videos is from the last three months any more.';
  if (ownerPlace === null) return NO_OWNER_PLACE;
  const place = ownerPlace.name;
  if ((status === 'open' || status === 'weak') && winner) {
    return describeOpening(status === 'weak' ? own : null, winner, place);
  }
  if (status === 'done') {
    return own
      ? `Already done for ${place}: its version got ${formatCount(own.views)} views.`
      : `Already done for ${place}.`;
  }
  if (status === 'unproven') return 'No version has taken off yet.';
  return `It took off, but the country of one of the channels is not known, so it cannot be called untried for ${place}.`;
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** How many versions an idea has, from how many channels, for how many places. */
export function describeIdeaReach(idea: TransferIdea): string {
  const made = `${count(idea.versionCount, 'version')} from ${count(idea.channelCount, 'channel')}`;
  return idea.places.length > 0 ? `${made} · made for ${count(idea.places.length, 'place')}` : made;
}

/** How widely a title format is used. */
export function describeFormat(format: TransferFormat): string {
  return [
    count(format.subjectCount, 'subject'),
    count(format.channelCount, 'channel'),
    count(format.videoCount, 'video'),
  ].join(' · ');
}

const PLACE_FROM: Readonly<Record<OwnerPlace['source'], string | null>> = {
  titles: 'your channel’s titles',
  country: 'your channel’s country',
  given: null,
};

/** In words, what the section holds and which place it was judged for. */
export function describeTransfers(list: TransferList): string {
  const shared = `that two or more channels made in the last ${list.windowDays} days`;
  if (list.ideaCount === 0) {
    return `No idea has been made by two or more of the channels Jgtube has read in the last ${list.windowDays} days.`;
  }
  if (list.ownerPlace === null) {
    return `Jgtube cannot tell which country your channel is for, so it cannot say which of the ${list.ideaCount} ideas ${shared} are open to you.`;
  }
  const { name, source } = list.ownerPlace;
  // Saved ideas are shown under "Saved" only, so the count is of the rest.
  const saved = list.ideas.filter((idea) => idea.saved);
  const open = openCount(list);
  const one = open === 1;
  const from = PLACE_FROM[source];
  return [
    `${open} ${one ? 'idea' : 'ideas'} took off for another country and ${one ? 'is' : 'are'} untried or weak for ${name},`,
    `out of ${list.ideaCount} ${shared}.`,
    ...(saved.length > 0
      ? [`The ${saved.length} you saved ${saved.length === 1 ? 'is' : 'are'} under Saved.`]
      : []),
    ...(from ? [`Jgtube took ${name} from ${from}.`] : []),
  ].join(' ');
}

/**
 * How many opportunities the owner has not saved. Every saved idea is in
 * `list.ideas`, so the saved ones can be taken off the count of them all.
 */
function openCount(list: TransferList): number {
  const savedOpen = list.ideas.filter((idea) => idea.saved && idea.opportunity).length;
  return Math.max(0, list.opportunityCount - savedOpen);
}

/** Why a view has nothing in it, in the owner's terms. */
export function emptyTransfers(list: TransferList, filter: TransferFilter): string {
  if (filter === 'saved')
    return 'You have not saved an idea yet. Press Save on one to keep it here.';
  if (filter === 'formats') {
    return list.formats.length > 0
      ? 'Every format found is made of ideas you saved. They are under Saved; stop saving one to bring its format back here.'
      : 'No title format is used for three or more subjects by two or more channels yet.';
  }
  if (list.ownerPlace === null) {
    return 'Nothing can be called open until Jgtube knows which country your channel is for.';
  }
  if (list.opportunityCount > 0 && openCount(list) === 0) {
    return `Every idea open for ${list.ownerPlace.name} is one you saved. They are under Saved; stop saving one to bring it back here.`;
  }
  return `None of the ${list.ideaCount} ideas is open for ${list.ownerPlace.name} right now: each was already done there or has not taken off anywhere.`;
}

/** One piece of a template: words as written, or a slot to draw as a chip. */
export type TemplatePart = { readonly text: string } | { readonly slot: string };

const SLOT_NAMES: Readonly<Record<string, string>> = {
  '{place}': 'Country',
  '{n}': 'Number',
  '{subject}': 'Subject',
};
const SLOT = /(\{place\}|\{n\}|\{subject\})/;

/** A template cut into its words and its slots, in order, so the slots can be drawn as chips. */
export function templateParts(template: string): readonly TemplatePart[] {
  return template
    .split(SLOT)
    .filter((piece) => piece.length > 0)
    .map((piece) => {
      const slot = SLOT_NAMES[piece];
      return slot ? { slot } : { text: piece };
    });
}

/** A version as a thumbnail tile shows it. */
export function tileOf(version: TransferVersion): BoardVideo {
  return {
    videoId: version.videoId,
    title: version.title,
    views: version.views,
    score: version.score,
    publishedRaw: `${formatAge(version.ageDays)} ago`,
    ageDays: version.ageDays,
    durationSeconds: version.durationSeconds,
  };
}
