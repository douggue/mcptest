/**
 * The format builder's formats: list, make, change, copy to the next version,
 * remove, and "Suggest a mix" as a job in the one slot every AI run shares,
 * listed in Working so the page can follow it again. Every write passes the
 * Host, Origin and JSON checks the other routes use; every body is checked
 * with zod.
 */
import { INGREDIENT_LAYERS, MAX_FORMAT_NAME, MAX_FORMAT_NOTES, MAX_SLOT_NOTE } from '@jgtube/core';
import { z } from 'zod';
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { ENGINE_IDS } from './engines/settings';
import type { FormatView, MixProgress } from './formatBuilderTypes';
import { fail, ok, readJson } from './http';
import { download } from './teardownRoutes';
import { JobStore, type Job, type JobRecord } from './jobs';

export const FORMATS_PATH = '/api/format/formats';
export const MIX_JOB_KIND = 'format-mix';
export const BIBLE_JOB_KIND = 'format-bible';
const BIBLE_FILE = /^\/api\/format\/formats\/(\d{1,9})\/format-bible\.(md|zip)$/;
const NO_BIBLE = 'This format has no Bible yet. Press “Write my Format Bible” first.';

const BUSY = 'An AI run is already under way. Wait for it to finish.';
const NOT_FOUND = 'There is no such format.';
const ID = z.number().int().positive();
const NAME = z.string().trim().min(1).max(MAX_FORMAT_NAME);
const SECONDS = z.number().int().nullable();
const SLOTS = z.partialRecord(
  z.enum(INGREDIENT_LAYERS),
  z.object({ ingredientId: ID, note: z.string().max(MAX_SLOT_NOTE) }),
);

const CHANNEL = z
  .string()
  .regex(/^UC[\w-]{22}$/)
  .nullable()
  .default(null);
const createRequest = z.object({
  name: NAME,
  targetSeconds: SECONDS.default(null),
  channel: CHANNEL,
});
const updateRequest = z.object({
  id: ID,
  name: NAME.optional(),
  targetSeconds: SECONDS.optional(),
  notes: z.string().max(MAX_FORMAT_NOTES).optional(),
  slots: SLOTS.optional(),
});
const idRequest = z.object({ id: ID });
const activeRequest = z.object({ channel: z.string().regex(/^UC[\w-]{22}$/), id: ID.nullable() });
export const ACTIVE_PATH = '/api/format/active';
export const FOLLOWED_PATH = '/api/format/followed';
const suggestRequest = z.object({
  id: ID,
  channel: CHANNEL,
  engine: z.enum(ENGINE_IDS).optional(),
});

type MixJobs = JobStore<FormatView, MixProgress>;

interface Context {
  readonly options: AppOptions;
  readonly tracker: AnalysisTracker;
  readonly jobs: MixJobs;
}

async function bodyOf<T>(context: Context, request: Request, schema: z.ZodType<T>, rule: string) {
  const body = await readJson(context.options.allowedHosts, request, 40_000);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : fail(400, rule);
}

const plain = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function create(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, createRequest, 'Give the format a name.');
  if (body instanceof Response) return body;
  try {
    return ok(
      context.options.engine.formatBuilder.createFormat(
        body.name,
        body.targetSeconds,
        body.channel,
      ),
      201,
    );
  } catch (error) {
    return fail(400, plain(error));
  }
}

async function update(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    updateRequest,
    'Give the format’s number and the change.',
  );
  if (body instanceof Response) return body;
  const { id, ...change } = body;
  try {
    const changed = context.options.engine.formatBuilder.updateFormat(id, change);
    return changed === null ? fail(404, NOT_FOUND) : ok(changed);
  } catch (error) {
    return fail(400, plain(error));
  }
}

async function duplicate(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, idRequest, 'Give the format’s number.');
  if (body instanceof Response) return body;
  const copy = context.options.engine.formatBuilder.duplicateFormat(body.id);
  return copy === null ? fail(404, NOT_FOUND) : ok(copy, 201);
}

async function remove(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, idRequest, 'Give the format’s number.');
  if (body instanceof Response) return body;
  return context.options.engine.formatBuilder.removeFormat(body.id)
    ? ok({ id: body.id })
    : fail(404, NOT_FOUND);
}

