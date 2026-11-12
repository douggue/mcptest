// Destination presets. Ingest servers listed here are the platforms' published defaults; when a
// platform hands out per-account or per-session servers the user pastes it in.
const PLATFORMS = {
  youtube: {
    name: 'YouTube', color: '#ff0033', serverEditable: true,
    servers: ['rtmps://a.rtmps.youtube.com:443/live2', 'rtmp://a.rtmp.youtube.com/live2'],
    formats: ['landscape', 'portrait'],
    keyLabel: 'Stream key',
    guide: [
      'Open YouTube Studio → Create → Go live (first-time channels must enable live streaming, which can take up to 24 hours).',
      'Choose "Streaming software" (Stream tab). Turn on "Enable Auto-start" and "Enable Auto-stop" so scheduled broadcasts go live and end on their own.',
      'Copy the Stream key (use a reusable/default key for recurring schedules) and paste it here. Keep the RTMPS server for encrypted delivery.',
      'Vertical (9:16) streams are shown as Shorts-style vertical live on mobile.',
    ],
    docs: 'https://support.google.com/youtube/answer/2907883',
  },
  facebook: {
    name: 'Facebook', color: '#1877f2', serverEditable: true,
    servers: ['rtmps://live-api-s.facebook.com:443/rtmp/'],
    formats: ['landscape', 'portrait'],
    keyLabel: 'Stream key',
    guide: [
      'Open Facebook Live Producer (facebook.com/live/producer) for your Page or profile.',
      'Choose "Streaming software", then enable "Use a persistent stream key" so the same key works for every scheduled broadcast.',
      'Copy the Server URL and Stream key here. Facebook only publishes a post once it receives video; check the post settings (audience, title) in Live Producer.',
      'Check Facebook’s current maximum live duration before scheduling very long or looping broadcasts.',
    ],
    docs: 'https://www.facebook.com/live/producer',
  },
  tiktok: {
    name: 'TikTok', color: '#25f4ee', serverEditable: true, gated: true,
    servers: [],
    formats: ['portrait'],
    keyLabel: 'Stream key',
    guide: [
      'TikTok only provides a server URL and stream key to accounts with LIVE encoder (third-party streaming) access. Access depends on your account and region.',
      'When available: TikTok LIVE Studio / LIVE Center → Go LIVE with streaming software → copy the Server URL and Stream key. TikTok keys usually change every session.',
      'TikTok LIVE is designed for real-time content. TikTok Shop LIVE policy prohibits pre-recorded and looped clips. Stream Studio blocks pre-recorded broadcasts to TikTok unless you explicitly confirm they are allowed for your account.',
      'Use 9:16 (portrait) for TikTok.',
    ],
    docs: 'https://www.tiktok.com/live',
  },
  instagram: {
    name: 'Instagram', color: '#e1306c', serverEditable: true,
    servers: [],
    formats: ['portrait'],
    keyLabel: 'Stream key',
    guide: [
      'Instagram Live with streaming software requires a professional account and is set up from Instagram on the web (Create → Live video).',
      'Copy the Stream URL and Stream key. Instagram keys are generated per live session, so update this destination before each broadcast.',
      'Use 9:16 (portrait).',
    ],
    docs: 'https://help.instagram.com/',
  },
  twitch: {
    name: 'Twitch', color: '#9146ff', serverEditable: true,
    servers: ['rtmp://live.twitch.tv/app'],
    formats: ['landscape'],
    keyLabel: 'Stream key',
    guide: [
      'Twitch Creator Dashboard → Settings → Stream → copy the Primary Stream key.',
      'Twitch requires pre-recorded content to be clearly labelled as such (for example in the title). Check Twitch’s current rules for re-runs.',
    ],
    docs: 'https://help.twitch.tv/s/article/guide-to-broadcast-health-and-using-twitch-inspector',
  },
  kick: {
    name: 'Kick', color: '#53fc18', serverEditable: true,
    servers: [],
    formats: ['landscape'],
    keyLabel: 'Stream key',
    guide: ['Kick Creator Dashboard → Settings → Stream URL & Key. Copy both here.'],
    docs: 'https://help.kick.com/',
  },
  x: {
    name: 'X (Twitter)', color: '#e7e9ea', serverEditable: true,
    servers: [],
    formats: ['landscape', 'portrait'],
    keyLabel: 'Stream key',
    guide: ['X Media Studio → Producer → Sources → Create source (RTMP). Copy the RTMP URL and Stream key here. Media Studio access may depend on your account.'],
    docs: 'https://help.x.com/',
  },
  linkedin: {
    name: 'LinkedIn', color: '#0a66c2', serverEditable: true,
    servers: [],
    formats: ['landscape'],
    keyLabel: 'Stream key',
    guide: ['LinkedIn Live (eligible members & pages) → Create event → Streaming via external tool. Copy the Stream URL and Stream key.'],
    docs: 'https://www.linkedin.com/help/linkedin/answer/a564446',
  },
  custom: {
    name: 'Custom RTMP', color: '#94a3b8', serverEditable: true,
    servers: [],
    formats: ['landscape', 'portrait'],
    keyLabel: 'Stream key (optional)',
    guide: ['Any RTMP or RTMPS ingest (Rumble, Trovo, Restream, your own server…). Paste the server URL and the stream key.'],
    docs: null,
  },
};

// Combine the server URL and stream key the way OBS does.
function ingestUrl(serverUrl, key) {
  const base = String(serverUrl || '').trim();
  if (!key) return base;
  return base.endsWith('/') ? base + key : `${base}/${key}`;
}

function validateServerUrl(u) {
  let url;
  try { url = new URL(u); } catch { return 'Server URL is not a valid URL'; }
  if (!['rtmp:', 'rtmps:'].includes(url.protocol)) return 'Server URL must start with rtmp:// or rtmps://';
  const host = url.hostname.toLowerCase();
  if (process.env.ALLOW_PRIVATE_DESTINATIONS === '1') return null; // local testing only
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|mediamtx$|engine$|web$)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '::1')
    return 'Server URL must be a public streaming endpoint';
  return null;
}

module.exports = { PLATFORMS, ingestUrl, validateServerUrl };
