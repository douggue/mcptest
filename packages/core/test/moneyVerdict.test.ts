import { describe, expect, test } from 'vitest';
import { moneyBar, moneyVerdict, type StoredMoneySigns } from '../src/money/verdict';

const ID = `UC${'A'.repeat(22)}`;
const AT = new Date('2026-11-21T10:00:00Z');
const signs = (memberships: boolean, ads: StoredMoneySigns['ads']): StoredMoneySigns => ({
  channelId: ID,
  videoId: 'abcdefghijk',
  memberships,
  ads,
  checkedAt: AT,
});
const channel = { id: ID, subscribers: 1_500, subscribersHidden: false };

describe('moneyVerdict', () => {
  test('memberships make it monetized, and the verdict names the sign', () => {
    const verdict = moneyVerdict(channel, signs(true, 'unknown'));
    expect(verdict).toMatchObject({
      channelId: ID,
      status: 'monetized',
      says: 'Monetized (sign: memberships)',
      short: '$ Monetized',
      checkedAt: AT.toISOString(),
      videoId: 'abcdefghijk',
    });
    expect(verdict.sign).toMatch(/Join button/);
    expect(verdict.sign).toMatch(/Partner Program/);
  });

  test('memberships win over ads', () => {
    expect(moneyVerdict(channel, signs(true, 'shown')).status).toBe('monetized');
  });

  test('ads alone are likely, never proof', () => {
    const verdict = moneyVerdict(channel, signs(false, 'shown'));
    expect(verdict.status).toBe('likely');
    expect(verdict.says).toBe('Likely monetized (ads shown; not proof)');
    expect(verdict.short).toBe('$? Likely');
    expect(verdict.sign).toMatch(/not proof/);
  });

  test('no Join button and no ads on a playable page is "not yet as far as public signs show"', () => {
    const verdict = moneyVerdict(channel, signs(false, 'none'));
    expect(verdict.status).toBe('not-yet');
    expect(verdict.says).toBe('Not monetized yet as far as public signs show');
    expect(verdict.short).toBe('Not yet');
    expect(verdict.sign).toMatch(/no ads were shown/);
  });

  test('no Join button while ads could not be seen is no sign, never "not yet"', () => {
    const verdict = moneyVerdict(channel, signs(false, 'unknown'));
    expect(verdict.status).toBe('no-sign');
    expect(verdict.says).toBe('No public sign found (ads could not be seen)');
    expect(verdict.short).toBe('No sign');
    expect(verdict.sign).toMatch(/ads could not be seen/);
  });

  test('never checked says so and rests on nothing', () => {
    expect(moneyVerdict(channel, null)).toMatchObject({
      status: 'not-checked',
      says: 'Not checked',
      short: 'Not checked',
      sign: null,
      checkedAt: null,
      videoId: null,
    });
  });
});

describe('moneyBar', () => {
  test.each([
    [1_000, 'over-1000', '1,000+ subscribers'],
    [999, 'over-500', '500 to 999 subscribers'],
    [500, 'over-500', '500 to 999 subscribers'],
    [499, 'under-500', 'Under the 500 bar'],
  ])('%i subscribers', (subscribers, key, says) => {
    expect(moneyBar({ subscribers, subscribersHidden: false })).toMatchObject({
      key,
      says,
      subscribers,
    });
  });

  test('a hidden or unread count is not guessed', () => {
    expect(moneyBar({ subscribers: 5_000, subscribersHidden: true })).toMatchObject({
      key: 'hidden',
      subscribers: null,
    });
    expect(moneyBar({ subscribers: null, subscribersHidden: false }).key).toBe('hidden');
  });

  test('every bar says it is eligibility only', () => {
    expect(moneyBar({ subscribers: 10, subscribersHidden: false }).note).toMatch(/not public/);
  });
});
