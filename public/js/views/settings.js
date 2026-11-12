import { h, mount, icon, api, field, input, select, toast, errorToast, store, modal, copyButton } from '../ui.js';

export async function settingsView(root) {
  const p = { ...store.meta.prefs };
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [p.timezone];
  const section = (id, title, sub, ...body) => h('div', { class: 'card card-pad settings-section', id: `set-${id}` }, h('h2', null, title), sub && h('p', { class: 'muted small', style: { margin: '4px 0 16px' } }, sub), ...body);
  const save = async (patch, msg = 'Settings saved') => {
    try { store.meta.prefs = await api('PUT', '/api/settings', patch); Object.assign(p, store.meta.prefs); toast(msg); } catch (e) { errorToast(e); }
  };

  const tzSel = select(zones.map((z) => [z, z.replace(/_/g, ' ')]), p.timezone);
  const quality = select([['1080', '1080p (6 Mbps per output)'], ['720', '720p (3.5 Mbps per output)']], p.quality);
  const auto = select([['native', 'Only the video’s own shape'], ['both', 'Both 16:9 and 9:16']], p.autoPrepare);
  const fit = select([['blur', 'Blurred background'], ['pad', 'Black bars'], ['crop', 'Fill & crop']], p.defaultFit);
  const missed = input({ type: 'number', min: 0, max: 1440, value: p.missedWindowMin });
  const conc = input({ type: 'number', min: 1, max: 10, value: p.maxConcurrent });
  const retries = input({ type: 'number', min: 0, max: 10, value: p.maxRetries });
  const hook = input({ type: 'url', value: p.webhookUrl, placeholder: 'https://discord.com/api/webhooks/… or https://ntfy.sh/your-topic' });

  const mfaBox = h('div');
  const renderMfa = () => {
    if (store.auth.mfaEnabled) {
      const pw = input({ type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
      const code = input({ placeholder: '6-digit code', inputmode: 'numeric' });
      return mount(mfaBox, h('div', { class: 'notice info' }, icon('shield'), 'Two-factor authentication is on.'),
        h('div', { class: 'form-grid', style: { 'margin-top': '12px' } }, field('Password', pw), field('Current code', code)),
        h('button', { class: 'btn danger', style: { 'margin-top': '12px' }, onclick: async () => { try { await api('POST', '/api/auth/mfa/disable', { password: pw.value, code: code.value }); store.auth.mfaEnabled = false; toast('Two-factor turned off', 'warn'); renderMfa(); } catch (e) { errorToast(e); } } }, 'Turn off two-factor'));
    }
    mount(mfaBox, h('p', { class: 'muted small' }, 'Protect the dashboard with a code from Google Authenticator, 1Password, Authy or similar.'),
      h('button', { class: 'btn primary', style: { 'margin-top': '12px' }, onclick: setupMfa }, icon('shield'), 'Set up two-factor'));
  };
  async function setupMfa() {
    const { secret, uri } = await api('POST', '/api/auth/mfa/begin');
    const qrBox = h('div', { class: 'qr' });
    loadQr().then((qrcode) => { if (!qrcode) return; const q = qrcode(0, 'M'); q.addData(uri); q.make(); qrBox.append(h('img', { src: q.createDataURL(6, 2), alt: 'QR code for your authenticator app' })); });
    const code = input({ placeholder: '123456', inputmode: 'numeric', autocomplete: 'one-time-code' });
    await modal({
      title: 'Set up two-factor authentication',
      body: [h('p', { class: 'muted' }, '1. Scan this QR code with your authenticator app.'), qrBox,
        h('div', { class: 'small muted' }, 'Or enter this key manually:'), h('div', { class: 'copy-row' }, h('code', null, secret), copyButton(() => secret)),
        field('2. Enter the 6-digit code it shows', code)],
      actions: [{ label: 'Cancel' }, { label: 'Turn on', kind: 'primary', onClick: async () => { await api('POST', '/api/auth/mfa/enable', { code: code.value }); store.auth.mfaEnabled = true; toast('Two-factor is on'); renderMfa(); } }],
    }).done;
  }
  renderMfa();

  const cur = input({ type: 'password', autocomplete: 'current-password' });
  const next = input({ type: 'password', autocomplete: 'new-password', placeholder: 'At least 10 characters' });

  const nav = h('nav', { class: 'settings-nav' }, [['general', 'General', 'settings'], ['scheduling', 'Scheduling', 'calendar'], ['alerts', 'Alerts', 'bell'], ['security', 'Security', 'shield'], ['encoder', 'OBS & encoders', 'camera']].map(([id, l, ic]) =>
    h('a', { class: 'nav-item', href: `#/settings`, onclick: (e) => { e.preventDefault(); document.getElementById(`set-${id}`).scrollIntoView({ behavior: 'smooth' }); } }, icon(ic), l)));

  mount(root,
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Settings'), h('p', null, 'Defaults for your studio, alerts and account security.'))),
    h('div', { class: 'settings-grid' }, nav, h('div', null,
      section('general', 'General', 'Time zone is used to display and enter schedules.',
        h('div', { class: 'form-grid' },
          field('Time zone', tzSel),
          field('Converted video quality', quality, 'Applies to newly converted videos.'),
          field('Convert new uploads to', auto, '“Both” uses more disk but every video is ready for any format.'),
          field('Default framing when changing shape', fit)),
        h('button', { class: 'btn primary', style: { 'margin-top': '16px' }, onclick: () => save({ timezone: tzSel.value, quality: quality.value, autoPrepare: auto.value, defaultFit: fit.value }) }, 'Save')),
      section('scheduling', 'Scheduling & reliability', 'How the engine behaves when things go wrong.',
        h('div', { class: 'form-grid' },
          field('Late-start window (minutes)', missed, 'If the server was offline at start time, a broadcast still starts within this window; later it is marked “missed”.'),
          field('Max simultaneous broadcasts', conc, 'Protects CPU and upload bandwidth.'),
          field('Reconnect attempts per destination', retries, 'With increasing delays (5s, 15s, 45s…). Other destinations are never affected.')),
        h('button', { class: 'btn primary', style: { 'margin-top': '16px' }, onclick: () => save({ missedWindowMin: missed.value, maxConcurrent: conc.value, maxRetries: retries.value }) }, 'Save')),
      section('alerts', 'Alerts', 'Get a message when a broadcast goes live, ends, fails or a destination drops. Works with Discord, Slack, ntfy (push to your phone) or any JSON webhook.',
        field('Webhook URL', hook),
        h('div', { class: 'row', style: { 'margin-top': '16px' } },
          h('button', { class: 'btn primary', onclick: () => save({ webhookUrl: hook.value }) }, 'Save'),
          h('button', { class: 'btn', onclick: async () => { try { const r = await api('POST', '/api/settings/test-webhook', { url: hook.value }); toast(r.sent ? 'Test alert sent' : `Not sent: ${r.error || r.status || 'no URL'}`, r.sent ? 'ok' : 'err'); } catch (e) { errorToast(e); } } }, icon('bell'), 'Send test'))),
      section('security', 'Security', 'One private owner account. Changing the password signs out every other session.',
        h('h3', null, 'Two-factor authentication'), h('div', { style: { margin: '10px 0 22px' } }, mfaBox),
        h('h3', null, 'Change password'),
        h('div', { class: 'form-grid', style: { 'margin-top': '10px' } }, field('Current password', cur), field('New password', next)),
        h('div', { class: 'row', style: { 'margin-top': '16px' } },
          h('button', { class: 'btn primary', onclick: async () => { try { await api('POST', '/api/auth/password', { current: cur.value, next: next.value }); cur.value = next.value = ''; toast('Password changed'); } catch (e) { errorToast(e); } } }, 'Change password'))),
      section('encoder', 'OBS & encoders', 'Every live broadcast has its own private stream key (see Broadcasts → OBS setup). The server address is the same for all of them.',
        h('div', { class: 'copy-row' }, h('code', null, store.meta.ingest.server), copyButton(() => store.meta.ingest.server)),
        h('p', { class: 'muted small', style: { 'margin-top': '10px' } }, 'Port 1935 must be open on your server’s firewall. Stream keys for unknown broadcasts are rejected and logged under Activity → Security.')))));
}

let qrPromise;
function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrPromise = qrPromise || new Promise((resolve) => { const s = document.createElement('script'); s.src = '/vendor/qrcode.js'; s.onload = () => resolve(window.qrcode); s.onerror = () => resolve(null); document.head.append(s); });
  return qrPromise;
}
