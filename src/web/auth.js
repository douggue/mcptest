// Single-owner authentication: password (scrypt) + optional TOTP, HttpOnly session cookies.
const config = require('../config');
const { get, run, getSetting, setSetting, logEvent } = require('../db');
const { hashPassword, verifyPassword, verifyTotp, newTotpSecret, encrypt, decrypt, token } = require('../crypto');
const { httpError } = require('../http');

const COOKIE = 'studio_session';
const IDLE_MS = 12 * 3600 * 1000;
const attempts = new Map(); // ip -> { count, resetAt }

function clientIp(req) {
  if (process.env.TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress;
}

function isSecure(req) {
  if (config.COOKIE_SECURE === 'true') return true;
  if (config.COOKIE_SECURE === 'false') return false;
  return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (isSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const admin = () => getSetting('admin');

function session(req) {
  const id = parseCookies(req)[COOKIE];
  if (!id) return null;
  const s = get('SELECT * FROM sessions WHERE id = ?', id);
  if (!s || s.expires_at < Date.now()) return null;
  if (s.expires_at - Date.now() < IDLE_MS - 5 * 60000) run('UPDATE sessions SET expires_at = ? WHERE id = ?', Date.now() + IDLE_MS, id);
  return s;
}

function requireAuth(req) {
  const s = session(req);
  const a = admin();
  if (!s || !a) throw httpError(401, 'Sign in required');
  if (a.totpEnabled && !s.mfa_ok) throw httpError(401, 'Two-factor code required');
  return s;
}

function rateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const a = attempts.get(ip) || { count: 0, resetAt: now + 15 * 60000 };
  if (now > a.resetAt) { a.count = 0; a.resetAt = now + 15 * 60000; }
  a.count++;
  attempts.set(ip, a);
  if (a.count > 8) throw httpError(429, 'Too many attempts. Try again in a few minutes.');
}

function state(req) {
  const a = admin();
  const s = session(req);
  return {
    setupNeeded: !a,
    setupCodeRequired: !a && !!config.SETUP_CODE,
    authenticated: !!(s && a && (!a.totpEnabled || s.mfa_ok)),
    mfaRequired: !!(s && a && a.totpEnabled && !s.mfa_ok),
    mfaEnabled: !!(a && a.totpEnabled),
  };
}

function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 10) throw httpError(400, 'Use a password of at least 10 characters');
}

function createSession(req, res, mfaOk) {
  const id = token(32);
  run('INSERT INTO sessions (id, created_at, expires_at, mfa_ok, ip, agent) VALUES (?, ?, ?, ?, ?, ?)',
    id, Date.now(), Date.now() + IDLE_MS, mfaOk ? 1 : 0, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 200));
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  setCookie(req, res, id, IDLE_MS / 1000);
}

function setup(req, res, body) {
  if (admin()) throw httpError(409, 'Already set up');
  rateLimit(req);
  if (config.SETUP_CODE && body.setupCode !== config.SETUP_CODE) throw httpError(403, 'Setup code is incorrect (see SETUP_CODE in your .env)');
  validatePassword(body.password);
  setSetting('admin', { passwordHash: hashPassword(body.password), totpEnabled: false, createdAt: Date.now() });
  logEvent('info', 'security', 'Owner account created');
  createSession(req, res, true);
}

function login(req, res, body) {
  rateLimit(req);
  const a = admin();
  if (!a || !verifyPassword(body.password || '', a.passwordHash)) {
    logEvent('warn', 'security', `Failed sign-in from ${clientIp(req)}`);
    throw httpError(401, 'Incorrect password');
  }
  attempts.delete(clientIp(req));
  createSession(req, res, !a.totpEnabled);
  logEvent('info', 'security', `Signed in from ${clientIp(req)}`);
  return { mfaRequired: !!a.totpEnabled };
}

function mfaVerify(req, body) {
  rateLimit(req);
  const s = session(req);
  const a = admin();
  if (!s || !a || !a.totpEnabled) throw httpError(401, 'Sign in first');
  if (!verifyTotp(decrypt(a.totpSecretEnc), body.code)) throw httpError(401, 'Invalid code');
  run('UPDATE sessions SET mfa_ok = 1 WHERE id = ?', s.id);
  attempts.delete(clientIp(req));
}

function logout(req, res) {
  const s = session(req);
  if (s) run('DELETE FROM sessions WHERE id = ?', s.id);
  setCookie(req, res, '', 0);
}

function changePassword(req, body) {
  const a = admin();
  if (!verifyPassword(body.current || '', a.passwordHash)) throw httpError(400, 'Current password is incorrect');
  validatePassword(body.next);
  setSetting('admin', { ...a, passwordHash: hashPassword(body.next) });
  const s = session(req);
  run('DELETE FROM sessions WHERE id != ?', s.id); // sign out everywhere else
  logEvent('info', 'security', 'Password changed');
}

function mfaBegin() {
  const secret = newTotpSecret();
  setSetting('mfaPending', encrypt(secret));
  const uri = `otpauth://totp/Stream%20Studio:owner?secret=${secret}&issuer=Stream%20Studio&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

function mfaEnable(body) {
  const pending = getSetting('mfaPending');
  if (!pending) throw httpError(400, 'Start setup first');
  const secret = decrypt(pending);
  if (!verifyTotp(secret, body.code)) throw httpError(400, 'That code did not match. Check the time on your phone and try again.');
  setSetting('admin', { ...admin(), totpEnabled: true, totpSecretEnc: encrypt(secret) });
  setSetting('mfaPending', null);
  logEvent('info', 'security', 'Two-factor authentication enabled');
}

function mfaDisable(body) {
  const a = admin();
  if (!verifyPassword(body.password || '', a.passwordHash)) throw httpError(400, 'Password is incorrect');
  if (!verifyTotp(decrypt(a.totpSecretEnc), body.code)) throw httpError(400, 'Invalid code');
  setSetting('admin', { ...a, totpEnabled: false, totpSecretEnc: null });
  logEvent('warn', 'security', 'Two-factor authentication disabled');
}

module.exports = { state, setup, login, mfaVerify, logout, requireAuth, changePassword, mfaBegin, mfaEnable, mfaDisable, clientIp };
