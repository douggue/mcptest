import type { Draft, Drafts, SettingView } from '../lib/settings';
import { Card, Label } from './layout/Card';
import { SettingRow } from './SettingRow';

/** The groups the settings are shown in, by the name each has in the `.env` file. */
const GROUPS: readonly { readonly title: string; readonly names: readonly string[] }[] = [
  { title: 'Keys', names: ['YOUTUBE_API_KEY', 'GEMINI_API_KEY'] },
  { title: 'AI', names: ['JGTUBE_ENGINES', 'JGTUBE_AGY_MODEL', 'JGTUBE_MARK_FACTS'] },
  {
    title: 'Helper programs and files',
    names: ['JGTUBE_YT_DLP_PATH', 'JGTUBE_FFMPEG_PATH', 'JGTUBE_DOWNLOADS_PATH'],
  },
  { title: 'Refreshing', names: ['JGTUBE_REFRESH_HOURS', 'JGTUBE_REGION'] },
];

interface Group {
  readonly title: string;
  readonly settings: readonly SettingView[];
}

/** The settings in their groups; one the groups do not name goes under "Other". */
export function groupSettings(settings: readonly SettingView[]): readonly Group[] {
  const named = new Set(GROUPS.flatMap((group) => group.names));
  const groups = GROUPS.map((group) => ({
    title: group.title,
    settings: settings.filter((setting) => group.names.includes(setting.name)),
  }));
  const other = {
    title: 'Other',
    settings: settings.filter((setting) => !named.has(setting.name)),
  };
  return [...groups, other].filter((group) => group.settings.length > 0);
}

/** A draft taken into the drafts, or taken out when undefined. */
function withDraft(drafts: Drafts, name: string, draft: Draft | undefined): Drafts {
  const rest = Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== name));
  return draft === undefined ? rest : { ...rest, [name]: draft };
}

interface Props {
  readonly settings: readonly SettingView[];
  readonly drafts: Drafts;
  readonly disabled: boolean;
  readonly onDrafts: (change: (drafts: Drafts) => Drafts) => void;
}

/** The settings of the `.env` file, a card for each group and a row for each setting. */
export function SettingGroups({ settings, drafts, disabled, onDrafts }: Props) {
  return (
    <>
      {groupSettings(settings).map((group) => (
        <Card as="section" key={group.title} label={group.title}>
          <Label>{group.title}</Label>
          <div className="flex flex-col">
            {group.settings.map((setting) => (
              <SettingRow
                key={setting.name}
                setting={setting}
                draft={drafts[setting.name]}
                disabled={disabled}
                onDraft={(draft) => onDrafts((now) => withDraft(now, setting.name, draft))}
              />
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}
