/**
 * The fixed checklist an engine fills in for each thumbnail it looks at, and
 * reading its answer. Only what passes the checklist is kept; anything else
 * is recorded with the reason and never counted.
 */
import { z } from 'zod';

export const TAG_COLOURS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'brown',
  'black',
  'white',
  'grey',
] as const;

const MAX_WORDS = 30;
const MAX_DESCRIPTION = 240;
const MAX_COLOURS = 3;

export const thumbTagsSchema = z
  .object({
    face: z.enum(['none', 'small', 'large']),
    expression: z.enum(['none', 'neutral', 'happy', 'surprised', 'angry', 'worried', 'other']),
    words: z.number().int().min(0).max(MAX_WORDS),
    textSize: z.enum(['none', 'small', 'medium', 'large']),
    textColour: z.enum(['none', ...TAG_COLOURS]),
    background: z.enum(['photo', 'render', 'plain']),
    colours: z.array(z.enum(TAG_COLOURS)).min(1).max(MAX_COLOURS),
    subjectSize: z.enum(['small', 'medium', 'large']),
    highlight: z.boolean(),
    split: z.boolean(),
    flagOrMap: z.boolean(),
    logo: z.boolean(),
    brightness: z.enum(['dark', 'mid', 'bright']),
    clutter: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    description: z.string().trim().min(1).max(MAX_DESCRIPTION),
  })
  .strict();

export type ThumbTags = z.infer<typeof thumbTagsSchema>;
export type TagKey = Exclude<keyof ThumbTags, 'description'>;

export interface TagAttribute {
  readonly key: TagKey;
  /** What the owner reads it as. */
  readonly label: string;
}

/** Every attribute counted, in the order a table shows them. */
export const TAG_ATTRIBUTES: readonly TagAttribute[] = [
  { key: 'face', label: 'Face or person' },
  { key: 'expression', label: 'Expression' },
  { key: 'words', label: 'Overlay words' },
  { key: 'textSize', label: 'Text size' },
  { key: 'textColour', label: 'Text colour' },
  { key: 'background', label: 'Background' },
  { key: 'colours', label: 'Main colours' },
  { key: 'subjectSize', label: 'Main subject size' },
  { key: 'highlight', label: 'Arrow, circle or highlight' },
  { key: 'split', label: 'Before and after, or split' },
  { key: 'flagOrMap', label: 'Flag or map' },
  { key: 'logo', label: 'Logo' },
  { key: 'brightness', label: 'Brightness' },
  { key: 'clutter', label: 'Clutter (1 calm to 3 busy)' },
];

/** What the engine is told about the checklist, word for word in every tagging question. */
export const TAG_CHECKLIST = [
  'face: none, small or large (a face or person, and how much of the frame)',
  `expression: ${thumbTagsSchema.shape.expression.options.join(', ')}`,
  'words: how many overlay words, a whole number',
  'textSize: none, small, medium or large',
  `textColour: none or one of ${TAG_COLOURS.join(', ')}`,
  'background: photo, render or plain',
  `colours: the one to three main colours, from ${TAG_COLOURS.join(', ')}`,
  'subjectSize: small, medium or large',
  'highlight: true or false (an arrow, circle or highlight drawn on it)',
  'split: true or false (before and after, or a split frame)',
  'flagOrMap: true or false',
  'logo: true or false',
  'brightness: dark, mid or bright',
  'clutter: 1, 2 or 3 (calm to busy)',
  `description: one plain sentence of what it shows, under ${MAX_DESCRIPTION} characters`,
].join('; ');

const wordBand = (words: number): string => {
  if (words === 0) return 'none';
  if (words <= 2) return '1-2';
  return words <= 4 ? '3-4' : '5+';
};

/** The values an attribute of one thumbnail is counted as. */
export function tagValues(tags: ThumbTags, key: TagKey): readonly string[] {
  const value = tags[key];
  if (key === 'words') return [wordBand(tags.words)];
  if (Array.isArray(value)) return value;
  if (typeof value === 'boolean') return [value ? 'yes' : 'no'];
  return [String(value)];
}

export interface TagRejection {
  readonly videoId: string;
  readonly reason: string;
}

export interface ParsedTags {
  readonly tags: ReadonlyMap<string, ThumbTags>;
  readonly rejected: readonly TagRejection[];
}

type TagResult =
  | { readonly videoId: string; readonly tags: ThumbTags }
  | { readonly videoId: string; readonly reason: string };

const entrySchema = z.object({ id: z.string() }).passthrough();

/** The JSON list in an answer, or null when there is none to read. */
function listIn(answer: string): readonly unknown[] | null {
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(answer.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Why an entry failed the checklist, by the field and never by its value. */
function problemOf(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path[0];
  if (issue?.code === 'unrecognized_keys') return 'it held a field not on the checklist';
  return typeof field === 'string'
    ? `${field} is not one of the fixed values`
    : 'it did not follow the checklist';
}

/** The tags of the thumbnails asked about, read from an engine's answer. */
export function parseTagAnswer(answer: string, asked: readonly string[]): ParsedTags {
  const list = listIn(answer);
  if (list === null) {
    return {
      tags: new Map(),
      rejected: asked.map((videoId) => ({ videoId, reason: 'the answer held no list of tags' })),
    };
  }
  const byId = new Map(
    list.flatMap((item) => {
      const entry = entrySchema.safeParse(item);
      if (!entry.success) return [];
      const { id, ...fields } = entry.data;
      return [[id, fields] as const];
    }),
  );
  const results = asked.map((videoId): TagResult => {
    const entry = byId.get(videoId);
    if (!entry) return { videoId, reason: 'not tagged' };
    const parsed = thumbTagsSchema.safeParse(entry);
    return parsed.success
      ? { videoId, tags: parsed.data }
      : { videoId, reason: problemOf(parsed.error) };
  });
  return {
    tags: new Map(
      results.flatMap((result) => ('tags' in result ? [[result.videoId, result.tags]] : [])),
    ),
    rejected: results.flatMap((result) =>
      'reason' in result ? [{ videoId: result.videoId, reason: result.reason }] : [],
    ),
  };
}
