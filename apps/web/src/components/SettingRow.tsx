import { effectWords, stateWords, type Draft, type SettingView } from '../lib/settings';
import { FIELD, PILL, QUIET_BUTTON } from './LabStatus';

interface Props {
  readonly setting: SettingView;
  readonly draft: Draft | undefined;
  readonly disabled: boolean;
  readonly onDraft: (draft: Draft | undefined) => void;
}

/** The settings that are a switch, with what each position is called in the `.env` file. */
const SWITCHES: Readonly<Record<string, readonly [on: string, off: string]>> = {
  JGTUBE_MARK_FACTS: ['on', 'off'],
};

/** A switch between a setting's two values; nothing set counts as on. */
function Switch({ setting, draft, disabled, onDraft }: Props) {
  const [on, off] = SWITCHES[setting.name] ?? ['on', 'off'];
  const inForce = setting.value ?? on;
  const chosen = draft?.kind === 'set' ? draft.value : inForce;
  return (
    <div
      role="group"
      aria-label={setting.label}
      className="flex w-fit gap-1 rounded-full bg-space-deep p-1"
    >
      {[on, off].map((position) => (
        <button
          key={position}
          type="button"
          aria-pressed={chosen === position}
          disabled={disabled}
          onClick={() =>
            onDraft(position === inForce ? undefined : { kind: 'set', value: position })
          }
          className={`min-h-9 rounded-full px-4 text-label transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-container disabled:opacity-60 ${
            chosen === position
              ? 'bg-primary-container font-semibold text-on-primary'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          {position === 'on' ? 'On' : position === 'off' ? 'Off' : position}
        </button>
      ))}
    </div>
  );
}

/** What is in force: a switch left unset is on, said as "On (default)" rather than "Not set". */
function pillWords(setting: SettingView): string {
  const positions = SWITCHES[setting.name];
  if (positions && !setting.set) return 'On (default)';
  return stateWords(setting);
}

/**
 * One setting: what it is, what is in force, a box to change it and when the
 * change takes effect. A key shows only "Set" or "Not set": its box starts
 * empty, typing in it replaces the key, and Clear removes it.
 */
export function SettingRow(props: Props) {
  const { setting, draft, disabled, onDraft } = props;
  const inputId = `setting-${setting.name}`;
  const clearing = draft?.kind === 'clear';
  const typed = draft?.kind === 'set' ? draft.value : setting.secret ? '' : (setting.value ?? '');
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-border-subtle py-space-md first:border-t-0 first:pt-space-sm last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="min-w-0 text-body-md font-semibold text-on-surface">
          {setting.label}
        </label>
        <span
          className={`${PILL} ${setting.set ? 'text-primary' : 'text-outline'} max-w-full truncate`}
        >
          {clearing ? 'Will be cleared' : pillWords(setting)}
        </span>
      </div>
      <p className="text-body-sm text-on-surface-variant">{setting.help}</p>
      {setting.name in SWITCHES ? (
        <Switch {...props} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={inputId}
            type={setting.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || clearing}
            value={typed}
            placeholder={
              setting.secret
                ? setting.set
                  ? 'Paste a new key to replace it'
                  : 'Paste the key'
                : ''
            }
            onChange={(event) => onDraft({ kind: 'set', value: event.target.value })}
            className={`${FIELD} flex-1 basis-56`}
          />
          {setting.secret && setting.set && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onDraft(clearing ? undefined : { kind: 'clear' })}
              className={QUIET_BUTTON}
            >
              {clearing ? 'Keep the key' : 'Clear'}
            </button>
          )}
        </div>
      )}
      {/* Saving is said once beside Save; only a setting that needs a restart says so here. */}
      {(setting.outside || setting.effect !== 'now') && (
        <p className="text-body-sm text-metric-amber">{effectWords(setting)}</p>
      )}
    </div>
  );
}
