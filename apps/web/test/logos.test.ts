import type { MapSnapshot, SavedChannel } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  LOGO_MAX_ROUNDS,
  afterLogoRun,
  afterLogoStart,
  createLogoApi,
  describeLogoRun,
  needsLogos,
  withLogos,
  withSavedLogos,
} from '../src/lib/logos';

const LOGO = 'https://yt3.googleusercontent.com/a';
const snapshotOf = (center: string | null, others: Array<string | null | undefined>): MapSnapshot =>
  ({
    center: { id: 'centre', title: 'Centre', logoUrl: center },
    channels: others.map((logoUrl, n) => ({ id: `c${n}`, title: `C${n}`, logoUrl })),
  }) as unknown as MapSnapshot;

const reply = (status: number, data: unknown, error: string | null = null) =>
  new Response(JSON.stringify({ success: status < 400, data, error, meta: null }), { status });

describe('needsLogos', () => {
  test('is true when the centre or any channel has no logo', () => {
    expect(needsLogos(snapshotOf(LOGO, [LOGO, null]))).toBe(true);
    expect(needsLogos(snapshotOf(null, [LOGO]))).toBe(true);
    expect(needsLogos(snapshotOf(LOGO, [undefined]))).toBe(true);
  });

  test('is false when every channel has one', () => {
    expect(needsLogos(snapshotOf(LOGO, [LOGO, LOGO]))).toBe(false);
  });
});

describe('withLogos', () => {
  test('puts each logo found on its channel and leaves the rest as they were', () => {
    const before = snapshotOf(null, [null, LOGO, null]);

    const after = withLogos(before, [
      { channelId: 'centre', logoUrl: `${LOGO}1` },
      { channelId: 'c0', logoUrl: `${LOGO}2` },
      { channelId: 'c2', logoUrl: null },
      { channelId: 'unknown', logoUrl: `${LOGO}3` },
    ]);

    expect(after.center.logoUrl).toBe(`${LOGO}1`);
    expect(after.channels.map((channel) => channel.logoUrl)).toEqual([`${LOGO}2`, LOGO, null]);
    expect(before.center.logoUrl).toBeNull();
  });

  test('gives back the same snapshot when nothing changes, so nothing is drawn again', () => {
    const before = snapshotOf(LOGO, [null]);

    expect(withLogos(before, [])).toBe(before);
    expect(withLogos(before, [{ channelId: 'c0', logoUrl: null }])).toBe(before);
  });
});

describe('withSavedLogos', () => {
  const saved = [
    { id: 'a', title: 'A', logoUrl: null },
    { id: 'b', title: 'B', logoUrl: LOGO },
  ] as unknown as readonly SavedChannel[];

  test('puts a logo found on the saved channel it belongs to', () => {
    const after = withSavedLogos(saved, [{ channelId: 'a', logoUrl: `${LOGO}1` }]);

    expect(after.map((channel) => channel.logoUrl)).toEqual([`${LOGO}1`, LOGO]);
  });

  test('gives back the same list when nothing changes', () => {
    expect(withSavedLogos(saved, [{ channelId: 'b', logoUrl: LOGO }])).toBe(saved);
    expect(withSavedLogos(saved, [{ channelId: 'a', logoUrl: null }])).toBe(saved);
  });
});

describe('afterLogoStart', () => {
  test('follows a job that was started', () => {
    expect(afterLogoStart({ kind: 'started', jobId: 'j1', missing: 4 }, 1)).toEqual({
      kind: 'follow',
      jobId: 'j1',
    });
  });

  test('stops when nothing is missing, and asks again later when YouTube is being read', () => {
    expect(afterLogoStart({ kind: 'none' }, 1)).toEqual({ kind: 'stop' });
    expect(afterLogoStart({ kind: 'busy' }, 1)).toEqual({ kind: 'later' });
  });

  test('gives up after the last round', () => {
    expect(afterLogoStart({ kind: 'busy' }, LOGO_MAX_ROUNDS)).toEqual({ kind: 'stop' });
  });
});

describe('afterLogoRun', () => {
  test('asks for the next batch at once when the run read its whole list', () => {
    expect(afterLogoRun({ asked: 60, found: 58, failed: 2, stoppedEarly: false }, 1)).toEqual({
      kind: 'again',
    });
  });

  test('waits when the run was cut short', () => {
    expect(afterLogoRun({ asked: 3, found: 0, failed: 3, stoppedEarly: true }, 1)).toEqual({
      kind: 'later',
    });
  });

  test('stops when the job failed or the rounds are used up', () => {
    expect(afterLogoRun(null, 1)).toEqual({ kind: 'stop' });
    expect(
      afterLogoRun({ asked: 60, found: 60, failed: 0, stoppedEarly: false }, LOGO_MAX_ROUNDS),
    ).toEqual({ kind: 'stop' });
  });
});

describe('describeLogoRun', () => {
  test('says how far the fetch has got', () => {
    expect(describeLogoRun({ done: 3, total: 40, logos: [] })).toBe(
      'Fetching channel logos: 3 of 40',
    );
    expect(describeLogoRun(null)).toBe('Fetching channel logos');
  });
});

describe('createLogoApi', () => {
  test('starts a job and reads it', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const api = createLogoApi(async (path, init) => {
      calls.push([path, init]);
      return path === '/api/logos'
        ? reply(202, { jobId: 'j1', missing: 2 })
        : reply(200, { id: 'j1', status: 'running', progress: null, result: null, error: null });
    });

    expect(await api.start('UCabc')).toEqual({ kind: 'started', jobId: 'j1', missing: 2 });
    expect((await api.job('j1')).status).toBe('running');
    expect(calls[0]?.[1]?.method).toBe('POST');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ channel: 'UCabc' }));
    expect(calls[1]?.[0]).toBe('/api/jobs/j1');
  });

  test('tells nothing missing, busy and no map apart from a failure', async () => {
    const answer = (response: Response) => createLogoApi(async () => response).start('UCabc');

    expect(await answer(reply(200, { jobId: null, missing: 0 }))).toEqual({ kind: 'none' });
    expect(await answer(reply(409, null, 'busy'))).toEqual({ kind: 'busy' });
    expect(await answer(reply(404, null, 'no map'))).toEqual({ kind: 'none' });
    await expect(answer(reply(500, null, 'broken'))).rejects.toThrow('broken');
  });
});
