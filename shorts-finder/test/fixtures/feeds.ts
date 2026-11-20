/**
 * Hand-written Atom documents shaped like YouTube's public upload feeds, as
 * seen by hand on two channels. Nothing here was recorded: every id, title
 * and number is made up, and the titles are from unrelated subjects (paper
 * craft, baking, astronomy, bicycle repair, bird watching).
 */
import { channelId, videoId } from './apiReplies';

export interface FeedEntryOptions {
  /** Written into the document as it stands: may hold character codes or CDATA. */
  readonly title?: string;
  readonly published?: string;
  /** Null leaves the statistics out. */
  readonly views?: number | null;
  /** `none` leaves the link out. */
  readonly link?: 'shorts' | 'watch' | 'none';
  /** Replaces the video id, for entries that should not be believed. */
  readonly rawVideoId?: string;
  /** The channel the entry claims; the feed's own unless given. */
  readonly channelLetter?: string;
}

const TITLES = [
  'Folding a paper crane in 40 seconds',
  'Three-ingredient flatbread and a hot pan',
  'Why the moon looks bigger at the horizon',
  'Fixing a slipping bicycle chain',
  'A wren builds its nest in a boot',
] as const;

const linkOf = (id: string, kind: 'shorts' | 'watch'): string =>
  kind === 'shorts'
    ? `https://www.youtube.com/shorts/${id}`
    : `https://www.youtube.com/watch?v=${id}`;

export function feedEntry(n: number, letter: string, options: FeedEntryOptions = {}): string {
  const id = options.rawVideoId ?? videoId(n);
  const link = options.link ?? 'shorts';
  const views = options.views === undefined ? 1000 * n : options.views;
  return [
    ' <entry>',
    `  <id>yt:video:${id}</id>`,
    `  <yt:videoId>${id}</yt:videoId>`,
    `  <yt:channelId>${channelId(options.channelLetter ?? letter)}</yt:channelId>`,
    `  <title>${options.title ?? TITLES[n % TITLES.length]}</title>`,
    ...(link === 'none' ? [] : [`  <link rel="alternate" href="${linkOf(id, link)}"/>`]),
    '  <author>',
    `   <name>Channel ${letter}</name>`,
    `   <uri>https://www.youtube.com/channel/${channelId(letter)}</uri>`,
    '  </author>',
    `  <published>${options.published ?? '2026-11-20T18:00:00+00:00'}</published>`,
    '  <updated>2026-11-20T19:10:00+00:00</updated>',
    '  <media:group>',
    `   <media:title>${options.title ?? TITLES[n % TITLES.length]}</media:title>`,
    `   <media:content url="https://www.youtube.com/v/${id}?version=3" type="application/x-shockwave-flash" width="640" height="390"/>`,
    '   <media:community>',
    '    <media:starRating count="12" average="5.00" min="1" max="5"/>',
    ...(views === null ? [] : [`    <media:statistics views="${views}"/>`]),
    '   </media:community>',
    '  </media:group>',
    ' </entry>',
  ].join('\n');
}

/** A whole feed for a channel, holding the given entries. */
export function feedXml(letter: string, entries: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">',
    ` <link rel="self" href="https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${letter.repeat(22)}"/>`,
    ` <id>yt:playlist:UUSH${letter.repeat(22)}</id>`,
    ` <yt:playlistId>UUSH${letter.repeat(22)}</yt:playlistId>`,
    ` <yt:channelId>${letter.repeat(22)}</yt:channelId>`,
    ` <title>Channel ${letter} - Shorts</title>`,
    ' <author>',
    `  <name>Channel ${letter}</name>`,
    `  <uri>https://www.youtube.com/channel/${channelId(letter)}</uri>`,
    ' </author>',
    ' <published>2026-09-01T10:00:00+00:00</published>',
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}
