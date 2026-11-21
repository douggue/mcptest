/**
 * The views as the left rail groups them. Each item opens its own view; the
 * overview sits above the groups, and Settings opens from the top bar.
 */
import type { ViewId } from './routes';

export interface RailItem {
  readonly label: string;
  /** The view the item opens. */
  readonly view: Exclude<ViewId, 'channel'>;
}

export interface RailGroup {
  readonly label: 'Research' | 'Create' | 'Study';
  readonly items: readonly RailItem[];
}

export const OVERVIEW_ITEM: RailItem = { label: 'Overview', view: 'home' };

export const RAIL_GROUPS: readonly RailGroup[] = [
  {
    label: 'Research',
    items: [
      { label: 'Radar', view: 'radar' },
      { label: 'What changed', view: 'what-changed' },
      { label: 'Breaking out', view: 'breakouts' },
      { label: 'Same topic, other words', view: 'same-topic' },
      { label: 'Thumbnails that worked', view: 'thumbnails' },
      { label: 'Transfer opportunities', view: 'transfers' },
      { label: 'New niches', view: 'niches' },
    ],
  },
  {
    label: 'Create',
    items: [
      { label: 'Trending formats', view: 'formats' },
      { label: 'Hook library', view: 'hooks' },
      { label: 'Idea lab', view: 'ideas' },
      { label: 'Script writer', view: 'script' },
      { label: 'Check before publishing', view: 'risk' },
    ],
  },
  {
    label: 'Study',
    items: [
      { label: 'Ask AI and breakdowns', view: 'ask' },
      { label: 'Your videos against the plan', view: 'own-videos' },
      { label: 'Upload calendar', view: 'calendar' },
      { label: 'Length and pacing', view: 'pacing' },
      { label: 'What viewers ask for', view: 'comments' },
    ],
  },
];
