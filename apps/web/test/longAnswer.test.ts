import { describe, expect, test } from 'vitest';
import { leadOf, moreLabel, outlineOf, splitBlocks, summaryAfterLead } from '../src/lib/longAnswer';
import type { AnswerBlock } from '../src/lib/analyses';

const item = (text: string): AnswerBlock => ({ kind: 'item', text });

describe('outlineOf', () => {
  test('puts what comes before the first heading first, as the summary', () => {
    const outline = outlineOf(
      ['The map leans on big projects.', '', '1. THE ROAD', 'TITLE: One road / Two roads'].join(
        '\n',
      ),
    );
    expect(outline.summary).toEqual([
      { kind: 'paragraph', text: 'The map leans on big projects.' },
    ]);
    expect(outline.sections.map((section) => section.title)).toEqual(['1. THE ROAD']);
    expect(outline.sections[0]?.numbered).toBe(true);
  });

  test('has no summary when the answer opens on a heading', () => {
    const outline = outlineOf(['WHAT WORKS', '- Big numbers.'].join('\n'));
    expect(outline.summary).toEqual([]);
    expect(outline.sections).toHaveLength(1);
  });

  test('is empty for an empty answer', () => {
    expect(outlineOf('')).toEqual({ summary: [], sections: [] });
  });
});

describe('splitBlocks', () => {
  const blocks = ['a', 'b', 'c', 'd', 'e'].map(item);

  test('shows the first points and keeps the rest for More', () => {
    const split = splitBlocks(blocks);
    expect(split.shown.map((block) => block.text)).toEqual(['a', 'b', 'c']);
    expect(split.more.map((block) => block.text)).toEqual(['d', 'e']);
  });

  test('shows a single point left over rather than hiding it alone', () => {
    const split = splitBlocks(blocks.slice(0, 4));
    expect(split.shown).toHaveLength(4);
    expect(split.more).toEqual([]);
  });

  test('takes another number of points to show', () => {
    expect(splitBlocks(blocks, 1).more).toHaveLength(4);
  });
});

describe('moreLabel', () => {
  test('counts the points behind the disclosure', () => {
    expect(moreLabel(1)).toBe('1 more point');
    expect(moreLabel(4)).toBe('4 more points');
  });
});

describe('leadOf', () => {
  test('passes over the line naming the picture files that were opened', () => {
    expect(leadOf('PICTURES OPENED: 2, thumb-a.jpg, thumb-b.jpg\nBold red words win.')).toBe(
      'Bold red words win.',
    );
  });

  test('is the first paragraph, without headings or video markers', () => {
    expect(leadOf('TITLES\nIts titles lead with a number [video:abcdefghijk].')).toBe(
      'Its titles lead with a number.',
    );
  });

  test('cuts a long opening at a word', () => {
    const long = `${'word '.repeat(80)}end.`;
    const lead = leadOf(long) ?? '';
    expect(lead.endsWith('…')).toBe(true);
    expect(lead.length).toBeLessThanOrEqual(221);
    expect(lead).not.toContain('word…w');
  });

  test('is null for a text with no words to show', () => {
    expect(leadOf('')).toBeNull();
    expect(leadOf('ONLY A HEADING')).toBeNull();
    expect(leadOf('[video:abcdefghijk]')).toBeNull();
  });
});

describe('summaryAfterLead', () => {
  const para = (text: string): AnswerBlock => ({ kind: 'paragraph', text });

  test('drops the first block when the lead already says all of it', () => {
    expect(summaryAfterLead([para('Short.'), para('Next.')])).toEqual([para('Next.')]);
  });

  test('keeps a first block that names a video, so its thumbnail still shows', () => {
    const named = [para('Short [video:abcdefghijk].')];
    expect(summaryAfterLead(named)).toEqual(named);
  });

  test('keeps a first block the lead had to cut', () => {
    const long = [para('word '.repeat(80))];
    expect(summaryAfterLead(long)).toEqual(long);
  });

  test('is empty for no summary', () => {
    expect(summaryAfterLead([])).toEqual([]);
  });
});
