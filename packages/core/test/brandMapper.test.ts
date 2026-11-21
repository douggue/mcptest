import { describe, expect, test } from 'vitest';
import { mapChannelBrand, parseKeywords } from '../src/sources/brandMapper';
import small from './fixtures/channel-small.json';
import large from './fixtures/channel.json';

describe('mapChannelBrand', () => {
  test('reads the logo, the cover and the bio of a large channel', () => {
    const brand = mapChannelBrand(large.header, large.metadata);

    expect(brand.description).toMatch(/^An element of truth - videos about science/);
    expect(brand.avatar.map((image) => image.width)).toEqual([200, 160, 120, 72]);
    expect(brand.banner[0]).toMatchObject({ width: 2560, height: 424 });
    expect(brand.banner).toHaveLength(6);
    for (const image of [...brand.avatar, ...brand.banner]) {
      expect(new URL(image.url).hostname).toBe('yt3.googleusercontent.com');
    }
  });

  test('reads a small channel that has a logo and nothing else', () => {
    const brand = mapChannelBrand(small.header, small.metadata);

    expect(brand).toMatchObject({ description: '', banner: [], keywords: [], links: [] });
    expect(brand.avatar.map((image) => image.width)).toEqual([900, 160, 120, 72]);
  });

  test('takes the full bio over the header’s preview, which is a placeholder when there is none', () => {
    const header = {
      content: { description: { description: { text: 'More about this channel' } } },
    };

    expect(mapChannelBrand(header, { description: '' }).description).toBe('');
    expect(mapChannelBrand(header, { description: 'We bake bread.' }).description).toBe(
      'We bake bread.',
    );
    expect(mapChannelBrand(header, {}).description).toBe('More about this channel');
    expect(mapChannelBrand({}, {}).description).toBeNull();
  });

  test('leaves out a picture on any host but the one channel images are served from', () => {
    const image = (url: string, width = 100) => ({ url, width, height: width });
    const brand = mapChannelBrand(
      {
        content: {
          image: {
            avatar: {
              image: [
                image('https://evil.example/logo.png'),
                image('http://yt3.googleusercontent.com/plain-http'),
                image('https://yt3.googleusercontent.com/ok', 88),
                { url: 'https://yt3.googleusercontent.com/no-size' },
              ],
            },
          },
          banner: { image: [image('javascript:alert(1)')] },
        },
      },
      {},
    );

    expect(brand.avatar).toEqual([
      { url: 'https://yt3.googleusercontent.com/ok', width: 88, height: 88 },
    ]);
    expect(brand.banner).toEqual([]);
  });

  test('reads the keywords and the link shown on the header', () => {
    const brand = mapChannelBrand(
      {
        content: {
          attributation: {
            type: 'AttributionView',
            text: { text: 'patreon.com/somebakery' },
            suffix: { text: 'and 3 more links' },
          },
        },
      },
      { keywords: 'bread "sourdough starter" baking' },
    );

    expect(brand.keywords).toEqual(['bread', 'sourdough starter', 'baking']);
    expect(brand.links).toEqual(['patreon.com/somebakery', 'and 3 more links']);
  });

  test('gives an empty brand for a page it cannot read at all', () => {
    expect(mapChannelBrand(null, undefined)).toEqual({
      description: null,
      avatar: [],
      banner: [],
      keywords: [],
      links: [],
    });
  });
});

describe('parseKeywords', () => {
  test('splits on spaces and keeps a quoted phrase whole', () => {
    expect(parseKeywords('science "physics education" veritasium')).toEqual([
      'science',
      'physics education',
      'veritasium',
    ]);
  });

  test('accepts a list, and reads nothing from anything else', () => {
    expect(parseKeywords(['a', 7, ' b '])).toEqual(['a', 'b']);
    expect(parseKeywords('')).toEqual([]);
    expect(parseKeywords(42)).toEqual([]);
  });

  test('keeps the number and the length of keywords within bounds', () => {
    const many = Array.from({ length: 200 }, (_, n) => `word${n}`).join(' ');

    expect(parseKeywords(many)).toHaveLength(60);
    expect(parseKeywords('x'.repeat(500))[0]).toHaveLength(100);
  });
});
