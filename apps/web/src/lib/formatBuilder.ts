/**
 * The format builder's formats as the page reads them: the local server's
 * API, and the words beside each slot. Every check and number comes from the
 * server, worked out in code; this only phrases it.
 */
import type {
  Format,
  FormatChange,
  FormatChecks,
  FormatSlots,
  Ingredient,
  IngredientLayer,
} from '@jgtube/core';
import { applySuggestion, clearSlot, fillSlot, noteSlot } from '@jgtube/core/src/format/formats';
import { engineName } from './analyses';
import { apiCaller, type Fetch } from './api';

export { applySuggestion, clearSlot, fillSlot, noteSlot };

/** A format with its checks, as the server sends it. */
export interface FormatView extends Format {
  readonly checks: FormatChecks;
  readonly topChannelTitle: string | null;
}

/** A "Suggest a mix" job as the server reports it. */
export interface MixJob {
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: { readonly text?: string } | null;
  readonly result: FormatView | null;
  readonly error: string | null;
}

export const FORMATS_PATH = '/api/format/formats';
export const MIX_JOB_KIND = 'format-mix';
export const BIBLE_JOB_KIND = 'format-bible';

/** Where the kept Bible of a format downloads from. */
export const bibleUrl = (id: number, kind: 'md' | 'zip'): string =>
  `${FORMATS_PATH}/${id}/format-bible.${kind}`;

export function createFormatBuilderApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  const one = async (path: string, body: unknown): Promise<FormatView> =>
    unwrap<FormatView>(await send(path, body));
  return {
    /** The formats of the map's channel; null for those made with no map open. */
    async list(channel: string | null): Promise<readonly FormatView[]> {
      const query = channel === null ? '' : `?channel=${encodeURIComponent(channel)}`;
      return unwrap<{ formats: FormatView[] }>(await call(`${FORMATS_PATH}${query}`)).formats;
    },
    create: (name: string, targetSeconds: number | null, channel: string | null) =>
      one(FORMATS_PATH, { name, targetSeconds, channel }),
    update: (id: number, change: FormatChange) => one(`${FORMATS_PATH}/update`, { id, ...change }),
    duplicate: (id: number) => one(`${FORMATS_PATH}/duplicate`, { id }),
    async remove(id: number): Promise<void> {
      unwrap(await send(`${FORMATS_PATH}/remove`, { id }));
    },
    async job(id: string): Promise<MixJob> {
      return unwrap<MixJob>(await call(`/api/jobs/${encodeURIComponent(id)}`));
    },
    /** Starts "Write my Format Bible"; resolves with the job to follow. */
    async writeBible(id: number, channel: string | null, engine: string | null): Promise<string> {
      const body = { id, channel, ...(engine === null ? {} : { engine }) };
      return unwrap<{ jobId: string }>(await send(`${FORMATS_PATH}/bible`, body)).jobId;
    },
    /** Starts "Suggest a mix"; resolves with the job to follow. */
    async suggest(id: number, channel: string | null, engine: string | null): Promise<string> {
      const body = { id, channel, ...(engine === null ? {} : { engine }) };
      return unwrap<{ jobId: string }>(await send(`${FORMATS_PATH}/suggest`, body)).jobId;
    },
  };
}

export type FormatBuilderApi = ReturnType<typeof createFormatBuilderApi>;

/** One warning beside a slot, in plain words. */
export interface SlotWarning {
  readonly kind: 'clash' | 'unproven';
  readonly text: string;
}

const UNPROVEN = 'Not proven: fewer than two videos from two channels.';

/** The warnings beside each slot: clashes and unproven ingredients. Copying one channel is said once, above. */
export function slotWarnings(
  view: Pick<FormatView, 'checks' | 'topChannelTitle'>,
): Readonly<Partial<Record<IngredientLayer, readonly SlotWarning[]>>> {
  const { clashes, unproven } = view.checks;
  const byLayer = new Map<IngredientLayer, SlotWarning[]>();
  const add = (layer: IngredientLayer, warning: SlotWarning): void => {
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), warning]);
  };
  for (const clash of clashes) {
    for (const layer of clash.layers) add(layer, { kind: 'clash', text: clash.says });
  }
  for (const layer of unproven) add(layer, { kind: 'unproven', text: UNPROVEN });
  return Object.fromEntries(byLayer);
}

/** The originality line for the whole format, with the counts it rests on; null with too little to say. */
export function originalityLine(
  view: Pick<FormatView, 'checks' | 'topChannelTitle'>,
): string | null {
  const { originality } = view.checks;
  if (originality.channelId === null) return null;
  const share = Math.round(originality.share * 100);
  const counted = `${originality.fromChannel} of ${originality.filled} filled slots (${share}%) come from ${view.topChannelTitle ?? 'one channel'}`;
  return originality.copiesOneChannel
    ? `This copies one channel: ${counted}. Mix in pieces from others.`
    : `${counted}: a mix, not a copy.`;
}

/** The ingredients on the shelf that can fill a layer's slot, proven first. */
export function choicesFor(
  shelf: readonly Ingredient[],
  layer: IngredientLayer,
): readonly Ingredient[] {
  return shelf
    .filter((item) => item.layer === layer)
    .sort((a, b) => Number(b.proven) - Number(a.proven) || b.id - a.id);
}

/** How many slots are filled. */
export const filledCount = (slots: FormatSlots): number =>
  Object.values(slots).filter((slot) => slot !== undefined).length;

const MINUTE = 60;

/** A planned length as the owner reads it: "45 s", "10 min", "1 h 5 min". */
export function lengthText(seconds: number | null): string {
  if (seconds === null) return 'No length set';
  if (seconds < MINUTE) return `${seconds} s`;
  const minutes = Math.round(seconds / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** The length the owner typed in minutes, as seconds; null for none, NaN-free. */
export function secondsFrom(minutesText: string): number | null | 'bad' {
  const text = minutesText.trim();
  if (text === '') return null;
  const minutes = Number(text);
  if (!Number.isFinite(minutes) || minutes <= 0) return 'bad';
  return Math.round(minutes * MINUTE);
}

const ENGINES = ['agy', 'claude', 'codex'] as const;

/** Which engine wrote a suggestion, by its name; "an AI" for one this page does not know. */
export const writtenBy = (engine: string): string =>
  (ENGINES as readonly string[]).includes(engine)
    ? engineName(engine as (typeof ENGINES)[number])
    : 'an AI';
