const test = require('node:test');
const assert = require('node:assert');
const { nextAfter, latestDue, zonedToUtc } = require('../src/schedule');
const { totp, verifyTotp, encrypt, decrypt, hashPassword, verifyPassword } = require('../src/crypto');
const { ingestUrl, validateServerUrl } = require('../src/platforms');

test('zonedToUtc handles DST in New York', () => {
  assert.strictEqual(new Date(zonedToUtc(2026, 7, 1, 20, 0, 'America/New_York')).toISOString(), '2026-07-02T00:00:00.000Z'); // EDT
  assert.strictEqual(new Date(zonedToUtc(2026, 12, 1, 20, 0, 'America/New_York')).toISOString(), '2026-12-02T01:00:00.000Z'); // EST
});

test('recurring schedule keeps wall-clock time across DST change', () => {
  const s = { type: 'recurring', time: '20:00', days: [0, 1, 2, 3, 4, 5, 6], tz: 'America/New_York' };
  const before = nextAfter(s, Date.parse('2026-10-31T12:00:00Z'));
  const after = nextAfter(s, Date.parse('2026-11-02T12:00:00Z'));
  assert.strictEqual(new Date(before).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.strictEqual(new Date(after).toISOString(), '2026-11-03T01:00:00.000Z');
});

test('weekday filter and until date', () => {
  const s = { type: 'recurring', time: '09:30', days: [1], tz: 'UTC', until: '2026-11-20' };
  const t = nextAfter(s, Date.parse('2026-11-12T00:00:00Z')); // Thu → next Monday 16th
  assert.strictEqual(new Date(t).toISOString(), '2026-11-16T09:30:00.000Z');
  assert.strictEqual(nextAfter(s, t), null);
});

test('once and latestDue', () => {
  const s = { type: 'once', at: '2026-11-12T10:00:00Z' };
  assert.strictEqual(nextAfter(s, Date.parse('2026-11-12T09:00:00Z')), Date.parse('2026-11-12T10:00:00Z'));
  assert.strictEqual(nextAfter(s, Date.parse('2026-11-12T10:00:00Z')), null);
  const daily = { type: 'recurring', time: '10:00', days: [], tz: 'UTC' };
  assert.strictEqual(latestDue(daily, Date.parse('2026-11-10T00:00:00Z'), Date.parse('2026-11-12T11:00:00Z')), Date.parse('2026-11-12T10:00:00Z'));
  assert.strictEqual(latestDue(daily, Date.parse('2026-11-12T10:00:00Z'), Date.parse('2026-11-12T11:00:00Z')), null);
});

test('crypto helpers', () => {
  assert.strictEqual(decrypt(encrypt('live_abc-123')), 'live_abc-123');
  const h = hashPassword('correct horse battery');
  assert.ok(verifyPassword('correct horse battery', h));
  assert.ok(!verifyPassword('wrong', h));
  // RFC 6238 test vector (SHA1, secret "12345678901234567890")
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.strictEqual(totp(secret, 59000), '287082');
  assert.ok(verifyTotp(secret, totp(secret)));
});

test('platform URLs', () => {
  assert.strictEqual(ingestUrl('rtmps://live-api-s.facebook.com:443/rtmp/', 'KEY'), 'rtmps://live-api-s.facebook.com:443/rtmp/KEY');
  assert.strictEqual(ingestUrl('rtmp://a.rtmp.youtube.com/live2', 'KEY'), 'rtmp://a.rtmp.youtube.com/live2/KEY');
  assert.ok(validateServerUrl('http://x.com'));
  assert.ok(validateServerUrl('rtmp://127.0.0.1/app'));
  assert.strictEqual(validateServerUrl('rtmps://a.rtmps.youtube.com:443/live2'), null);
});
