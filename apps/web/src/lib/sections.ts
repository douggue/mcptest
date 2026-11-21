/**
 * The page's sections as the left rail groups them, and which of them the
 * owner has closed, as it is remembered in this browser.
 */

export interface RailItem {
  readonly label: string;
  /** The id of the element the item jumps to. */
  readonly target: string;
}

export interface RailGroup {
  readonly label: 'Research' | 'Create' | 'Study';
  readonly items: readonly RailItem[];
}

export const RAIL_GROUPS: readonly RailGroup[] = [
  {
    label: 'Research',
    items: [
      { label: 'Radar', target: 'top' },
      { label: 'What changed', target: 'what-changed-title' },
      { label: 'Breaking out', target: 'breakouts-title' },
      { label: 'Same topic, other words', target: 'same-topic-title' },
      { label: 'Thumbnails that worked', target: 'thumbnail-board-title' },
      { label: 'Transfer opportunities', target: 'transfers-title' },
      { label: 'New niches', target: 'niches-title' },
    ],
  },
  {
    label: 'Create',
    items: [
      { label: 'Trending formats', target: 'formulas-title' },
      { label: 'Hook library', target: 'hook-library-title' },
      { label: 'Idea lab', target: 'idea-lab-title' },
      { label: 'Script writer', target: 'script-writer-title' },
    ],
  },
  {
    label: 'Study',
    items: [
      { label: 'Ask AI and breakdowns', target: 'ask-claude-title' },
      { label: 'Your videos against the plan', target: 'own-videos-title' },
      { label: 'Upload calendar', target: 'upload-calendar-title' },
    ],
  },
];

/** A section id as the page writes them: lower case words joined by hyphens. */
const SECTION_ID = /^[a-z][a-z0-9-]{0,60}$/;

/** The closed sections read back from the browser; none from anything unexpected. */
export function collapsedFrom(stored: string | null): ReadonlySet<string> {
  if (stored === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((id): id is string => typeof id === 'string' && SECTION_ID.test(id)),
    );
  } catch {
    return new Set();
  }
}

/** The set with one section closed or opened. */
export function withCollapsed(
  closed: ReadonlySet<string>,
  id: string,
  collapsed: boolean,
): ReadonlySet<string> {
  const next = new Set(closed);
  if (collapsed) next.add(id);
  else next.delete(id);
  return next;
}

/** The set as it is stored in the browser. */
export const collapsedText = (closed: ReadonlySet<string>): string =>
  JSON.stringify([...closed].sort());
