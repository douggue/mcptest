import { describe, expect, test } from 'vitest';
import {
  DIGEST_TOP,
  formatDigest,
  formatFinding,
  formatHeartbeat,
  type HeartbeatInput,
} from '../../src/alerts/format';
import {
  ageInWords,
  capText,
  channelUrl,
  compactNumber,
  dollars,
  escapeHtml,
  shortsUrl,
  sizeInWords,
  truncateHtml,
  wholeNumber,
} from '../../src/alerts/text';
import { NO_REASON } from '../../src/findings/reason';
import type { Finding, NewFinding } from '../../src/repos/types';
import { channelId, videoId } from '../fixtures/apiReplies';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at } from '../fixtures/facts';
import { newFinding, reasonFor } from '../fixtures/findings';

const RATE = { low: 0.1, high: 0.5 };
const CONTEXT = { now: NOW, rate: RATE };

const finding = (n: number, letter: string, overrides: Partial<NewFinding> = {}): Finding => ({
  ...newFinding(n, letter, overrides),
  id: n,
  alertedAt: null,
  digestedAt: null,
  skippedAt: null,
  skipReason: null,
});

/** Every tag opened is closed, in order, and no entity or tag is cut short. */
function isWellFormed(html: string): boolean {
  const open: string[] = [];
  for (const tag of html.match(/<[^>]*>?/g) ?? []) {
    if (!tag.endsWith('>')) return false;
    const name = /^<\/?([a-z]+)/.exec(tag)?.[1] ?? '';
    if (tag.startsWith('</')) {
      if (open.pop() !== name) return false;
    } else open.push(name);
  }
  const text = html.replace(/<[^>]*>/g, '');
  return open.length === 0 && !/&(?![#\w]+;)/.test(text) && !/[<>]/.test(text);
}

describe('the pieces of a message', () => {
  test('escapeHtml escapes the four characters HTML reads', () => {
    expect(escapeHtml(`<b>"Tom & Jerry"</b>`)).toBe(
      '&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;',
    );
  });

  test('capText puts text on one line and marks a cut', () => {
    expect(capText('  two\nlines\u0000 here ‮ ', 50)).toBe('two lines here');
    expect(capText('abcdefghij', 5)).toBe('abcd…');
    expect(capText('abc', 3)).toBe('abc');
  });

  test('capText never cuts a character in half', () => {
    expect(capText('🙂🙂🙂🙂', 3)).toBe('🙂🙂…');
  });

  test.each([
    [0, '0'],
    [950, '950'],
    [999.6, '1K'],
    [1234, '1.2K'],
    [12_400, '12.4K'],
    [123_456, '123K'],
    [999_960, '1M'],
    [1_200_000, '1.2M'],
    [2_000_000_000, '2B'],
    [5_000_000_000_000, '5000B'],
  ])('compactNumber writes %d as %s', (value, text) => {
    expect(compactNumber(value)).toBe(text);
  });

  test('wholeNumber and dollars write figures as a person would', () => {
    expect(wholeNumber(4321)).toBe('4,321');
    expect(dollars(0.4)).toBe('$0.40');
    expect(dollars(12.4)).toBe('$12.40');
    expect(dollars(1240.3)).toBe('$1,240');
  });

  test.each([
    [0, '0 minutes'],
    [MINUTE_MS, '1 minute'],
    [59 * MINUTE_MS, '59 minutes'],
    [HOUR_MS, '1 hour'],
    [47 * HOUR_MS, '47 hours'],
    [3 * DAY_MS, '3 days'],
    [90 * DAY_MS, '3 months'],
    [364 * DAY_MS, '12 months'],
    [800 * DAY_MS, '2 years'],
  ])('ageInWords tells %d ms as %s', (ms, words) => {
    expect(ageInWords(at(-ms), NOW)).toBe(words);
  });

  test('ageInWords calls a moment in the future no time ago', () => {
    expect(ageInWords(at(HOUR_MS), NOW)).toBe('0 minutes');
  });

  test('sizeInWords tells a size in the unit that fits', () => {
    expect(sizeInWords(512)).toBe('512 bytes');
    expect(sizeInWords(340 * 1024)).toBe('340 KB');
    expect(sizeInWords(13_002_342)).toBe('12.4 MB');
    expect(sizeInWords(5 * 1024 ** 4)).toBe('5120 GB');
  });

  test('links are made only from ids of the right shape', () => {
    expect(shortsUrl(videoId(1))).toBe(`https://www.youtube.com/shorts/${videoId(1)}`);
    expect(channelUrl(channelId('A'))).toBe(`https://www.youtube.com/channel/${channelId('A')}`);
    expect(shortsUrl('"><script>')).toBeNull();
    expect(shortsUrl(`${videoId(1)}?x=1`)).toBeNull();
    expect(channelUrl('UCshort')).toBeNull();
  });
});

describe('truncateHtml', () => {
  test('leaves a message that fits as it is', () => {
    expect(truncateHtml('<b>short</b>', 20)).toBe('<b>short</b>');
  });

  test('closes the tags left open by the cut', () => {
    expect(truncateHtml('<b>abcdefghijklmnop</b>', 12)).toBe('<b>abcd…</b>');
  });

  test('never cuts inside an entity', () => {
    const cut = truncateHtml('ab&amp;&amp;&amp;&amp;', 10);

    expect(cut).toBe('ab&amp;…');
    expect(isWellFormed(cut)).toBe(true);
  });

  test('never cuts inside a tag', () => {
    const html = 'abc <a href="https://www.youtube.com/shorts/abcdefghijk">Watch</a> more';

    for (let max = 5; max < html.length; max += 1) {
      const cut = truncateHtml(html, max);
      expect(cut.length).toBeLessThanOrEqual(max);
      expect(isWellFormed(cut)).toBe(true);
    }
  });

  test('closes nested tags innermost first', () => {
    expect(truncateHtml('<b><i>abcdefghijklmnopqrstuvwxyz</i></b>', 20)).toBe(
      '<b><i>abcde…</i></b>',
    );
  });
});

describe('formatFinding', () => {
  test('says why, the numbers, where it was found and gives the two links', () => {
    const message = formatFinding(finding(3, 'C'), CONTEXT);

    expect(message.split('\n')).toEqual([
      '<b>New find: a small channel with a Short taking off</b>',
      '<b>Fixing a slipping bicycle chain</b>',
      'by Channel C',
      '',
      '<b>Why it is listed</b>',
      '• Gaining views much faster than the channel is big',
      '• The channel is new',
      '',
      '<b>The numbers</b>',
      'Views per hour: 3K',
      'Total views: 300K',
      'Posted: 5 hours ago',
      'Channel: 890 subscribers, started 3 months ago',
      'Could have earned so far: $30.00 to $150 (at $0.10 to $0.50 per 1,000 views)',
      'Found by searching "bicycle repair" in CA · channel based in US',
      '',
      `<a href="https://www.youtube.com/shorts/${videoId(3)}">Watch the Short</a> · <a href="https://www.youtube.com/channel/${channelId('C')}">Open the channel</a>`,
    ]);
  });

  test('names a transfer finding as an idea working elsewhere', () => {
    const message = formatFinding(finding(1, 'A', { kind: 'transfer' }), CONTEXT);

    expect(message).toContain('<b>New find: an idea that is working elsewhere</b>');
  });

  test('escapes a title and a channel name written to break the message', () => {
    const hostile = finding(1, 'A', {
      videoTitle: '</b><a href="https://evil.example">Win & "more"</a>',
      channelTitle: '<script>alert(1)</script>',
      reason: reasonFor(1, { why: ['<i>fast</i> & loud'], subjectKeyword: '"><b>x' }),
    });

    const message = formatFinding(hostile, CONTEXT);

    expect(message).toContain(
      '&lt;/b&gt;&lt;a href=&quot;https://evil.example&quot;&gt;Win &amp; &quot;more&quot;&lt;/a&gt;',
    );
    expect(message).toContain('by &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message).toContain('• &lt;i&gt;fast&lt;/i&gt; &amp; loud');
    expect(message).toContain('searching "&quot;&gt;&lt;b&gt;x"');
    expect(message).not.toContain('evil.example">');
    expect(isWellFormed(message)).toBe(true);
  });

  test('leaves out what is not known rather than guessing', () => {
    const bare = finding(1, 'A', {
      channelTitle: null,
      reason: NO_REASON,
      viewsPerHour: null,
      earningsLow: null,
      earningsHigh: null,
    });

    const message = formatFinding(bare, CONTEXT);

    expect(message).toContain('by a channel with no name');
    expect(message).toContain('• The reason was not recorded.');
    expect(message).toContain('Views per hour: not measured yet');
    expect(message).not.toMatch(/Total views|Channel:|earned|Found by|based in/);
  });

  test('works the earnings out from the views at the configured rate when none were stored', () => {
    const unpriced = finding(2, 'B', { earningsLow: null, earningsHigh: null });

    const message = formatFinding(unpriced, { now: NOW, rate: { low: 0.05, high: 0.3 } });

    expect(message).toContain(
      'Could have earned so far: $10.00 to $60.00 (at $0.05 to $0.30 per 1,000 views)',
    );
  });

  test('tells of a channel by whichever of its size and age is known', () => {
    const sizeOnly = finding(1, 'A', { reason: reasonFor(1, { channelCreatedAt: null }) });
    const ageOnly = finding(1, 'A', { reason: reasonFor(1, { subscribers: null }) });
    const noSubject = finding(1, 'A', {
      reason: reasonFor(1, { subjectKeyword: null, subjectRegion: null }),
    });

    expect(formatFinding(sizeOnly, CONTEXT)).toContain('\nChannel: 890 subscribers\n');
    expect(formatFinding(ageOnly, CONTEXT)).toContain('\nChannel: started 3 months ago\n');
    expect(formatFinding(noSubject, CONTEXT)).toContain('\nChannel based in GB\n');
  });

  test('gives the words without a link when an id is not a YouTube id', () => {
    const odd = finding(1, 'A', { videoId: 'x"onclick="y', channelId: 'nope' });

    const message = formatFinding(odd, CONTEXT);

    expect(message).toContain('Watch the Short · Open the channel');
    expect(message).not.toContain('href');
  });

  test('stays under the limit and well formed whatever length the text is', () => {
    const long = finding(1, 'A', {
      videoTitle: '&<>"'.repeat(2000),
      channelTitle: '<'.repeat(5000),
      reason: reasonFor(1, {
        why: Array.from({ length: 40 }, () => '&'.repeat(900)),
        subjectKeyword: '"'.repeat(900),
      }),
    });

    const message = formatFinding(long, CONTEXT);

    expect(message.length).toBeLessThanOrEqual(4096);
    expect(isWellFormed(message)).toBe(true);
  });
});

describe('formatDigest', () => {
  const input = {
    day: '2026-11-20',
    found: 14,
    alerted: 10,
    leftOver: [] as readonly Finding[],
    unitsSpent: 4321,
    dailyUnits: 10_000,
  };

  test('gives the counts of the day and the allowance spent', () => {
    expect(formatDigest(input).split('\n')).toEqual([
      '<b>Shorts finder: summary for 20 November</b>',
      'Found today: 14',
      'Sent as alerts: 10',
      'Left out by the daily limit: 0',
      'YouTube API units spent: 4,321 of 10,000',
    ]);
  });

  test('lists the fastest of what the limit left out, and counts the rest', () => {
    const leftOver = [1, 2, 3, 4, 5, 6, 7].map((n) => finding(n, 'A'));
    const unmeasured = finding(8, 'B', { viewsPerHour: null, reason: NO_REASON });

    const lines = formatDigest({ ...input, leftOver: [...leftOver, unmeasured] }).split('\n');

    expect(lines[3]).toBe('Left out by the daily limit: 8');
    expect(lines.slice(5, 8)).toEqual([
      '',
      '<b>The fastest of those not sent one by one</b>',
      `1. <a href="https://www.youtube.com/shorts/${videoId(7)}">Fixing a slipping bicycle chain</a> by Channel A: 7K views an hour, 700K views`,
    ]);
    expect(lines).toHaveLength(8 + DIGEST_TOP);
    expect(lines.at(-1)).toBe('and 3 more not shown');
  });

  test('lists a finding with no figures by its title alone, escaped', () => {
    const plain = finding(1, 'A', {
      videoTitle: 'Salt & <pepper>',
      viewsPerHour: null,
      reason: NO_REASON,
    });

    const message = formatDigest({ ...input, leftOver: [plain] });

    expect(message).toContain('>Salt &amp; &lt;pepper&gt;</a> by Channel A\n'.trimEnd());
    expect(message.endsWith('by Channel A')).toBe(true);
    expect(isWellFormed(message)).toBe(true);
  });
});

describe('formatHeartbeat', () => {
  const input: HeartbeatInput = {
    now: NOW,
    tracked: 1234,
    dueUnread: 34,
    searchesToday: 42,
    unitsSpent: 4321,
    dailyUnits: 10_000,
    unitsByKind: { search: 4242, reading: 60, channel: 19, reserve: 0 },
    storeBytes: 13_002_342,
    lastProblem: null,
  };

  test('says the service runs, what it tracks and what it has spent', () => {
    expect(formatHeartbeat(input).split('\n')).toEqual([
      '<b>Shorts finder is still running</b>',
      'Videos being tracked: 1.2K',
      'Due a reading but not read yet: 34',
      'Searches today: 42',
      'YouTube API units spent: 4,321 of 10,000 (searches 4,242, readings 60, channels 19, kept back 0)',
      'Store size on disk: 12.4 MB',
      'Last problem: none',
    ]);
  });

  test('tells of the last problem, escaped, and leaves out the size of a store in memory', () => {
    const message = formatHeartbeat({
      ...input,
      storeBytes: null,
      lastProblem: { at: at(-3 * HOUR_MS), during: 'searching', reason: 'Refused <403> & more' },
    });

    expect(message).not.toContain('Store size');
    expect(message).toContain(
      'Last problem (3 hours ago, while searching): Refused &lt;403&gt; &amp; more',
    );
  });
});
