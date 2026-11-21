import { describe, expect, test } from 'vitest';
import { createExtrasApi } from '../src/lib/extrasApi';
import {
  NOT_A_VERDICT,
  PLACE_LABELS,
  aiLine,
  overlapLine,
  stageLine,
  uncheckedLine,
  type RiskView,
} from '../src/lib/risk';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const NOW = new Date('2026-11-21T12:00:00Z');

describe('the risk check wording', () => {
  test('says it is a list of what to look at, not a verdict', () => {
    expect(NOT_A_VERDICT).toBe(
      'A list of things to look at before you publish. It is not legal advice, and it says nothing about whether YouTube’s rules allow anything.',
    );
    expect(PLACE_LABELS).toEqual({
      title: 'Title',
      'alt-title': 'Alternate title',
      thumbnail: 'Thumbnail brief',
      overlay: 'Overlay',
    });
  });

  test('says what was checked against what', () => {
    expect(stageLine('tightened', 34)).toBe(
      'Checked the tightened script against 34 stored transcripts of look-alikes on this map.',
    );
    expect(stageLine('draft', 0)).toBe(
      'Checked the draft. No transcript of a look-alike on this map is stored, so nothing could be compared; Download transcripts stores some.',
    );
  });

  test('describes an overlap and the facts still marked', () => {
    expect(
      overlapLine({
        id: 'o1',
        sentence: 'S.',
        videoId: 'abcdefghijk',
        phrase: 'a b c d e f',
        words: 6,
      }),
    ).toBe('Shares 6 words in a row with a stored transcript: “a b c d e f”');
    expect(uncheckedLine(0)).toBe('No fact is still marked to check.');
    expect(uncheckedLine(2)).toBe('2 facts are still marked to check, counted in the script.');
  });

  test('says who checked the claims, when, and whether the script changed since', () => {
    const ai = {
      claims: [],
      notes: [],
      engine: 'claude',
      checkedAt: '2026-11-21T11:00:00Z',
      scriptChangedSince: false,
    };
    expect(aiLine(ai, NOW)).toBe('Claims checked by claude 1 hour ago.');
    expect(aiLine({ ...ai, scriptChangedSince: true }, NOW)).toBe(
      'Claims checked by claude 1 hour ago. The script has changed since, so check again.',
    );
  });
});

describe('the risk API', () => {
  test('reads a check and starts one', async () => {
    const view: RiskView = { centerChannelId: CHANNEL, concepts: [], check: null };
    const sent: string[] = [];
    const api = createExtrasApi(async (url, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`.trim());
      const data = init?.method === 'POST' ? { jobId: 'j2' } : view;
      return new Response(JSON.stringify({ success: true, data, error: null }));
    });

    await expect(api.risk(CHANNEL, 4)).resolves.toEqual(view);
    await api.risk(CHANNEL, null);
    await expect(api.askRisk(CHANNEL, 4)).resolves.toBe('j2');
    expect(sent).toEqual([
      `GET /api/risk?channel=${CHANNEL}&concept=4`,
      `GET /api/risk?channel=${CHANNEL}`,
      `POST /api/risk/ask {"channel":"${CHANNEL}","conceptId":4}`,
    ]);
  });
});
