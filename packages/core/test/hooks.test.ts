import { describe, expect, test } from 'vitest';
import {
  HOOK_LIBRARY_VIDEOS,
  HOOK_SECONDS,
  firstMinute,
  parseHookLabels,
  pickHookVideos,
} from '../src/hooks/hooks';

const line = (seconds: number, text: string) => ({ startMs: seconds * 1000, text });

describe('the first minute of what a video says', () => {
  test('is sixty seconds, and a library holds a dozen videos', () => {
    expect(HOOK_SECONDS).toBe(60);
    expect(HOOK_LIBRARY_VIDEOS).toBe(12);
  });

  test('takes every caption line that starts inside the minute, whole, and none that starts after', () => {
    const segments = [
      line(0, 'In 1987 a machine was switched on.'),
      line(31, 'Nobody has switched it off since.'),
      line(58, 'And the people who built it are all gone, which leaves one question.'),
      line(60, 'So who is paying the bill?'),
      line(75, 'That is the story.'),
    ];

    expect(firstMinute(segments)).toEqual({
      text: 'In 1987 a machine was switched on. Nobody has switched it off since. And the people who built it are all gone, which leaves one question.',
      lines: 3,
      lastLineAtSeconds: 58,
      words: 26,
    });
  });

  test('leaves out the labels captions carry for sounds, and tidies the spaces', () => {
    const segments = [line(0, '[Music]'), line(2, 'the  river\nwas gone'), line(9, '[Applause] ')];

    expect(firstMinute(segments)).toMatchObject({ text: 'the river was gone', words: 4 });
  });

  test('can be asked for another length', () => {
    const segments = [line(0, 'one'), line(20, 'two'), line(40, 'three')];

    expect(firstMinute(segments, 30)?.text).toBe('one two');
  });

  test('is nothing when no words are said inside the minute', () => {
    expect(firstMinute([])).toBeNull();
    expect(firstMinute([line(0, '[Music]'), line(90, 'at last, a word')])).toBeNull();
  });
});

describe('which videos a hook library is built from', () => {
  const breakout = (videoId: string, score: number, peer: boolean) => ({ videoId, score, peer });

  test('the look-alikes’ breakouts, highest score first, up to the cap', () => {
    const breakouts = [
      breakout('aaaaaaaaaa1', 3, true),
      breakout('bbbbbbbbbb1', 40, false),
      breakout('cccccccccc1', 9, true),
      breakout('dddddddddd1', 5, true),
    ];

    expect(pickHookVideos(breakouts, 2).map((one) => one.videoId)).toEqual([
      'cccccccccc1',
      'dddddddddd1',
    ]);
  });

  test('every breakout on the map when no look-alike has one', () => {
    const breakouts = [breakout('aaaaaaaaaa1', 3, false), breakout('bbbbbbbbbb1', 40, false)];

    expect(pickHookVideos(breakouts).map((one) => one.videoId)).toEqual([
      'bbbbbbbbbb1',
      'aaaaaaaaaa1',
    ]);
  });

  test('never a video whose id is not a video id', () => {
    expect(pickHookVideos([breakout('../etc', 9, true)])).toEqual([]);
  });
});

describe('reading the style an engine gave each hook', () => {
  const A = 'aaaaaaaaaa1';
  const B = 'bbbbbbbbbb1';
  const entry = (video: string, style: string, how = 'It opens on a number nobody expects.') =>
    [`VIDEO: ${video}`, `STYLE: ${style}`, `HOW: ${how}`].join('\n');

  test('keeps a style name and one sentence for each video it was sent', () => {
    const answer = [
      entry(A, 'Number Shock'),
      '',
      entry(B, 'cold open', 'It starts mid-scene.'),
    ].join('\n');

    expect(parseHookLabels(answer, [A, B])).toEqual({
      labels: [
        { videoId: A, style: 'number shock', how: 'It opens on a number nobody expects.' },
        { videoId: B, style: 'cold open', how: 'It starts mid-scene.' },
      ],
      unread: 0,
    });
  });

  test('keeps nothing for a video it did not send, and the first label of one named twice', () => {
    const answer = [entry('zzzzzzzzzz9', 'made up'), entry(A, 'first'), entry(A, 'second')].join(
      '\n\n',
    );

    const { labels } = parseHookLabels(answer, [A, B]);

    expect(labels).toEqual([
      { videoId: A, style: 'first', how: 'It opens on a number nobody expects.' },
    ]);
  });

  test.each([
    ['a style of more than three words', entry(A, 'a very long style name indeed')],
    ['no style', `VIDEO: ${A}\nHOW: It starts mid-scene.`],
    ['no sentence on how it works', `VIDEO: ${A}\nSTYLE: cold open`],
  ])('counts an entry with %s as unread', (_name, answer) => {
    expect(parseHookLabels(answer, [A])).toEqual({ labels: [], unread: 1 });
  });
});
