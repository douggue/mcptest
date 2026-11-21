import type { Draft, Drafts, SettingView } from '../lib/settings';
import { Card } from './layout/Card';
import { Details } from './layout/Details';
import { SettingRow } from './SettingRow';

/**
 * The groups the settings are shown in, by the name each has in the `.env`
 * file. What only an engineer would change sits in Advanced, closed.
 */
const GROUPS: readonly {
  readonly title: string;
  readonly names: readonly string[];
  readonly advanced?: boolean;
}[] = [
  { title: 'Keys', names: ['YOUTUBE_API_KEY', 'GEMINI_API_KEY'] },
  { title: 'Scripts', names: ['JGTUBE_MARK_FACTS'] },
  { title: 'Refreshing', names: ['JGTUBE_REFRESH_HOURS', 'JGTUBE_REGION'] },
  {
    title: 'Advanced',
    advanced: true,
    names: [
      'JGTUBE_ENGINES',
      'JGTUBE_AGY_MODEL',
      'JGTUBE_YT_DLP_PATH',
      'JGTUBE_FFMPEG_PATH',
      'JGTUBE_DOWNLOADS_PATH',
    ],
  },
];

interface Group {
  readonly title: string;
  readonly settings: readonly SettingView[];
  readonly advanced: boolean;
}

/** The settings in their groups; one the groups do not name goes under "Other". */
export function groupSettings(settings: readonly SettingView[]): readonly Group[] {
  const named = new Set(GROUPS.flatMap((group) => group.names));
  const groups = GROUPS.map((group) => ({
    title: group.title,
    settings: settings.filter((setting) => group.names.includes(setting.name)),
    advanced: group.advanced === true,
  }));
  const other = {
    title: 'Other',
    settings: settings.filter((setting) => !named.has(setting.name)),
    advanced: true,
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

/** One group's card: its title and a row for each setting. */
function GroupCard({ group, ...props }: Props & { readonly group: Group }) {
  const { drafts, disabled, onDrafts } = props;
  return (
    <Card as="section" label={group.title}>
      <h3 className="text-headline-md font-bold text-on-surface">{group.title}</h3>
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
  );
}

/**
 * The settings of the `.env` file, a card for each group and a row for each
 * setting; the engineer's ones behind Advanced, closed until opened.
 */
export function SettingGroups(props: Props) {
  const groups = groupSettings(props.settings);
  const advanced = groups.filter((group) => group.advanced);
  return (
    <>
      {groups
        .filter((group) => !group.advanced)
        .map((group) => (
          <GroupCard key={group.title} group={group} {...props} />
        ))}
      {advanced.length > 0 && (
        <Details summary="Advanced: AI order, program paths and folders">
          {advanced.map((group) => (
            <GroupCard key={group.title} group={group} {...props} />
          ))}
        </Details>
      )}
    </>
  );
}
