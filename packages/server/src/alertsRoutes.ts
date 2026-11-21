/**
 * The routes of alerts: a channel's rule and alerts, the unread count of each
 * saved channel, saving a rule and marking a channel's alerts read.
 */
import { ALERT_MAX_MIN_SCORE, ALERT_MIN_MIN_SCORE } from '@jgtube/core';
import { z } from 'zod';
import { fail, ok } from './http';
import { CHANNEL_ID, NO_MAP, bodyOf, channelOf, type Context, type Routes } from './labHttp';

const channelRequest = z.object({ channel: z.string().regex(CHANNEL_ID) });
const ruleRequest = channelRequest.extend({
  minScore: z.number().min(ALERT_MIN_MIN_SCORE).max(ALERT_MAX_MIN_SCORE),
  takenOff: z.boolean(),
  enabled: z.boolean(),
});
const RULE_ASKED = `Give the channel id, minScore from ${ALERT_MIN_MIN_SCORE} to ${ALERT_MAX_MIN_SCORE}, and takenOff and enabled as true or false`;

function readAlerts(context: Context, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const found = context.options.engine.extras.findAlerts(channel);
  return found ? ok(found) : fail(404, NO_MAP);
}

async function saveRule(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, ruleRequest, RULE_ASKED);
  if (body instanceof Response) return body;
  const { channel, ...settings } = body;
  const saved = context.options.engine.extras.saveAlertRule(channel, settings);
  return saved ? ok(saved) : fail(404, NO_MAP);
}

async function markRead(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, channelRequest, 'Give the channel as a channel id');
  if (body instanceof Response) return body;
  const marked = context.options.engine.extras.markAlertsRead(body.channel);
  return marked ? ok(marked) : fail(404, NO_MAP);
}

export const ALERTS_ROUTES: Routes = {
  '/api/alerts': { GET: (context, _request, url) => readAlerts(context, url) },
  '/api/alerts/counts': {
    GET: (context) => ok({ counts: context.options.engine.extras.alertCounts() }),
  },
  '/api/alerts/rule': { POST: saveRule },
  '/api/alerts/read': { POST: markRead },
};
