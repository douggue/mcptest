import { CHANNEL_IMAGE_RULE, isPinnedImageUrl } from './images';
import { asArray, at, isRecord, textOf } from './mappers';
import type { BrandImage, ChannelBrand } from './types';

/**
 * Reads how a channel presents itself (logo, cover, bio, keywords, links) from
 * the channel page the source already fetches. Untrusted like everything else
 * from that page: text is cut to a bound, and a picture is kept only when its
 * address is on the host channel images are served from.
 */

/** YouTube's own limit on a channel description. */
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_KEYWORDS = 60;
const MAX_KEYWORD_LENGTH = 100;
const MAX_IMAGES = 12;
const MAX_IMAGE_SIDE = 10_000;
const MAX_LINKS = 5;
/** A quoted phrase or a run of characters without a space. */
const KEYWORD = /"([^"]+)"|(\S+)/g;

function sideOf(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_IMAGE_SIDE
    ? value
    : null;
}

/** The pictures in the lists that are on the channel image host, largest first, each size of each once. */
function imagesOf(...lists: readonly unknown[]): readonly BrandImage[] {
  const images = lists.flatMap(asArray).flatMap((entry): BrandImage[] => {
    const url = at(entry, 'url');
    const width = sideOf(at(entry, 'width'));
    const height = sideOf(at(entry, 'height'));
    if (typeof url !== 'string' || width === null || height === null) return [];
    return isPinnedImageUrl(url, CHANNEL_IMAGE_RULE) ? [{ url, width, height }] : [];
  });
  const unique = [
    ...new Map(images.map((image) => [`${image.width} ${image.url}`, image])).values(),
  ];
  return unique.sort((a, b) => b.width - a.width).slice(0, MAX_IMAGES);
}

/** The owner's keywords: a list, or one string in which a quoted phrase is one keyword. */
export function parseKeywords(value: unknown): readonly string[] {
  const words = Array.isArray(value)
    ? value.filter((word): word is string => typeof word === 'string')
    : typeof value === 'string'
      ? [...value.matchAll(KEYWORD)].map((match) => match[1] ?? match[2] ?? '')
      : [];
  return words
    .map((word) => word.trim().slice(0, MAX_KEYWORD_LENGTH))
    .filter((word) => word !== '')
    .slice(0, MAX_KEYWORDS);
}

/**
 * The bio: the full description when the page's metadata carries one (an
 * empty string there means the channel has none), else the header's preview.
 */
function descriptionOf(header: unknown, metadata: unknown): string | null {
  const full = at(metadata, 'description');
  if (typeof full === 'string') return full.slice(0, MAX_DESCRIPTION_LENGTH);
  return textOf(at(header, 'content', 'description', 'description'));
}

/** The link the header shows, and the note beside it saying how many more there are. */
function linksOf(header: unknown): readonly string[] {
  const shown = at(header, 'content', 'attributation');
  if (!isRecord(shown)) return [];
  return [textOf(shown['text']), textOf(shown['suffix'])]
    .filter((text): text is string => text !== null)
    .slice(0, MAX_LINKS);
}

/** How a channel presents itself. Every part that cannot be read is empty; nothing throws. */
export function mapChannelBrand(header: unknown, metadata: unknown): ChannelBrand {
  return {
    description: descriptionOf(header, metadata),
    avatar: imagesOf(
      at(metadata, 'avatar'),
      at(metadata, 'thumbnail'),
      at(header, 'content', 'image', 'avatar', 'image'),
    ),
    banner: imagesOf(at(header, 'content', 'banner', 'image')),
    keywords: parseKeywords(at(metadata, 'keywords')),
    links: linksOf(header),
  };
}
