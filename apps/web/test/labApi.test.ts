import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/lib/api';
import { createLabApi } from '../src/lib/labApi';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';

/** A lab API whose server answers every request with `data`, noting what was asked. */
function recording(data: unknown, status = 200) {
  const sent: string[] = [];
  const api = createLabApi(async (url, init) => {
    sent.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`.trim());
    return new Response(
      JSON.stringify({ success: status < 400, data, error: status < 400 ? null : 'No map' }),
      { status },
    );
  });
  return { api, sent };
}

describe('the idea lab’s API', () => {
  test('reads a channel’s concepts, formulas and hooks by its id', async () => {
    const { api, sent } = recording({ concepts: [{ id: 1 }], formulas: [], hooks: [] });

    await expect(api.concepts(CHANNEL)).resolves.toEqual([{ id: 1 }]);
    await api.formulas(CHANNEL, 30);
    await api.hooks(CHANNEL);

    expect(sent).toEqual([
      `GET /api/lab/concepts?channel=${CHANNEL}`,
      `GET /api/lab/formulas?channel=${CHANNEL}&window=30`,
      `GET /api/lab/hooks?channel=${CHANNEL}`,
    ]);
  });

  test('gives nothing for a channel with no map, and the reason for any other refusal', async () => {
    const none = recording(null, 404).api;
    const refused = recording(null, 400).api;

    await expect(none.concepts(CHANNEL)).resolves.toBeNull();
    await expect(none.formulas(CHANNEL, 90)).resolves.toBeNull();
    await expect(none.hooks(CHANNEL)).resolves.toBeNull();
    await expect(refused.concepts(CHANNEL)).rejects.toBeInstanceOf(ApiError);
  });

  test('starts each kind of job and hands back the job to poll', async () => {
    const { api, sent } = recording({ jobId: 'job-1' });

    await expect(api.startBatch({ channel: CHANNEL, inspiration: ['a'] })).resolves.toBe('job-1');
    await api.grow('twist', CHANNEL, 7, 'auto');
    await api.grow('more', CHANNEL, 7, 'codex');
    await api.startWhereElse(CHANNEL, 'claude');
    await api.startFormulas(CHANNEL, 90, 'auto');
    await api.startHookBuild(CHANNEL);
    await api.startHookLabels(CHANNEL, 'agy');

    expect(sent).toEqual([
      `POST /api/lab/concepts {"channel":"${CHANNEL}","inspiration":["a"]}`,
      `POST /api/lab/concepts/twist {"channel":"${CHANNEL}","concept":7}`,
      `POST /api/lab/concepts/more {"channel":"${CHANNEL}","concept":7,"engine":"codex"}`,
      `POST /api/lab/where-else {"channel":"${CHANNEL}","engine":"claude"}`,
      `POST /api/lab/formulas {"channel":"${CHANNEL}","window":90}`,
      `POST /api/lab/hooks/build {"channel":"${CHANNEL}"}`,
      `POST /api/lab/hooks/label {"channel":"${CHANNEL}","engine":"agy"}`,
    ]);
  });

  test('opens and saves a script, starts a stage and measures a voice', async () => {
    const { api, sent } = recording({ jobId: 'job-2', script: null });

    await api.openScript(CHANNEL, 7);
    await api.saveScript(CHANNEL, 7, { draft: 'Words.', status: 'ready' });
    await expect(api.startStage(CHANNEL, 7, 'draft', 'claude')).resolves.toBe('job-2');
    await api.voice(CHANNEL, 'UCvvvvvvvvvvvvvvvvvvvvvv');
    await api.startVoiceRead(CHANNEL, 'UCvvvvvvvvvvvvvvvvvvvvvv');

    expect(sent).toEqual([
      `POST /api/lab/scripts/open {"channel":"${CHANNEL}","concept":7}`,
      `POST /api/lab/scripts {"channel":"${CHANNEL}","concept":7,"changes":{"draft":"Words.","status":"ready"}}`,
      `POST /api/lab/scripts/stage {"channel":"${CHANNEL}","concept":7,"stage":"draft","engine":"claude"}`,
      `GET /api/lab/voice?channel=${CHANNEL}&voice=UCvvvvvvvvvvvvvvvvvvvvvv`,
      `POST /api/lab/voice/read {"channel":"${CHANNEL}","voice":"UCvvvvvvvvvvvvvvvvvvvvvv"}`,
    ]);
  });

  test('keeps a concept, clears the rest and reads a job', async () => {
    const { api, sent } = recording({ removed: 4, id: 'job-1', status: 'running' });

    await api.keep(CHANNEL, 7, true);
    await expect(api.clear(CHANNEL)).resolves.toBe(4);
    await expect(api.job('job 1')).resolves.toMatchObject({ status: 'running' });

    expect(sent).toEqual([
      `POST /api/lab/concepts/keep {"channel":"${CHANNEL}","concept":7,"kept":true}`,
      `POST /api/lab/concepts/clear {"channel":"${CHANNEL}"}`,
      'GET /api/jobs/job%201',
    ]);
  });
});

describe('a concept’s thumbnail prompt through the API', () => {
  test('lists the stored prompts and starts a run with the chosen engine', async () => {
    const { api, sent } = recording({ thumbnails: [{ conceptId: 7 }], jobId: 'job-2' });

    await expect(api.conceptThumbnails(CHANNEL)).resolves.toEqual([{ conceptId: 7 }]);
    await expect(api.startThumbnail(CHANNEL, 7, 'codex')).resolves.toBe('job-2');

    expect(sent).toEqual([
      `GET /api/lab/concepts/thumbnails?channel=${CHANNEL}`,
      `POST /api/lab/concepts/thumbnail {"channel":"${CHANNEL}","concept":7,"engine":"codex"}`,
    ]);
  });

  test('gives none for a channel with no map', async () => {
    await expect(recording(null, 404).api.conceptThumbnails(CHANNEL)).resolves.toBeNull();
  });
});

describe('the script writer’s research through the API', () => {
  test('reads the research, starts a research run and a claims check, and sets a typed length', async () => {
    const { api, sent } = recording({ sheet: null, claims: [], jobId: 'job-3' });

    await expect(api.research(CHANNEL, 7)).resolves.toMatchObject({ sheet: null });
    await expect(api.startResearch(CHANNEL, 7, 'auto')).resolves.toBe('job-3');
    await expect(api.startClaims(CHANNEL, 7, 'draft', 'claude')).resolves.toBe('job-3');
    await api.setLength(CHANNEL, 7, { typed: 'words', words: 1800 });

    expect(sent).toEqual([
      `GET /api/lab/research?channel=${CHANNEL}&concept=7`,
      `POST /api/lab/research {"channel":"${CHANNEL}","concept":7}`,
      `POST /api/lab/claims {"channel":"${CHANNEL}","concept":7,"which":"draft","engine":"claude"}`,
      `POST /api/lab/scripts/length {"channel":"${CHANNEL}","concept":7,"length":{"typed":"words","words":1800}}`,
    ]);
  });
});
