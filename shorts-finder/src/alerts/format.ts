/**
 * The words of every message the owner gets: one for each finding, the daily
 * summary, and the daily line that says the service is still running.
 *
 * Nothing here sends anything or reads a clock. Everything from YouTube
 * (titles, channel names, the rules' own sentences) is capped and escaped on
 * its way in, and links are made only from ids of the right shape.
 */
import type { QuotaKind } from '../quota/kinds';
import type { Finding } from '../repos/types';
import { DEFAULT_ENGAGED_SHARE, estimateShortsEarnings, type RateRange } from '../scoring/earnings';
import {
  ageInWords,
  channelUrl,
  compactNumber,
  dollars,
  link,
  rateDollars,
  safe,
  shortsUrl,
  sizeInWords,
  truncateHtml,
  wholeNumber,
} from './text';

const MAX_TITLE = 200;
const MAX_CHANNEL_NAME = 100;
const MAX_WHY_LINES = 6;
const MAX_WHY_LINE = 300;
const MAX_KEYWORD = 100;
const MAX_REGION = 10;
const MAX_ERROR = 300;
/** How many of the findings left out of the alerts the summary lists. */
export const DIGEST_TOP = 5;
const MAX_DIGEST_TITLE = 80;
const MAX_DIGEST_CHANNEL = 40;

const HEADINGS: Readonly<Record<Finding['kind'], string>> = {
  niche: 'New find: a small channel with a Short taking off',
  transfer: 'New find: an idea that is working elsewhere',
};

export interface FindingContext {
  readonly now: Date;
  /** The configured Shorts rate, in dollars per 1,000 views. */
  readonly rate: RateRange;
  /** The share of counted views taken as paid for; every view when not given. */
  readonly engagedShare?: number | undefined;
}

const channelName = (finding: Finding, max: number): string =>
  finding.channelTitle === null ? 'a channel with no name' : safe(finding.channelTitle, max);

function whyLines(finding: Finding): readonly string[] {
  const lines = finding.reason.why
    .map((line) => safe(line, MAX_WHY_LINE))
    .filter((line) => line !== '')
    .slice(0, MAX_WHY_LINES);
  const shown = lines.length === 0 ? ['The reason was not recorded.'] : lines;
  return shown.map((line) => `• ${line}`);
}

