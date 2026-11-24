import { apiCaller, type Fetch } from './api';

/**
 * The settings screen's logic: what the server says about each setting, what
 * the owner has typed, and what to send. A key's value is never received:
 * the screen is told only whether one is set, and can replace or clear it.
 */

export interface SettingView {
  readonly name: string;
  readonly label: string;
  readonly help: string;
  /** A key: only whether it is set is known here. */
  readonly secret: boolean;
  readonly effect: 'now' | 'restart';
  readonly set: boolean;
  /** The value in force; always null for a key. */
  readonly value: string | null;
  /** Given to Jgtube from outside the `.env` file, which wins over it. */
  readonly outside: boolean;
}

export interface SettingsReply {
  readonly settings: readonly SettingView[];
  readonly fileFound: boolean;
  /** The labels of the settings just saved that need Jgtube started again. */
  readonly restart: readonly string[];
}

export interface ProgramsReport {
  readonly engines: readonly string[];
  readonly helpers: readonly string[];
}

export interface AllowReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** The proxy for YouTube: a secret, since it may carry a user name and password. */
export const PROXY_SETTING = 'JGTUBE_YOUTUBE_PROXY';

/** What the Test of the proxy for YouTube found, as the server says it. */
export type ProxyVerdict = 'reachable' | 'refused' | 'sign-in' | 'not-set';

export interface ProxyTestReply {
  readonly verdict: ProxyVerdict;
  /** One plain sentence; never the address or its password. */
  readonly reason: string;
}

const VERDICT_TITLES: Readonly<Record<ProxyVerdict, string>> = {
  reachable: 'Reachable',
  refused: 'Refused',
  'sign-in': 'Sign-in asked',
  'not-set': 'Not set',
};

export const proxyTestTitle = (verdict: ProxyVerdict): string => VERDICT_TITLES[verdict];

/** What an empty box says: the shape of a proxy address, or what to do with a key. */
export function placeholderOf(setting: SettingView): string {
  if (setting.name === PROXY_SETTING) {
    return setting.set
      ? 'Paste a new address to replace it'
      : 'http://host:port or socks5://user:password@host:port';
  }
  if (!setting.secret) return '';
  return setting.set ? 'Paste a new key to replace it' : 'Paste the key';
}

/** What the owner has done to one setting since the screen was opened. */
export type Draft = { readonly kind: 'set'; readonly value: string } | { readonly kind: 'clear' };
export type Drafts = Readonly<Record<string, Draft>>;

/** The change one draft asks for: a new value, null to clear, or undefined for none. */
function changeOf(setting: SettingView, draft: Draft | undefined): string | null | undefined {
  if (draft === undefined) return undefined;
  const typed = draft.kind === 'set' ? draft.value.trim() : '';
  if (typed === '') {
    // An empty box for a key means "leave it"; clearing a key is its own button.
    if (draft.kind === 'set' && setting.secret) return undefined;
    return setting.set ? null : undefined;
  }
  return !setting.secret && typed === setting.value ? undefined : typed;
}

/** What to send to the server: only the settings that differ from what is in force. */
export function changesOf(
  settings: readonly SettingView[],
  drafts: Drafts,
): Readonly<Record<string, string | null>> {
  return Object.fromEntries(
    settings.flatMap((setting) => {
      const change = changeOf(setting, drafts[setting.name]);
      return change === undefined ? [] : [[setting.name, change]];
    }),
  );
}

export const hasChanges = (settings: readonly SettingView[], drafts: Drafts): boolean =>
  Object.keys(changesOf(settings, drafts)).length > 0;

/** What is in force, in a word: a key is only ever "Set" or "Not set". */
export function stateWords(setting: SettingView): string {
  if (!setting.set) return 'Not set';
  return setting.secret || setting.value === null ? 'Set' : setting.value;
}

export function effectWords(setting: SettingView): string {
  if (setting.outside) {
    return 'Set outside the .env file where Jgtube was started, which wins: a change here has no effect until that is removed';
  }
  return setting.effect === 'now'
    ? 'Takes effect as soon as you save'
    : 'Takes effect after you restart Jgtube';
}

export function savedWords(restart: readonly string[]): string {
  return restart.length === 0
    ? 'Saved. The changes are in effect now.'
    : `Saved. Restart Jgtube for these to take effect: ${restart.join(', ')}.`;
}

export function createSettingsApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  return {
    async read(): Promise<SettingsReply> {
      return unwrap<SettingsReply>(await call('/api/settings'));
    },
    async save(changes: Readonly<Record<string, string | null>>): Promise<SettingsReply> {
      return unwrap<SettingsReply>(await send('/api/settings', { changes }));
    },
    /** Which AI programs and helper programs are found: what `npm run engines` prints. */
    async programs(): Promise<ProgramsReport> {
      return unwrap<ProgramsReport>(await call('/api/settings/programs'));
    },
    async allowAntigravity(): Promise<AllowReport> {
      return unwrap<AllowReport>(await send('/api/settings/allow-antigravity', {}));
    },
    /** Fetches one public YouTube page through the saved proxy; one request, on the server. */
    async testYouTubeProxy(): Promise<ProxyTestReply> {
      return unwrap<ProxyTestReply>(await send('/api/settings/youtube-proxy-test', {}));
    },
  };
}

export type SettingsApi = ReturnType<typeof createSettingsApi>;
