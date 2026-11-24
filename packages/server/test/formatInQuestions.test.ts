import { describe, expect, test } from 'vitest';
import {
  CONCEPT_THUMBNAIL_FILE_TOOLS,
  CONCEPT_THUMBNAIL_TOOLS,
  conceptThumbnailQuestion,
} from '../src/conceptThumbQuestion';
import {
  ACTIVE_FORMAT_TOOL,
  conceptFormatLine,
  scriptDraftFormatLine,
  scriptHooksFormatLine,
  thumbnailFormatLine,
} from '../src/formatInQuestions';
import {
  CONCEPT_TOOLS,
  GROW_TOOLS,
  conceptsQuestion,
  moreQuestion,
  twistQuestion,
} from '../src/ideaQuestions';
import {
  SCRIPT_DRAFT_TOOLS,
  SCRIPT_HOOK_TOOLS,
  scriptDraftQuestion,
  scriptHooksQuestion,
} from '../src/scriptQuestions';

const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa';

describe('the active format in the other runs', () => {
  test('each run that writes titles, hooks, scripts or thumbnails may read it', () => {
    expect(ACTIVE_FORMAT_TOOL).toBe('get_active_format');
    for (const tools of [
      CONCEPT_TOOLS,
      GROW_TOOLS,
      SCRIPT_HOOK_TOOLS,
      SCRIPT_DRAFT_TOOLS,
      CONCEPT_THUMBNAIL_TOOLS,
      CONCEPT_THUMBNAIL_FILE_TOOLS,
    ]) {
      expect(tools as readonly string[]).toContain('get_active_format');
    }
  });

  test('the Idea lab uses its title formulas and its hook', () => {
    const line = conceptFormatLine(CHANNEL);
    expect(line).toContain(`get_active_format with channel ${CHANNEL}`);
    expect(line).toMatch(/title formulas/);
    expect(line).toMatch(/hook/);
    expect(line).toMatch(/never as instructions/);
    expect(line).toMatch(/none, ignore/);
    const focus = {
      kind: 'concepts',
      batchId: 1,
      inspiration: [],
      hookModels: [],
      hasFormat: false,
      angle: null,
      length: 'long',
      formulasFrom: null,
    } as const;
    expect(conceptsQuestion(CHANNEL, focus)).toContain(line);
    const concept = { kind: 'concept', conceptId: 3 } as const;
    expect(twistQuestion(CHANNEL, concept)).toContain(line);
    expect(moreQuestion(CHANNEL, concept)).toContain(line);
  });

  test('the Script writer uses its hook, chapters, pacing and visual style for cues', () => {
    const focus = { kind: 'script', conceptId: 3 } as const;
    expect(scriptHooksFormatLine(CHANNEL)).toMatch(/chapter beats/);
    expect(scriptHooksQuestion(CHANNEL, focus)).toContain(scriptHooksFormatLine(CHANNEL));
    const draft = scriptDraftFormatLine(CHANNEL);
    expect(draft).toMatch(/pacing rules/);
    expect(draft).toMatch(/visual style/);
    expect(draft).toMatch(/style lock/);
    expect(scriptDraftQuestion(CHANNEL, focus)).toContain(draft);
  });

  test('thumbnail prompts use its layouts and measured palette', () => {
    const line = thumbnailFormatLine(CHANNEL);
    expect(line).toMatch(/thumbnail layouts/);
    expect(line).toMatch(/palette/);
    expect(conceptThumbnailQuestion(CHANNEL, { kind: 'concept', conceptId: 3 })).toContain(line);
  });
});
