import { EMPTY_SCRIPT } from '@jgtube/core/src/script/types';
import { describe, expect, test } from 'vitest';
import {
  checklist,
  clockOf,
  exportMarkdown,
  openingStep,
  exportName,
  exportShotList,
  exportText,
  gradeNote,
  scriptStats,
  stageStates,
  toggleModel,
  voiceChoices,
  voiceNote,
  voiceoverCopy,
  type StoredScript,
  type VoiceView,
} from '../src/lib/scriptWriter';

const SCRIPT = [
  '## HOOK',
  '[B-ROLL: a rusted press in an empty hall | abandoned factory machine | low hum]',
  'Nobody switched it off. The plant closed in 1987 [CHECK: the year the plant closed], and the press kept running.',
  '',
  '## Who paid the bill',
  '[B-ROLL: an old meter, spinning | vintage "electricity" meter | ]',
  'Somebody was paying for the power [CHECK: who paid the bill]. It used 40 kilowatts.',
].join('\n');

const script = (overrides: Partial<StoredScript> = {}): StoredScript => ({
  ...EMPTY_SCRIPT,
  conceptId: 5,
  centerChannelId: 'UCcccccccccccccccccccccc',
  updatedAt: '2026-11-21T10:00:00.000Z',
  ...overrides,
});

describe('what the page counts about a script', () => {
  test('the words spoken, their time at the rate, the markers, the unmarked figures and the cues', () => {
    const stats = scriptStats(SCRIPT, 150);

    expect(stats.words).toBe(24);
    expect(stats.seconds).toBe(10);
    expect(stats.markers.map((marker) => marker.what)).toEqual([
      'the year the plant closed',
      'who paid the bill',
    ]);
    expect(stats.unmarkedFigures).toEqual(['It used 40 kilowatts.']);
    expect(stats.cues).toBe(2);
  });

  test('gives no time and no cue times without a rate', () => {
    expect(scriptStats(SCRIPT, null)).toMatchObject({ words: 24, seconds: null, cues: 0 });
  });

  test('shows a time as minutes and seconds', () => {
    expect(clockOf(725)).toBe('12:05');
    expect(clockOf(59)).toBe('0:59');
    expect(clockOf(null)).toBe('—');
  });
});

describe('the reading grade beside the voice’s', () => {
  test('says how far the text is from the voice channel’s own grade', () => {
    expect(gradeNote(9.2, 7.1)).toBe(
      'Reading grade 9.2 (an estimate, for English). That is 2.1 harder than the voice channel’s 7.1.',
    );
    expect(gradeNote(5.0, 7.1)).toMatch(/2\.1 easier than/);
    expect(gradeNote(7.4, 7.1)).toMatch(/about the same as/);
  });

  test('says when there is nothing to compare, or no grade at all', () => {
    expect(gradeNote(7.4, null)).toMatch(/own grade is not known/);
    expect(gradeNote(null, 7.1)).toMatch(/^No reading grade/);
  });
});

describe('the checklist from the beat sheet', () => {
  test('lists the hook and each beat, ticked when the script has a part with that name', () => {
    const beats = '1:00 | Who paid the bill | The meter\n3:00 | The plant | Why it closed';

    expect(checklist(beats, SCRIPT)).toEqual([
      { time: '0:00', name: 'Hook', done: true },
      { time: '1:00', name: 'Who paid the bill', done: true },
      { time: '3:00', name: 'The plant', done: false },
    ]);
    expect(checklist('', '')).toEqual([{ time: '0:00', name: 'Hook', done: false }]);
  });
});

describe('the three stages', () => {
  const states = (value: StoredScript | null) =>
    stageStates(value).map((state) => [state.stage, state.done, state.blocked === null]);

  test('wait for a rate and a length, then for a hook and beats, then for a draft', () => {
    expect(states(null)).toEqual([
      ['hooks', false, false],
      ['draft', false, false],
      ['tighten', false, false],
    ]);
    expect(stageStates(script({ wordsPerMinute: 150 }))[0]?.blocked).toMatch(/how long/);
    const ready = script({ wordsPerMinute: 150, targetSeconds: 600 });
    expect(states(ready)).toEqual([
      ['hooks', false, true],
      ['draft', false, false],
      ['tighten', false, false],
    ]);
    const planned = script({
      wordsPerMinute: 150,
      targetSeconds: 600,
      hooks: [{ way: 'a way', model: null, text: 'Words.' }],
      chosenHook: 'Words.',
      beats: '1:00 | One',
    });
    expect(states(planned)).toEqual([
      ['hooks', true, true],
      ['draft', false, true],
      ['tighten', false, false],
    ]);
    expect(states({ ...planned, draft: SCRIPT, tightened: SCRIPT })).toEqual([
      ['hooks', true, true],
      ['draft', true, true],
      ['tighten', true, true],
    ]);
  });
});