function channelLine(finding: Finding, now: Date): string | null {
  const { subscribers, channelCreatedAt } = finding.reason;
  const parts = [
    subscribers === null ? null : `${compactNumber(subscribers)} subscribers`,
    channelCreatedAt === null ? null : `started ${ageInWords(channelCreatedAt, now)} ago`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : `Channel: ${parts.join(', ')}`;
}

const PERCENT = 100;

/**
 * The stored range, or one worked out from the views when none was stored.
 * With every counted view taken as paid for the range is the most the views
 * could be worth, and the line says "up to"; with a smaller share it says
 * which share was counted.
 */
function earningsLine(finding: Finding, context: FindingContext): string | null {
  const { rate } = context;
  const share = context.engagedShare ?? DEFAULT_ENGAGED_SHARE;
  const views = finding.reason.totalViews;
  const stored =
    finding.earningsLow !== null && finding.earningsHigh !== null
      ? { low: finding.earningsLow, high: finding.earningsHigh }
      : null;
  const range =
    stored ?? (views === null ? null : estimateShortsEarnings(views, null, rate, share));
  if (range === null) return null;
  const at = `at ${rateDollars(rate.low)} to ${rateDollars(rate.high)} per 1,000 views`;
  const amount = `${dollars(range.low)} to ${dollars(range.high)}`;
  return share === 1
    ? `Could have earned so far: up to ${amount} (${at}, if every counted view is paid for)`
    : `Could have earned so far: ${amount} (${at}, counting ${Math.round(share * PERCENT)}% of views as paid for)`;
}

function sourceLine(finding: Finding): string | null {
  const { subjectKeyword, subjectRegion, channelCountry } = finding.reason;
  const where = subjectRegion === null ? '' : ` in ${safe(subjectRegion, MAX_REGION)}`;
  const parts = [
    subjectKeyword === null
      ? null
      : `Found by searching "${safe(subjectKeyword, MAX_KEYWORD)}"${where}`,
    channelCountry === null ? null : `channel based in ${safe(channelCountry, MAX_REGION)}`,
  ].filter((part) => part !== null);
  const line = parts.join(' · ');
  return line === '' ? null : `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

function numberLines(finding: Finding, context: FindingContext): readonly string[] {
  const views = finding.reason.totalViews;
  const lines = [
    `Views per hour: ${finding.viewsPerHour === null ? 'not measured yet' : compactNumber(finding.viewsPerHour)}`,
    views === null ? null : `Total views: ${compactNumber(views)}`,
    `Posted: ${ageInWords(finding.publishedAt, context.now)} ago`,
    channelLine(finding, context.now),
    earningsLine(finding, context),
    sourceLine(finding),
  ];
  return lines.filter((line) => line !== null);
}

const linksLine = (finding: Finding): string =>
  [
    link(shortsUrl(finding.videoId), 'Watch the Short'),
    link(channelUrl(finding.channelId), 'Open the channel'),
  ].join(' · ');

/** The message for one finding. */
export function formatFinding(finding: Finding, context: FindingContext): string {
  const lines = [
    `<b>${HEADINGS[finding.kind]}</b>`,
    `<b>${safe(finding.videoTitle, MAX_TITLE)}</b>`,
    `by ${channelName(finding, MAX_CHANNEL_NAME)}`,
    '',
    '<b>Why it is listed</b>',
    ...whyLines(finding),
    '',
    '<b>The numbers</b>',
    ...numberLines(finding, context),
    '',
    linksLine(finding),
  ];
  return truncateHtml(lines.join('\n'));
}

export interface DigestInput {
  /** The owner's calendar day the summary is for, as YYYY-MM-DD. */
  readonly day: string;
  /** Findings made so far that day. */
  readonly found: number;
  /** Findings sent as alerts of their own that day. */
  readonly alerted: number;
  /** Findings the daily cap kept out of the alerts; the best of them are listed. */
  readonly leftOver: readonly Finding[];
  readonly unitsSpent: number;
  readonly dailyUnits: number;
}

const dayInWords = (day: string): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );

const fastestFirst = (a: Finding, b: Finding): number =>
  (b.viewsPerHour ?? -1) - (a.viewsPerHour ?? -1) || a.id - b.id;

function digestEntry(finding: Finding, place: number): string {
  const title = link(shortsUrl(finding.videoId), safe(finding.videoTitle, MAX_DIGEST_TITLE));
  const views = finding.reason.totalViews;
  const figures = [
    finding.viewsPerHour === null ? null : `${compactNumber(finding.viewsPerHour)} views an hour`,
    views === null ? null : `${compactNumber(views)} views`,
  ].filter((part) => part !== null);
  const numbers = figures.length === 0 ? '' : `: ${figures.join(', ')}`;
  return `${place}. ${title} by ${channelName(finding, MAX_DIGEST_CHANNEL)}${numbers}`;
}

function leftOverLines(leftOver: readonly Finding[]): readonly string[] {
  if (leftOver.length === 0) return [];
  const top = leftOver.toSorted(fastestFirst).slice(0, DIGEST_TOP);
  const more = leftOver.length - top.length;
  return [
    '',
    '<b>The fastest of those not sent one by one</b>',
    ...top.map((finding, index) => digestEntry(finding, index + 1)),
    ...(more > 0 ? [`and ${wholeNumber(more)} more not shown`] : []),
  ];
}

/** The daily summary: the day's counts, the allowance spent, the best of what the cap left out. */
export function formatDigest(input: DigestInput): string {
  const lines = [
    `<b>Shorts finder: summary for ${dayInWords(input.day)}</b>`,
    `Found today: ${wholeNumber(input.found)}`,
    `Sent as alerts: ${wholeNumber(input.alerted)}`,
    `Left out by the daily limit: ${wholeNumber(input.leftOver.length)}`,
    `YouTube API units spent: ${wholeNumber(input.unitsSpent)} of ${wholeNumber(input.dailyUnits)}`,
    ...leftOverLines(input.leftOver),
  ];
  return truncateHtml(lines.join('\n'));
}

export interface LastProblem {
  readonly at: Date;
  /** What was being done, in words: "searching", "reading videos". */
  readonly during: string;
  readonly reason: string;
}

export interface HeartbeatInput {
  readonly now: Date;
  /** Videos still being read again. */
  readonly tracked: number;
  /** Tracked videos whose reading is overdue. */
  readonly dueUnread: number;
  readonly searchesToday: number;
  readonly unitsSpent: number;
  readonly dailyUnits: number;
  readonly unitsByKind: Readonly<Record<QuotaKind, number>>;
  /** The store's size on disk; null for a store in memory. */
  readonly storeBytes: number | null;
  readonly lastProblem: LastProblem | null;
}

function problemLine(problem: LastProblem | null, now: Date): string {
  if (problem === null) return 'Last problem: none';
  const when = `${ageInWords(problem.at, now)} ago, while ${safe(problem.during, MAX_KEYWORD)}`;
  return `Last problem (${when}): ${safe(problem.reason, MAX_ERROR)}`;
}

/** The daily line that says the service is alive, so silence means a fault. */
export function formatHeartbeat(input: HeartbeatInput): string {
  const kinds = input.unitsByKind;
  const byKind = [
    `searches ${wholeNumber(kinds.search)}`,
    `readings ${wholeNumber(kinds.reading)}`,
    `channels ${wholeNumber(kinds.channel)}`,
    `kept back ${wholeNumber(kinds.reserve)}`,
  ].join(', ');
  const lines = [
    '<b>Shorts finder is still running</b>',
    `Videos being tracked: ${compactNumber(input.tracked)}`,
    `Due a reading but not read yet: ${compactNumber(input.dueUnread)}`,
    `Searches today: ${wholeNumber(input.searchesToday)}`,
    `YouTube API units spent: ${wholeNumber(input.unitsSpent)} of ${wholeNumber(input.dailyUnits)} (${byKind})`,
    ...(input.storeBytes === null ? [] : [`Store size on disk: ${sizeInWords(input.storeBytes)}`]),
    problemLine(input.lastProblem, input.now),
  ];
  return truncateHtml(lines.join('\n'));
}
