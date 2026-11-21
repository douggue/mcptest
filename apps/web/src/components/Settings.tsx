import { Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  changesOf,
  createSettingsApi,
  hasChanges,
  savedWords,
  type Drafts,
  type SettingsReply,
} from '../lib/settings';
import { AiEngines, type AiChoice } from './AiEngines';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { NOTE, PRIMARY_BUTTON } from './LabStatus';
import { SettingGroups } from './SettingGroups';
import { messageOf, ProgramsPanel } from './SettingsPrograms';

interface Props {
  /** Which AI answers, chosen here for the whole app. */
  readonly ai: AiChoice;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly reply: SettingsReply }
  | { readonly status: 'failed'; readonly message: string };

type Outcome = { readonly ok: boolean; readonly text: string } | null;

/** Where the settings are kept, in one line. */
function leadOf(loaded: Loaded): string {
  const none = loaded.status === 'ready' && !loaded.reply.fileFound;
  return `Kept in the .env file in the Jgtube folder${none ? ' (none yet; saving makes it)' : ''}. A saved key is never shown again.`;
}

interface SaveBarProps {
  readonly saving: boolean;
  readonly changed: boolean;
  readonly outcome: Outcome;
  readonly onSave: () => void;
}

/** The one primary action, kept in view at the foot while the owner scrolls the settings. */
function SaveBar({ saving, changed, outcome, onSave }: SaveBarProps) {
  return (
    <div className="sticky bottom-0 z-30 flex min-w-0 flex-wrap items-center gap-3 border-t border-border-subtle bg-space-deep/95 py-space-md backdrop-blur-md">
      <button
        type="button"
        disabled={saving || !changed}
        onClick={onSave}
        className={PRIMARY_BUTTON}
      >
        {saving ? 'Saving' : 'Save changes'}
      </button>
      {outcome ? (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={`min-w-0 flex-1 break-words text-body-sm ${outcome.ok ? 'text-primary' : 'text-error'}`}
        >
          {outcome.text}
        </p>
      ) : (
        <span className="text-body-sm text-outline">
          {changed
            ? 'Unsaved changes'
            : 'No changes yet: type in a box above, such as a key, and Save turns on.'}
        </span>
      )}
    </div>
  );
}

/**
 * The settings view, opened from the top bar: which AI answers and the
 * programs on this computer at the side; the keys, the AI engines, the helper
 * programs and the rest of the `.env` file in groups, each with what is in
 * force and when a change takes effect.
 */
export function Settings({ ai }: Props) {
  const api = useMemo(() => createSettingsApi(), []);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [drafts, setDrafts] = useState<Drafts>({});
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
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
    <ViewPage labelledBy="settings-title">
      <ViewHeader
        titleId="settings-title"
        title="Settings"
        icon={SettingsIcon}
        lead={leadOf(loaded)}
      />
      <SplitView
        sideLabel="AI and programs"
        side={
          <>
            <AiEngines ai={ai} />
            <ProgramsPanel refreshKey={saves} />
          </>
        }
      >
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
        <SettingGroups settings={settings} drafts={drafts} disabled={saving} onDrafts={setDrafts} />
        <SaveBar
          saving={saving}
          changed={hasChanges(settings, drafts)}
          outcome={outcome}
          onSave={save}
        />
      </SplitView>
    </ViewPage>
  );
}