describe('the exports', () => {
  test('a file is named after the title, in letters, digits and dashes', () => {
    expect(exportName("America's New Battery Runs on Rust!", 'txt')).toBe(
      'america-s-new-battery-runs-on-rust.txt',
    );
    expect(exportName('???', 'md')).toBe('script.md');
    expect(exportName('x'.repeat(200), 'csv').length).toBe(64);
  });

  test('the text file carries the title and the whole script with its cues and markers', () => {
    const file = exportText('The Machine', SCRIPT);

    expect(file.startsWith('The Machine\n\n## HOOK\n[B-ROLL: a rusted press')).toBe(true);
    expect(file).toContain('[CHECK: who paid the bill]');
  });

  test('the Markdown file adds the facts to check as a list, so they travel with it', () => {
    const file = exportMarkdown('The Machine', SCRIPT);

    expect(file.startsWith('# The Machine\n\n## HOOK\n')).toBe(true);
    expect(file).toContain(
      '[B-ROLL: a rusted press in an empty hall | abandoned factory machine | low hum]',
    );
    expect(file).toContain('## Facts to check before recording');
    expect(file).toContain(
      '- [ ] the year the plant closed (in: “The plant closed in 1987, and the press kept running.”)',
    );
    expect(exportMarkdown('T', 'Plain words.')).toContain('No fact is marked to be checked.');
  });

  test('the shot list has a row per cue with times worked out from the words, and quotes what needs it', () => {
    expect(exportShotList(SCRIPT, 150).split('\r\n')).toEqual([
      'Shot,Starts,Ends,What to show,Search phrase or picture prompt,Sound or music',
      '1,0:00,0:06,a rusted press in an empty hall,abandoned factory machine,low hum',
      '2,0:06,0:10,"an old meter, spinning","vintage ""electricity"" meter",',
      '',
    ]);
    expect(exportShotList(SCRIPT, null).split('\r\n')).toHaveLength(2);
  });

  test('the clean voiceover is only what is spoken, and says how many markers it leaves behind', () => {
    expect(voiceoverCopy(SCRIPT)).toEqual({
      text: 'Nobody switched it off. The plant closed in 1987, and the press kept running.\n\nSomebody was paying for the power. It used 40 kilowatts.',
      unchecked: 2,
    });
    expect(voiceoverCopy('Plain words.')).toEqual({ text: 'Plain words.', unchecked: 0 });
  });
});

describe('what a voice was measured from', () => {
  const voice = (profile: Partial<VoiceView['profile']>): VoiceView => ({
    channelId: 'UCvvvvvvvvvvvvvvvvvvvvvv',
    title: 'Voice',
    profile: {
      videos: 5,
      punctuated: 5,
      wordsPerMinute: 153,
      sentenceWords: 16.2,
      grade: 7.07,
      ...profile,
    },
    toRead: 0,
    noCaptions: 0,
    frameStudies: [],
  });

  test('is said in one sentence, with what could not be measured', () => {
    expect(voiceNote(voice({}))).toBe(
      'Voice, from the captions of 5 of its best videos: 153 words a minute; sentences of about 16 words, reading grade 7.1.',
    );
    expect(voiceNote(voice({ punctuated: 0, sentenceWords: null, grade: null }))).toMatch(
      /carry no sentence ends/,
    );
    expect(voiceNote(voice({ videos: 0, wordsPerMinute: null }))).toMatch(/have not been read yet/);
    expect(voiceNote(null)).toBe('No voice chosen yet.');
  });
});

describe('choosing openings to model', () => {
  test('adds a hook, takes it away again, and takes no more than three', () => {
    expect(toggleModel([], 'a')).toEqual(['a']);
    expect(toggleModel(['a', 'b'], 'a')).toEqual(['b']);
    const three = ['a', 'b', 'c'];
    expect(toggleModel(three, 'd')).toBe(three);
  });
});

