// Outbound alerts to a webhook (Discord, Slack, ntfy or any JSON endpoint).
const { prefs } = require('./db');

async function notify(title, message, level = 'info', urlOverride) {
  const url = urlOverride || prefs().webhookUrl;
  if (!url) return { sent: false };
  const icon = level === 'error' ? '🔴' : level === 'warn' ? '🟠' : '🟢';
  const text = `${icon} ${title}${message ? ` — ${message}` : ''}`;
  let body, headers = { 'Content-Type': 'application/json' };
  if (/discord(app)?\.com\/api\/webhooks/.test(url)) body = JSON.stringify({ content: text });
  else if (/hooks\.slack\.com/.test(url)) body = JSON.stringify({ text });
  else if (/ntfy\./.test(url)) { body = message || title; headers = { Title: title, Priority: level === 'error' ? 'high' : 'default', Tags: level }; }
  else body = JSON.stringify({ title, message, level, text, ts: new Date().toISOString(), source: 'stream-studio' });
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(6000) });
    return { sent: r.ok, status: r.status };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

module.exports = { notify };
