import { describe, expect, test } from 'vitest';
import { askAbout, askContext, askPlaceholder, quickLabel } from '../src/lib/askContext';
import type { Route, ViewId } from '../src/lib/routes';

const CENTER = { id: 'UC0UJp3kmO7wf33XFf56gbTw', title: 'Mine', logoUrl: null };
const OTHER = { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', title: 'Theirs', logoUrl: 'https://x/y.jpg' };
const STRANGER = 'UCnotOnTheMap0000000000x';
const VIDEO = 'dQw4w9WgXcQ';
const map = { center: CENTER, channels: [OTHER, { id: 'x', title: 'Third' }] };
const at = (view: ViewId, channelId: string | null = null): Route => ({
  view,
  channelId,
  anchor: null,
});
const video: Route = { ...at('video'), videoId: VIDEO };

describe('what Ask is about', () => {
  test('is nothing before any map', () => {
    expect(askContext(at('home'), null)).toBeNull();
    expect(askAbout(null)).toBeUndefined();
  });

  test('is the owner’s channel and its map on most screens, with how many channels stand behind it', () => {
    expect(askContext(at('breakouts'), map)).toEqual({
      center: CENTER,
      chip: { kind: 'map', id: CENTER.id, title: 'Mine', logoUrl: null },
      reads: 'and its map of 2 channels',
      cannot: null,
    });
    expect(askContext(at('home'), { center: CENTER, channels: [OTHER] })?.reads).toBe(
      'and its map of 1 channel',
    );
    expect(askContext(at('channel', CENTER.id), map)?.chip.kind).toBe('map');
    expect(askContext(at('channel'), map)?.chip.kind).toBe('map');
    expect(askContext({ ...at('hooks'), channelId: OTHER.id }, map)?.chip.kind).toBe('map');
  });

  test('is another channel on its page, by name when the map knows it', () => {
    const known = askContext(at('channel', OTHER.id), map);
    expect(known?.chip).toEqual({
      kind: 'channel',
      id: OTHER.id,
      title: 'Theirs',
      logoUrl: 'https://x/y.jpg',
    });
    expect(known?.reads).toBe('read from its stored videos and the map of Mine');
    expect(askContext(at('channel', STRANGER), map)?.chip).toEqual({
      kind: 'channel',
      id: STRANGER,
      title: 'This channel',
      logoUrl: null,
    });
  });

  test('is the video on its page', () => {
    const context = askContext(video, map);
    expect(context?.chip).toEqual({ kind: 'video', id: VIDEO, title: 'This video' });
    expect(context?.reads).toBe('read from your stored videos and the map of Mine');
    expect(askContext(at('video'), map)?.chip.kind).toBe('map');
  });

  test('says plainly that the AI does not read the owner’s own writing', () => {
    for (const view of ['script', 'risk', 'ideas'] as const) {
      const context = askContext(at(view), map);
      expect(context?.chip.kind).toBe('map');
      expect(context?.cannot).toBe(
        'The AI reads stored channels and videos, not your ideas or scripts.',
      );
    }
    expect(askContext(at('breakouts'), map)?.cannot).toBeNull();
  });

  test('sends the id of what it is about with the question, and nothing for the map', () => {
    expect(askAbout(askContext(at('channel', OTHER.id), map))).toEqual({ channelId: OTHER.id });
    expect(askAbout(askContext(video, map))).toEqual({ videoId: VIDEO });
    expect(askAbout(askContext(at('home'), map))).toBeUndefined();
  });

  test('hints at it in the question box, and says the quick questions are about the map', () => {
    const channel = askContext(at('channel', OTHER.id), map);
    const stranger = askContext(at('channel', STRANGER), map);
    const onVideo = askContext(video, map);
    const plain = askContext(at('home'), map);
    expect(channel && askPlaceholder(channel)).toBe('Ask about Theirs');
    expect(stranger && askPlaceholder(stranger)).toBe('Ask about this channel');
    expect(onVideo && askPlaceholder(onVideo)).toBe('Ask about this video');
    expect(plain && askPlaceholder(plain)).toBe('Ask about this map, a channel or a video');
    expect(channel && quickLabel(channel)).toBe('About the whole map of Mine:');
    expect(plain && quickLabel(plain)).toBeNull();
  });
});
