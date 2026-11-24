import { describe, expect, test } from 'vitest';
import { askContext, askPlaceholder, starterFor } from '../src/lib/askContext';
import type { Route, ViewId } from '../src/lib/routes';

const CENTER = { id: 'UC0UJp3kmO7wf33XFf56gbTw', title: 'Mine', logoUrl: null };
const OTHER = { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', title: 'Theirs' };
const map = { center: CENTER, channels: [OTHER, { id: 'x', title: 'Third' }] };
const at = (view: ViewId, channelId: string | null = null): Route => ({
  view,
  channelId,
  anchor: null,
});

describe('what Ask knows about the screen', () => {
  test('is nothing before any map', () => {
    expect(askContext(at('home'), null)).toBeNull();
  });

  test('is the map’s own channel and how many channels stand behind it', () => {
    expect(askContext(at('breakouts'), map)).toEqual({
      about: CENTER,
      scope: 'and its map of 2 channels',
      subject: null,
    });
    expect(askContext(at('home'), { center: CENTER, channels: [OTHER] })?.scope).toBe(
      'and its map of 1 channel',
    );
  });

  test('names another channel whose page or study is on screen', () => {
    expect(askContext(at('channel', OTHER.id), map)?.subject).toEqual(OTHER);
    expect(askContext(at('breakdown', OTHER.id), map)?.subject).toEqual(OTHER);
  });

  test('names no subject on the owner’s own page, an unknown channel or another screen', () => {
    expect(askContext(at('channel', CENTER.id), map)?.subject).toBeNull();
    expect(askContext(at('channel'), map)?.subject).toBeNull();
    expect(askContext(at('channel', 'UCnotOnTheMap0000000000x'), map)?.subject).toBeNull();
    expect(askContext({ ...at('ideas'), channelId: OTHER.id }, map)?.subject).toBeNull();
  });

  test('starts a question with the channel on screen, and hints at it', () => {
    expect(starterFor(OTHER)).toBe('About Theirs: ');
    const withSubject = askContext(at('channel', OTHER.id), map);
    const without = askContext(at('home'), map);
    expect(withSubject && askPlaceholder(withSubject)).toBe('Ask about Theirs, or this map');
    expect(without && askPlaceholder(without)).toBe('Ask about this map, a channel or a video');
  });
});
