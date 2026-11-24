/**
 * A collection written out for the owner: CSV for a spreadsheet, Markdown for
 * notes. Every number is a stored or computed one, named for what it is.
 * Titles and names are scraped text: a CSV cell that a spreadsheet would run
 * as a formula is opened with a quote mark, and Markdown table cells are escaped.
 */
import type { BankVideo } from './types';

const watchLink = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;
const oneDecimal = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

const COLUMNS: readonly (readonly [string, (video: BankVideo) => string])[] = [
  ['video_id', (v) => v.videoId],
  ['title', (v) => v.title],
  ['link', (v) => watchLink(v.videoId)],
  ['channel', (v) => v.channel.title],
  ['channel_id', (v) => v.channel.id],
  ['outlier_score_x', (v) => (v.score === null ? '' : oneDecimal(v.score))],
  ['usual_views_baseline', (v) => (v.baseline === null ? '' : String(Math.round(v.baseline)))],
  ['videos_in_baseline', (v) => (v.sampleSize === null ? '' : String(v.sampleSize))],
  ['caution', (v) => v.caution ?? ''],
  ['views', (v) => String(v.views)],
  ['age_days', (v) => String(Math.floor(v.ageDays))],
  ['views_per_day_average', (v) => String(Math.round(v.viewsPerDay))],
  ['length_seconds', (v) => (v.durationSeconds === null ? '' : String(v.durationSeconds))],
  ['short', (v) => (v.isShort ? 'yes' : 'no')],
  ['subscribers', (v) => (v.channel.subscribers === null ? '' : String(v.channel.subscribers))],
  ['topic_label', (v) => v.channel.topic.label],
  ['country', (v) => v.channel.country ?? ''],
  ['money_sign', (v) => v.channel.money],
  ['last_read', (v) => v.readAt],
];

/** A cell a spreadsheet takes as text: quoted, and never starting a formula. */
function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n']/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function collectionCsv(videos: readonly BankVideo[]): string {
  const lines = [
    COLUMNS.map(([name]) => name).join(','),
    ...videos.map((video) => COLUMNS.map(([, cell]) => csvCell(cell(video))).join(',')),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

const mdCell = (text: string): string =>
  text.replace(/[\r\n]+/g, ' ').replace(/([\\|`*_[\]<>])/g, '\\$1');

function mdRow(video: BankVideo): string {
  const score = video.score === null ? 'not scored' : `${oneDecimal(video.score)}×`;
  const usual = video.baseline === null ? '' : ` (usual ${whole.format(video.baseline)})`;
  return `| [${mdCell(video.title)}](${watchLink(video.videoId)}) | ${mdCell(video.channel.title)} | ${score}${usual} | ${whole.format(video.views)} | ${Math.floor(video.ageDays)} |`;
}

export function collectionMarkdown(
  name: string,
  videos: readonly BankVideo[],
  exportedAt: Date,
): string {
  return [
    `# ${mdCell(name)}`,
    '',
    `${videos.length} videos from the Jgtube outlier bank, exported ${exportedAt.toISOString().slice(0, 10)}.`,
    'The score is views over the channel’s usual views at the same age (the median of its other recent videos), from stored readings. No figure is a forecast.',
    '',
    '| Video | Channel | Outlier score | Views | Age (days) |',
    '| --- | --- | --- | --- | --- |',
    ...videos.map(mdRow),
    '',
  ].join('\n');
}