async function suggest(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, suggestRequest, 'Give the format’s number.');
  if (body instanceof Response) return body;
  const builder = context.options.engine.formatBuilder;
  const name = builder.formatName(body.id);
  if (name === null) return fail(404, NOT_FOUND);
  const { tracker, jobs } = context;
  if (tracker.running || jobs.isBusy()) return fail(409, BUSY);
  tracker.running = true;
  const job = jobs.start(
    (report) =>
      builder.suggestMix(body.id, body.channel, body.engine, report).finally(() => {
        tracker.running = false;
      }),
    { kind: MIX_JOB_KIND, title: `Suggesting a mix for “${name}”`, channelId: body.channel },
  );
  return ok({ jobId: job?.id }, 202);
}

async function bible(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, suggestRequest, 'Give the format’s number.');
  if (body instanceof Response) return body;
  const builder = context.options.engine.formatBuilder;
  const name = builder.formatName(body.id);
  if (name === null) return fail(404, NOT_FOUND);
  const { tracker, jobs } = context;
  if (tracker.running || jobs.isBusy()) return fail(409, BUSY);
  tracker.running = true;
  const job = jobs.start(
    (report) =>
      builder.writeBible(body.id, body.channel, body.engine, report).finally(() => {
        tracker.running = false;
      }),
    {
      kind: BIBLE_JOB_KIND,
      title: `Writing the Format Bible of “${name}”`,
      channelId: body.channel,
    },
  );
  return ok({ jobId: job?.id }, 202);
}

/** "Long-form v2" saves as "format-bible-long-form-v2". */
const fileName = (name: string, id: number): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `format-bible-${slug || id}`;
};

async function bibleFile(context: Context, id: number, kind: string): Promise<Response> {
  const builder = context.options.engine.formatBuilder;
  const markdown = builder.bibleMarkdown(id);
  if (markdown === null) return fail(404, NO_BIBLE);
  const name = fileName(markdown.name, id);
  if (kind === 'md') {
    return download(markdown.text, 'text/markdown; charset=utf-8', `${name}.md`);
  }
  const zip = await builder.bibleZip(id);
  return zip === null ? fail(404, NO_BIBLE) : download(zip, 'application/zip', `${name}.zip`);
}

async function setActive(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, activeRequest, 'Give the channel and the format.');
  if (body instanceof Response) return body;
  const builder = context.options.engine.formatBuilder;
  return builder.setActive(body.channel, body.id)
    ? ok({ formats: builder.listFormats(body.channel) })
    : fail(404, NOT_FOUND);
}

function followed(context: Context, url: URL): Response {
  const channel = CHANNEL.safeParse(url.searchParams.get('channel'));
  if (!channel.success || channel.data === null) return fail(400, 'Give the channel’s id.');
  const view = context.options.engine.formatBuilder.followed(channel.data);
  return view === null ? fail(404, 'This channel has no active format yet.') : ok(view);
}

const POSTS: Readonly<Record<string, (context: Context, request: Request) => Promise<Response>>> = {
  [FORMATS_PATH]: create,
  [`${FORMATS_PATH}/update`]: update,
  [`${FORMATS_PATH}/duplicate`]: duplicate,
  [`${FORMATS_PATH}/remove`]: remove,
  [`${FORMATS_PATH}/suggest`]: suggest,
  [`${FORMATS_PATH}/bible`]: bible,
  [ACTIVE_PATH]: setActive,
};

export interface FormatBuilderRoutes {
  handle(request: Request, url: URL): Promise<Response> | Response | null;
  listJobs(): readonly JobRecord[];
  job(id: string): Job<FormatView, MixProgress> | null;
}

export function formatBuilderRoutes(
  options: AppOptions,
  tracker: AnalysisTracker,
): FormatBuilderRoutes {
  const context: Context = { options, tracker, jobs: new JobStore() };
  return {
    handle(request, url) {
      const { pathname } = url;
      if (pathname === FORMATS_PATH && request.method === 'GET') {
        const channel = CHANNEL.safeParse(url.searchParams.get('channel'));
        if (!channel.success) return fail(400, 'That is not a channel id.');
        return ok({ formats: options.engine.formatBuilder.listFormats(channel.data) });
      }
      if (pathname === FOLLOWED_PATH) {
        return request.method === 'GET' ? followed(context, url) : fail(405, 'Use GET');
      }
      const file = BIBLE_FILE.exec(pathname);
      if (file !== null) {
        return request.method === 'GET'
          ? bibleFile(context, Number(file[1]), file[2] ?? 'md')
          : fail(405, 'Use GET');
      }
      const post = POSTS[pathname];
      if (!post) return null;
      if (request.method === 'POST') return post(context, request);
      return fail(405, pathname === FORMATS_PATH ? 'Use GET or POST' : 'Use POST');
    },
    listJobs: () => context.jobs.list(),
    job: (id) => context.jobs.get(id),
  };
}
