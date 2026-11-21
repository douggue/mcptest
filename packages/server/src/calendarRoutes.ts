/** The routes of the upload calendar: a channel's calendar, and saving one concept's place in it. */
import { CONCEPT_STATUSES } from '@jgtube/core';
import { z } from 'zod';
import type { CalendarOutcome } from './calendarTypes';
import { fail, ok } from './http';
import { CHANNEL_ID, NO_MAP, bodyOf, channelOf, type Context, type Routes } from './labHttp';

const itemRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  conceptId: z.number().int().positive(),
  status: z.enum(CONCEPT_STATUSES).nullable(),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

const REFUSED: Readonly<Record<Exclude<CalendarOutcome, 'saved'>, readonly [number, string]>> = {
  'no-concept': [404, 'There is no kept concept with that number for this channel.'],
  'bad-date': [400, 'Give the date as a real day, YYYY-MM-DD.'],
  'no-map': [404, NO_MAP],
};

function readCalendar(context: Context, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const calendar = context.options.engine.extras.findCalendar(channel);
  return calendar ? ok(calendar) : fail(404, NO_MAP);
}

async function saveItem(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    itemRequest,
    `Give the channel id, the concept number, a status (${CONCEPT_STATUSES.join(', ')} or null) and a date as YYYY-MM-DD or null`,
  );
  if (body instanceof Response) return body;
  const { channel, conceptId, status, plannedDate } = body;
  const reply = context.options.engine.extras.saveCalendarItem(channel, conceptId, {
    status,
    plannedDate,
  });
  if (reply.outcome === 'saved' && reply.calendar) return ok(reply.calendar);
  const [code, message] = reply.outcome === 'saved' ? REFUSED['no-map'] : REFUSED[reply.outcome];
  return fail(code, message);
}

export const CALENDAR_ROUTES: Routes = {
  '/api/calendar': { GET: (context, _request, url) => readCalendar(context, url) },
  '/api/calendar/item': { POST: saveItem },
};
