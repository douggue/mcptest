import { useMemo, useState } from 'react';
import { createSettingsApi, proxyTestTitle, type ProxyTestReply } from '../lib/settings';
import { QUIET_BUTTON } from './LabStatus';
import { messageOf } from './SettingsPrograms';

interface Props {
  /** Whether a proxy is saved; only a saved one can be tested. */
  readonly saved: boolean;
  /** Whether the box holds a change not saved yet: the test is of what is saved. */
  readonly unsaved: boolean;
  readonly disabled: boolean;
}

type Shown =
  | { readonly status: 'idle' }
  | { readonly status: 'testing' }
  | { readonly status: 'done'; readonly reply: ProxyTestReply }
  | { readonly status: 'failed'; readonly message: string };

const TONE: Readonly<Record<ProxyTestReply['verdict'], string>> = {
  reachable: 'text-primary',
  refused: 'text-error',
  'sign-in': 'text-metric-amber',
  'not-set': 'text-outline',
};

/** What the last test said, in a word and its plain reason. */
function Said({ shown }: { readonly shown: Shown }) {
  if (shown.status === 'testing') {
    return (
      <p role="status" className="text-body-sm text-on-surface-variant">
        Fetching one public YouTube page through the proxy.
      </p>
    );
  }
  if (shown.status === 'failed') {
    return (
      <p role="alert" className="text-body-sm text-error">
        {shown.message}
      </p>
    );
  }
  if (shown.status === 'idle') return null;
  const { verdict, reason } = shown.reply;
  return (
    <p role="status" className="min-w-0 break-words text-body-sm text-on-surface-variant">
      <span className={`font-semibold ${TONE[verdict]}`}>{proxyTestTitle(verdict)}.</span> {reason}
    </p>
  );
}

/**
 * The Test beside the proxy for YouTube: one public YouTube page fetched
 * through the saved proxy, and whether YouTube was reachable, refused or
 * asked to sign in.
 */
export function ProxyTest({ saved, unsaved, disabled }: Props) {
  const api = useMemo(() => createSettingsApi(), []);
  const [shown, setShown] = useState<Shown>({ status: 'idle' });
  const test = () => {
    setShown({ status: 'testing' });
    api.testYouTubeProxy().then(
      (reply) => setShown({ status: 'done', reply }),
      (error: unknown) => setShown({ status: 'failed', message: messageOf(error) }),
    );
  };
  const hint = !saved
    ? 'Save an address, then test it.'
    : unsaved
      ? 'Save the new address first; Test checks the saved one.'
      : 'Fetches one public YouTube page through the saved proxy.';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || !saved || unsaved || shown.status === 'testing'}
          onClick={test}
          className={QUIET_BUTTON}
        >
          {shown.status === 'testing' ? 'Testing' : 'Test'}
        </button>
        <span className="min-w-0 flex-1 text-body-sm text-outline">{hint}</span>
      </div>
      <Said shown={shown} />
    </div>
  );
}
