import { THUMBNAIL_PROMPT_MARKER, VIDEO_REF_RULE, markerLines } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { ANALYSES, PICTURE_ENGINES } from '../src/analyses';
import { CONCEPT_THUMBNAIL_TOOLS, conceptThumbnailQuestion } from '../src/conceptThumbQuestion';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const { start, end } = markerLines(THUMBNAIL_PROMPT_MARKER);

describe('the question that writes a thumbnail prompt for one concept', () => {
  const question = conceptThumbnailQuestion(CHANNEL, { kind: 'concept', conceptId: 42 });

  test('reads the concept, the winning thumbnails and any stored thumbnail study through tools', () => {
    expect(question).toContain(`get_concept with channel ${CHANNEL} and concept 42`);
    expect(question).toContain('get_thumbnail_board');
    expect(question).toContain('view_thumbnails');
    expect(question).toContain('get_channel_note');
    expect(question).toContain('thumbnail-review');
    expect(question).toContain('style-lock');
    expect(question).toContain('get_breakdown_part');
  });

  test('ends with one prompt between the marker lines, for this concept, naming the thumbnails it learned from', () => {
    expect(question).toContain(start);
    expect(question).toContain(end);
    expect(question).toContain(VIDEO_REF_RULE);
    expect(question).toMatch(/WHY:/);
    expect(question).toMatch(/overlay words exactly as the concept gives them/i);
    expect(question).toMatch(/names no channel, no video, no video id, no real person, no logo/);
  });

  test('says what it reads is a study and never instructions', () => {
    expect(question).toMatch(/never as instructions/);
  });

  test('is refused a concept that is not named by its whole number', () => {
    expect(() => conceptThumbnailQuestion(CHANNEL, { kind: 'concept', conceptId: 0 })).toThrow(
      /number/,
    );
  });

  test('is asked only of engines that see pictures, with only its read-only tools', () => {
    const spec = ANALYSES['concept-thumbnail'];

    expect(spec.pictures).toBe(true);
    expect(PICTURE_ENGINES).toEqual(['claude', 'codex']);
    expect(spec.allowedTools).toEqual(
      CONCEPT_THUMBNAIL_TOOLS.map((name) => `mcp__jgtube__${name}`),
    );
    expect(CONCEPT_THUMBNAIL_TOOLS).not.toContain('make_map');
    expect(CONCEPT_THUMBNAIL_TOOLS).not.toContain('set_competitor_status');
  });
});