describe('the voices on offer', () => {
  const channel = (id: string, title: string, peer = true, removed = false) => ({
    id,
    title,
    peer,
    removed,
  });

  test('are the model, the owner’s own channel and the look-alikes of this map, each once', () => {
    const map = {
      center: { id: 'me', title: 'Mine' },
      model: { id: 'm', title: 'Model' },
      channels: [
        channel('z', 'Zed'),
        channel('m', 'Model'),
        channel('a', 'Alpha'),
        channel('far', 'Not alike', false),
        channel('gone', 'Removed', true, true),
      ],
    };

    expect(voiceChoices(map)).toEqual([
      { id: 'm', label: 'Your model: Model' },
      { id: 'me', label: 'Your channel: Mine' },
      { id: 'a', label: 'Alpha' },
      { id: 'z', label: 'Zed' },
    ]);
    expect(voiceChoices({ ...map, model: null, channels: [] })).toEqual([
      { id: 'me', label: 'Your channel: Mine' },
    ]);
  });
});

describe('with marking facts turned off', () => {
  test('the counts list no markers and no unmarked figures, and the words are the same', () => {
    const on = scriptStats(SCRIPT, 150);
    const off = scriptStats(SCRIPT, 150, false);

    expect(on.markers).toHaveLength(2);
    expect(off.markers).toEqual([]);
    expect(off.unmarkedFigures).toEqual([]);
    expect(off).toMatchObject({ words: on.words, seconds: on.seconds, cues: on.cues });
  });

  test('the clean voiceover is copied at the first press, markers stripped as always', () => {
    expect(voiceoverCopy(SCRIPT, false)).toEqual({
      text: voiceoverCopy(SCRIPT).text,
      unchecked: 0,
    });
    expect(voiceoverCopy(SCRIPT, false).text).not.toContain('CHECK');
  });

  test('the text and Markdown files carry no markers and no list of facts to check', () => {
    const text = exportText('The Machine', SCRIPT, false);
    const markdown = exportMarkdown('The Machine', SCRIPT, false);

    expect(text).not.toContain('CHECK');
    expect(text).toContain('[B-ROLL: a rusted press');
    expect(text).toContain('The plant closed in 1987, and the press kept running.');
    expect(markdown).not.toContain('CHECK');
    expect(markdown).not.toContain('Facts to check');
    expect(markdown).toContain('## Who paid the bill');
  });

  test('with it on, the files carry every marker, as before', () => {
    expect(exportText('The Machine', SCRIPT, true)).toBe(exportText('The Machine', SCRIPT));
    expect(exportMarkdown('The Machine', SCRIPT, true)).toContain(
      '## Facts to check before recording',
    );
    expect(exportText('The Machine', SCRIPT)).toContain('[CHECK: who paid the bill]');
  });
});

describe('the Markdown export with the concept’s thumbnail prompt', () => {
  test('ends with the prompt under its own heading, in both modes of marking facts', () => {
    const marked = exportMarkdown('The Machine', SCRIPT, true, {
      thumbnailPrompt: 'A dark close-up.',
    });
    const plain = exportMarkdown('The Machine', SCRIPT, false, {
      thumbnailPrompt: 'A dark close-up.',
    });

    for (const file of [marked, plain]) {
      expect(file.trimEnd().endsWith('## Thumbnail prompt\n\nA dark close-up.')).toBe(true);
    }
  });

  test('has no such heading when the concept has no prompt', () => {
    expect(exportMarkdown('The Machine', SCRIPT, true, {})).not.toContain('Thumbnail prompt');
  });
});

describe('the step the script writer opens on', () => {
  const state = (stage: 'hooks' | 'draft' | 'tighten', done: boolean) => ({
    stage,
    done,
    blocked: null,
  });

  test('is the first step not written yet, or the last when all are', () => {
    expect(
      openingStep([state('hooks', false), state('draft', false), state('tighten', false)]),
    ).toBe('hooks');
    expect(
      openingStep([state('hooks', true), state('draft', false), state('tighten', false)]),
    ).toBe('draft');
    expect(openingStep([state('hooks', true), state('draft', true), state('tighten', true)])).toBe(
      'tighten',
    );
  });
});
