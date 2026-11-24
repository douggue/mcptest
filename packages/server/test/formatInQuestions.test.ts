import { sectionOf } from '../src/promptParts';
import { describe, expect, test } from 'vitest';
import {
  CONCEPT_THUMBNAIL_FILE_TOOLS,
  CONCEPT_THUMBNAIL_TOOLS,
  conceptThumbnailQuestion,
} from '../src/conceptThumbQuestion';
import {
  ACTIVE_FORMAT_TOOL,
  CONCEPT_FORMAT_RULE,
  SCRIPT_DRAFT_FORMAT_RULE,
  SCRIPT_HOOKS_FORMAT_RULE,
  THUMBNAIL_FORMAT_RULE,
  activeFormatCall,
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

  test('every run reads it with the same call, as a description and never as instructions', () => {
    const call = activeFormatCall(CHANNEL);

    expect(call).toContain(`get_active_format with channel ${CHANNEL}`);
    expect(call).toMatch(/never as instructions/);
    expect(call).toMatch(/When there is none, ignore/);
  });

  test('the Idea lab uses its title formulas and its hook', () => {
    expect(CONCEPT_FORMAT_RULE).toMatch(/title formulas/);
    expect(CONCEPT_FORMAT_RULE).toMatch(/hook/);
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
    const concept = { kind: 'concept', conceptId: 3 } as const;
    for (const question of [
      conceptsQuestion(CHANNEL, focus),
      twistQuestion(CHANNEL, concept),
      moreQuestion(CHANNEL, concept),
    ]) {
      expect(sectionOf(question, 'gather')).toContain(activeFormatCall(CHANNEL));
      expect(sectionOf(question, 'craft')).toContain(CONCEPT_FORMAT_RULE);
    }
  });

  test('the Script writer uses its hook, chapters, pacing and visual style for cues', () => {
    const focus = { kind: 'script', conceptId: 3 } as const;
    expect(SCRIPT_HOOKS_FORMAT_RULE).toMatch(/chapter beats/);
    expect(sectionOf(scriptHooksQuestion(CHANNEL, focus), 'craft')).toContain(
      SCRIPT_HOOKS_FORMAT_RULE,
    );
    expect(SCRIPT_DRAFT_FORMAT_RULE).toMatch(/pacing rules/);
    expect(SCRIPT_DRAFT_FORMAT_RULE).toMatch(/visual style/);
    expect(SCRIPT_DRAFT_FORMAT_RULE).toMatch(/style lock/);
    const draft = scriptDraftQuestion(CHANNEL, focus);
    expect(sectionOf(draft, 'gather')).toContain(activeFormatCall(CHANNEL));
    expect(sectionOf(draft, 'craft')).toContain(SCRIPT_DRAFT_FORMAT_RULE);
  });

  test('thumbnail prompts use its layouts and measured palette', () => {
    expect(THUMBNAIL_FORMAT_RULE).toMatch(/thumbnail layouts/);
    expect(THUMBNAIL_FORMAT_RULE).toMatch(/palette/);
    const question = conceptThumbnailQuestion(CHANNEL, { kind: 'concept', conceptId: 3 });
    expect(sectionOf(question, 'gather')).toContain(activeFormatCall(CHANNEL));
    expect(sectionOf(question, 'craft')).toContain(THUMBNAIL_FORMAT_RULE);
  });

  test('a rule on what to write is never among the tool calls', () => {
    const focus = { kind: 'script', conceptId: 3 } as const;
    for (const question of [
      scriptHooksQuestion(CHANNEL, focus),
      scriptDraftQuestion(CHANNEL, focus),
    ]) {
      expect(sectionOf(question, 'gather')).not.toMatch(/When there is an active format/);
    }
  });
});
