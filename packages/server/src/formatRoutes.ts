/**
 * The format builder's routes: the shelf (list, add by source, a note, take
 * off) and the owner's own pictures for it. Every write passes the Host,
 * Origin and JSON checks the other routes use; every body is checked with
 * zod; a picture is checked by its first bytes and saved under a new name.
 */
import {
  BREAKDOWN_PARTS,
  INGREDIENT_LAYERS,
  MAX_INGREDIENT_NAME,
  MAX_INGREDIENT_NOTE,
  MAX_NOTE_TEXT,
  TEARDOWN_SECTIONS,
  newUploadKey,
  parseVideoRef,
  pathInside,
} from '@jgtube/core';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { z } from 'zod';
import type { AppOptions } from './app';
import { OverTheCap, writeBody } from './breakdownRoutes';
import { fail, isCrossSite, ok, readJson } from './http';
import type { IngredientRequest } from './formatTypes';

export const INGREDIENTS_PATH = '/api/format/ingredients';
export const FORMAT_IMAGES_PATH = '/api/format/images';
const IMAGE_FILE_PATH = /^\/api\/format\/images\/([\w-]{11}\.(?:png|jpg|webp))$/;
/** A picture for the shelf is a still, not a video: well under this. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CHANNEL = z.string().regex(/^UC[\w-]{22}$/);
const VIDEO = z.string().regex(/^[\w-]{11}$/);
const KEY = z.string().min(1).max(200);
const LAYER = z.enum(INGREDIENT_LAYERS);
const NAME = z.string().trim().min(1).max(MAX_INGREDIENT_NAME);

const sourceRequest = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('formula'),
    center: CHANNEL,
    id: z.number().int().positive(),
    windowDays: z.number().int().positive().max(400),
  }),
  z.object({ kind: z.enum(['transfer-format', 'transfer-idea']), key: KEY }),
  z.object({ kind: z.literal('hook'), center: CHANNEL, videoId: VIDEO }),
  z.object({
    kind: z.literal('video'),
    use: z.enum(['video', 'own-video', 'thumbnail']),
    videoId: VIDEO,
    center: CHANNEL.nullable().default(null),
  }),
  z.object({ kind: z.literal('niche'), channelId: CHANNEL }),
  z.object({
    kind: z.literal('breakdown-part'),
    channelId: CHANNEL,
    part: z.enum(BREAKDOWN_PARTS),
    layer: LAYER.nullable().default(null),
  }),
  z.object({
    kind: z.literal('teardown'),
    videoId: VIDEO,
    section: z.enum(TEARDOWN_SECTIONS),
    index: z.number().int().nonnegative().max(40).default(0),
  }),
  z.object({ kind: z.literal('link'), url: z.string().min(1).max(300) }),
  z.object({
    kind: z.literal('note'),
    layer: LAYER,
    name: NAME,
    text: z.string().trim().min(1).max(MAX_NOTE_TEXT),
  }),
  z.object({
    kind: z.enum(['image', 'clip']),
    layer: LAYER,
    name: NAME,
    file: z.string().regex(/^[\w-]{11}(?:\.(?:png|jpg|webp))?$/),
  }),
]);

const noteRequest = z.object({
  id: z.number().int().positive(),
  note: z.string().max(MAX_INGREDIENT_NOTE),
});
const removeRequest = z.object({ id: z.number().int().positive() });

const BAD_SOURCE = 'Name what to add: its kind and the ids that find it.';
const BAD_LINK =
  'Give a YouTube video link (youtube.com/watch?v=… or youtu.be/…) or the video’s 11-character id.';
const NOT_FOUND = 'There is no such ingredient.';

async function parsed<T>(options: AppOptions, request: Request, schema: z.ZodType<T>) {
  const body = await readJson(options.allowedHosts, request, 8_000);
  if (body instanceof Response) return body;
  const result = schema.safeParse(body);
  return result.success ? result.data : null;
}

function requestOf(body: z.infer<typeof sourceRequest>): IngredientRequest | Response {
  if (body.kind !== 'link') return body;
  try {
    return { kind: 'link', videoId: parseVideoRef(body.url) };
  } catch {
    return fail(400, BAD_LINK);
  }
}

async function addIngredient(options: AppOptions, request: Request): Promise<Response> {
  const body = await parsed(options, request, sourceRequest);
  if (body instanceof Response) return body;
  if (body === null) return fail(400, BAD_SOURCE);
  const named = requestOf(body);
  if (named instanceof Response) return named;
  const outcome = options.engine.formats.addIngredient(named);
  return 'added' in outcome ? ok(outcome.added, 201) : fail(outcome.status, outcome.problem);
}

async function setNote(options: AppOptions, request: Request): Promise<Response> {
  const body = await parsed(options, request, noteRequest);
  if (body instanceof Response) return body;
  if (body === null) return fail(400, 'Give the ingredient’s number and the note.');
  return options.engine.formats.setIngredientNote(body.id, body.note)
    ? ok({ id: body.id })
    : fail(404, NOT_FOUND);
}

async function remove(options: AppOptions, request: Request): Promise<Response> {
  const body = await parsed(options, request, removeRequest);
  if (body instanceof Response) return body;
  if (body === null) return fail(400, 'Give the ingredient’s number.');
  return options.engine.formats.removeIngredient(body.id)
    ? ok({ id: body.id })
    : fail(404, NOT_FOUND);
}

/** The kind of picture its first bytes say it is, or null. */
export function imageKindOf(head: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  const starts = (bytes: readonly number[], at = 0) =>
    bytes.every((byte, index) => head[at + index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

/** Saves a picture the owner gives under a new name, only once it is whole and a picture. */
async function uploadImage(options: AppOptions, request: Request): Promise<Response> {
  if (isCrossSite(request, options.allowedHosts)) {
    return fail(403, 'Requests from other sites are not accepted');
  }
  if (Number(request.headers.get('content-length') ?? '0') > MAX_IMAGE_BYTES) {
    return fail(413, 'A picture may be 8 MB at most.');
  }
  if (request.body === null) return fail(400, 'No picture was sent.');
  let folder: string;
  try {
    folder = options.engine.formats.imagesFolder();
    await mkdir(folder, { recursive: true });
  } catch {
    return fail(500, 'There is no folder to keep pictures in.');
  }
  const partial = pathInside(folder, `upload.part-${randomUUID()}`);
  try {
    await writeBody(request.body, partial, MAX_IMAGE_BYTES);
    const kind = imageKindOf(new Uint8Array((await readFile(partial)).subarray(0, 12)));
    if (kind === null) return fail(415, 'Only PNG, JPEG and WebP pictures are taken.');
    const file = `${newUploadKey()}.${kind}`;
    await rename(partial, pathInside(folder, file));
    return ok({ file }, 201);
  } catch (error) {
    if (error instanceof OverTheCap) return fail(413, 'A picture may be 8 MB at most.');
    return fail(400, 'The picture did not arrive whole.');
  } finally {
    await rm(partial, { force: true }).catch(() => undefined);
  }
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

async function readImage(options: AppOptions, file: string): Promise<Response> {
  try {
    const bytes = await readFile(pathInside(options.engine.formats.imagesFolder(), file));
    const kind = file.slice(file.lastIndexOf('.') + 1) as keyof typeof TYPES;
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': TYPES[kind],
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return fail(404, 'There is no such picture.');
  }
}

const POSTS: Readonly<
  Record<string, (options: AppOptions, request: Request) => Promise<Response>>
> = {
  [INGREDIENTS_PATH]: addIngredient,
  [`${INGREDIENTS_PATH}/note`]: setNote,
  [`${INGREDIENTS_PATH}/remove`]: remove,
};

/** The answer for a format builder path; null for any other path. */
export function formatRoutes(
  options: AppOptions,
  request: Request,
  url: URL,
): Promise<Response> | Response | null {
  const { pathname } = url;
  const { method } = request;
  const image = IMAGE_FILE_PATH.exec(pathname);
  if (image) return method === 'GET' ? readImage(options, image[1] ?? '') : fail(405, 'Use GET');
  if (pathname === FORMAT_IMAGES_PATH) {
    return method === 'PUT' ? uploadImage(options, request) : fail(405, 'Use PUT');
  }
  if (pathname === INGREDIENTS_PATH && method === 'GET') {
    return ok({ ingredients: options.engine.formats.listIngredients() });
  }
  const post = POSTS[pathname];
  if (!post) return null;
  if (method === 'POST') return post(options, request);
  return fail(405, pathname === INGREDIENTS_PATH ? 'Use GET or POST' : 'Use POST');
}
