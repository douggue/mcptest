import { describe, expect, test } from 'vitest';
import { createFollowedApi, followedLine, rowLine } from '../src/lib/formatFollowed';
import { createFormatBuilderApi } from '../src/lib/formatBuilder';

const envelope = (data: unknown, status = 200, error: string | null = null) =>
  new Response(JSON.stringify({ success: status < 400, data, error }), { status });

describe('your videos against the active format', () => {
  test('reads the counts for a channel; none when it has no active format', async () => {
    const paths: string[] = [];
    const api = createFollowedApi(async (input) => {
      paths.push(String(input));
      return String(input).includes('UCbb')
        ? envelope(null, 404, 'This channel has no active format yet.')
        : envelope({
            format: { id: 1, name: 'Long-form' },
            report: { videos: 0, slots: [], rows: [] },
          });
    });
    expect(await api.followed('UCaaaaaaaaaaaaaaaaaaaaaa')).toMatchObject({
      format: { name: 'Long-form' },
    });
    expect(await api.followed('UCbbbbbbbbbbbbbbbbbbbbbb')).toBeNull();
    expect(paths[0]).toBe('/api/format/followed?channel=UCaaaaaaaaaaaaaaaaaaaaaa');
    const failing = createFollowedApi(async () => envelope(null, 500, 'Broken'));
    await expect(failing.followed('UCaaaaaaaaaaaaaaaaaaaaaa')).rejects.toThrow('Broken');
  });

  test('says per slot how many followed it and how they did, with the counts', () => {
    expect(
      followedLine({
        layer: 'title',
        check: 'title fits one of its formulas',
        followed: 2,
        not: 3,
        unknown: 1,
        medianScoreFollowed: 4,
        medianScoreNot: 1.25,
      }),
    ).toBe(
      'Title formula: 2 of 6 followed it (median 4×), 3 did not (median 1.3×), 1 not measured.',
    );
    expect(
      followedLine({
        layer: 'pacing',
        check: 'c',
        followed: 1,
        not: 0,
        unknown: 0,
        medianScoreFollowed: null,
        medianScoreNot: null,
      }),
    ).toBe('Pacing: 1 of 1 followed it (no score yet), 0 did not.');
    expect(
      rowLine({ videoId: 'v', title: 'T', score: null, followed: ['title'], not: ['pacing'] }),
    ).toBe('Followed: Title formula · Not: Pacing');
    expect(
      followedLine({
        layer: 'visual',
        check: 'c',
        followed: 0,
        not: 0,
        unknown: 6,
        medianScoreFollowed: null,
        medianScoreNot: null,
      }),
    ).toBe('Visual style: none of your 6 videos is measured yet, so code cannot tell.');
    expect(rowLine({ videoId: 'v', title: 'T', score: null, followed: [], not: [] })).toBe(
      'Nothing code could check',
    );
  });

  test('the builder makes a format active, or none, for a channel', async () => {
    const sent: unknown[] = [];
    const api = createFormatBuilderApi(async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return envelope({ formats: [] });
    });
    expect(await api.setActive('UCaaaaaaaaaaaaaaaaaaaaaa', 3)).toEqual([]);
    await api.setActive('UCaaaaaaaaaaaaaaaaaaaaaa', null);
    expect(sent).toEqual([
      { channel: 'UCaaaaaaaaaaaaaaaaaaaaaa', id: 3 },
      { channel: 'UCaaaaaaaaaaaaaaaaaaaaaa', id: null },
    ]);
  });
});
