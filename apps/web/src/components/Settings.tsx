import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  changesOf,
  createSettingsApi,
  hasChanges,
  savedWords,
  type AllowReport,
  type Drafts,
  type ProgramsReport,
  type SettingsReply,
} from '../lib/settings';
import { AiEngines, type AiChoice } from './AiEngines';
import { NOTE, PRIMARY_BUTTON, QUIET_BUTTON } from './LabStatus';
import { SettingRow } from './SettingRow';

interface Props {
  /** Which AI answers, chosen here for the whole app. */
  readonly ai: AiChoice;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly reply: SettingsReply }
  | { readonly status: 'failed'; readonly message: string };

type Programs =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly report: ProgramsReport }
  | { readonly status: 'failed'; readonly message: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong';

/** What `npm run engines` prints, and the button that lets Antigravity use Jgtube's tools. */
function ProgramsPanel({ refreshKey }: { readonly refreshKey: number }) {
  const api = useMemo(() => createSettingsApi(), []);
  const [programs, setPrograms] = useState<Programs>({ status: 'loading' });
  const [allowed, setAllowed] = useState<AllowReport | { readonly failed: string } | null>(null);
  const check = useCallback(() => {
    setPrograms({ status: 'loading' });
    api.programs().then(
      (report) => setPrograms({ status: 'ready', report }),
      (error: unknown) => setPrograms({ status: 'failed', message: messageOf(error) }),
    );
  }, [api]);
  // Checked when the screen opens and again after each save, which may have changed a path.
  useEffect(check, [check, refreshKey]);
  const allow = () => {
    api
      .allowAntigravity()
      .then(setAllowed, (error: unknown) => setAllowed({ failed: messageOf(error) }));
  };
  return (
    <section aria-labelledby="settings-programs" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="settings-programs" className="text-headline-md text-on-surface">
          Programs on this computer
        </h3>
        <button type="button" onClick={check} className={QUIET_BUTTON}>
          Check again
        </button>
      </div>
      {programs.status === 'loading' && (
        <p role="status" className={NOTE}>
          Looking for the AI programs and helper programs. This takes a few seconds.
        </p>
      )}
      {programs.status === 'failed' && (
        <p role="alert" className={`${NOTE} text-error`}>
          {programs.message}
        </p>
      )}
      {programs.status === 'ready' && (
        <div className="flex flex-col gap-3 rounded bg-surface-card p-space-md text-body-sm text-on-surface-variant">
          {[programs.report.engines, programs.report.helpers].map((lines) => (
            <ul key={lines[0]} className="flex flex-col gap-1">
              {lines.map((line, index) => (
                <li
                  key={line}
                  className={`break-words ${index === 0 ? 'text-label-caps uppercase text-outline' : ''}`}
                >
                  {line.trim()}
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 rounded bg-surface-card p-space-md">
        <p className="text-body-sm text-on-surface-variant">
          Antigravity needs one line in its own settings before a run started by Jgtube may use
          Jgtube&rsquo;s tools. This adds it, and keeps a copy of the settings as they were.
        </p>
        <button type="button" onClick={allow} className={`${QUIET_BUTTON} w-fit`}>
          Let Antigravity use Jgtube&rsquo;s tools
        </button>
        {allowed && 'failed' in allowed && (
          <p role="alert" className="text-body-sm text-error">
            {allowed.failed}
          </p>
        )}
        {allowed && 'lines' in allowed && (
          <ul
            role="status"
            className={`flex flex-col gap-1 text-body-sm ${allowed.ok ? 'text-on-surface' : 'text-error'}`}
          >
            {allowed.lines.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The settings view, opened from the top bar: which AI answers, the keys, the
 * AI engines, the helper programs and the rest of the `.env` file, each with
 * what is in force and when a change takes effect.
 */
export function Settings({ ai }: Props) {
  const api = useMemo(() => createSettingsApi(), []);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [drafts, setDrafts] = useState<Drafts>({});
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<{ readonly ok: boolean; readonly text: string } | null>(
    null,
  );
  const [saves, setSaves] = useState(0);

  useEffect(() => {
    api.read().then(
      (reply) => setLoaded({ status: 'ready', reply }),
      (error: unknown) => setLoaded({ status: 'failed', message: messageOf(error) }),
    );
  }, [api]);

  const settings = loaded.status === 'ready' ? loaded.reply.settings : [];
  const save = () => {
    setSaving(true);
    setOutcome(null);
    api
      .save(changesOf(settings, drafts))
      .then(
        (reply) => {
          setLoaded({ status: 'ready', reply });
          setDrafts({});
          setOutcome({ ok: true, text: savedWords(reply.restart) });
          setSaves((count) => count + 1);
        },
        (error: unknown) => setOutcome({ ok: false, text: messageOf(error) }),
      )
      .finally(() => setSaving(false));
  };

  return (
    <section
      aria-labelledby="settings-title"
      className="w-full bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-3xl flex-col border-t border-border-subtle pt-space-lg">
        <h2
          id="settings-title"
          className="text-headline-lg font-bold tracking-tight text-on-surface"
        >
          Settings
        </h2>
        <div className="flex flex-col gap-space-lg py-space-lg">
          <AiEngines ai={ai} />
          <p className="text-body-sm text-on-surface-variant">
            These are kept in the <span className="text-on-surface">.env</span> file in the Jgtube
            folder on this computer
            {loaded.status === 'ready' && !loaded.reply.fileFound
              ? ' (there is none yet; saving makes it)'
              : ''}
            . A key is never shown again once saved: this screen only knows whether one is set.
          </p>
          {loaded.status === 'loading' && (
            <p role="status" className={NOTE}>
              Reading the settings.
            </p>
          )}
          {loaded.status === 'failed' && (
            <p role="alert" className={`${NOTE} text-error`}>
              {loaded.message}
            </p>
          )}
          {settings.length > 0 && (
            <div className="flex flex-col gap-3">
              {settings.map((setting) => (
                <SettingRow
                  key={setting.name}
                  setting={setting}
                  draft={drafts[setting.name]}
                  disabled={saving}
                  onDraft={(draft) =>
                    setDrafts((now) => {
                      const rest = Object.fromEntries(
                        Object.entries(now).filter(([name]) => name !== setting.name),
                      );
                      return draft === undefined ? rest : { ...rest, [setting.name]: draft };
                    })
                  }
                />
              ))}
            </div>
          )}
          <ProgramsPanel refreshKey={saves} />
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border-subtle bg-space-deep py-space-md">
          <button
            type="button"
            disabled={saving || !hasChanges(settings, drafts)}
            onClick={save}
            className={PRIMARY_BUTTON}
          >
            {saving ? 'Saving' : 'Save changes'}
          </button>
          {outcome && (
            <p
              role={outcome.ok ? 'status' : 'alert'}
              className={`min-w-0 flex-1 break-words text-body-sm ${outcome.ok ? 'text-primary' : 'text-error'}`}
            >
              {outcome.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
