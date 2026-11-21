import { beforeEach, describe, expect, test } from 'vitest';
import { loadCalendar, saveSchedule } from '../src/calendar/load';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteConceptRepo } from '../src/repos/sqliteConceptRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteScheduleRepo } from '../src/repos/sqliteScheduleRepo';
import { SqliteScriptRepo } from '../src/repos/sqliteScriptRepo';
import { SqliteVideoLinkRepo } from '../src/repos/sqliteVideoLinkRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';

const NOW = new Date('2026-11-21T12:00:00Z');
const TODAY = '2026-11-21';
const CENTER = `UC${'c'.repeat(22)}`;
const OTHER = `UC${'z'.repeat(22)}`;

const makeRepos = (db: Db) => ({
  channels: new SqliteChannelRepo(db),
  videos: new SqliteVideoRepo(db),
  edges: new SqliteEdgeRepo(db),
  maps: new SqliteMapRepo(db),
  concepts: new SqliteConceptRepo(db),
  scripts: new SqliteScriptRepo(db),
  links: new SqliteVideoLinkRepo(db),
  schedule: new SqliteScheduleRepo(db),
});

let deps: ReturnType<typeof makeRepos>;
let ids: number[];

const concept = (title: string) => ({
  title,
  altTitles: ['a', 'b'] as const,
  thumbnail: 't',
  overlay: 'o',
  hook: 'h',
  hookStyle: null,
  restsOn: 'r',
  needs: 'nothing',
  origin: 'batch' as const,
  parentId: null,
  engine: 'test',
});

beforeEach(() => {
  const db = openDatabase(':memory:');
  deps = makeRepos(db);
  deps.channels.upsert(
    {
      id: CENTER,
      title: 'Mine',
      handle: null,
      subscribers: 10,
      subscribersHidden: false,
      videoCount: null,
    },
    NOW,
  );
  deps.videos.upsertMany(
    [
      {
        id: 'mine_______',
        channelId: CENTER,
        title: 'Mine',
        views: 10,
        durationSeconds: 60,
        published: { date: NOW, precision: 'day', raw: 'today' },
      },
    ],
    NOW,
  );
  deps.maps.create(
    { centerChannelId: CENTER, depth: 1, region: 'US', members: [{ channelId: CENTER, steps: 0 }] },
    NOW,
  );
  const batch = deps.concepts.createBatch(
    {
      centerChannelId: CENTER,
      inspiration: [],
      hookModels: [],
      format: null,
      angle: null,
      length: 'long',
    },
    NOW,
  );
  ids = deps.concepts
    .addConcepts(batch, [concept('One'), concept('Two'), concept('Three'), concept('Loose')], NOW)
    .map((stored) => stored.id);
  ids.slice(0, 3).forEach((id) => deps.concepts.setKept(CENTER, id, true));
});

describe('loadCalendar', () => {
  test('lists every kept concept with a status worked out from its script and linked video', () => {
    deps.scripts.save(CENTER, ids[1] ?? 0, { status: 'drafting' }, NOW);
    deps.links.link(CENTER, ids[2] ?? 0, 'mine_______', NOW);

    const calendar = loadCalendar(deps, CENTER, NOW, TODAY);

    expect(calendar?.undated.map((item) => [item.title, item.status])).toEqual([
      ['One', 'idea'],
      ['Two', 'drafting'],
      ['Three', 'published'],
    ]);
    expect(calendar?.undated[2]?.linkedVideoId).toBe('mine_______');
    expect(calendar?.pace).toEqual({ channels: 0, medianPerWeek: null, windowDays: 14 });
    expect(calendar?.today).toBe(TODAY);
  });

  test("puts a planned concept in its week, with the owner's status", () => {
    expect(
      saveSchedule(deps, CENTER, ids[0] ?? 0, { status: 'ready', plannedDate: '2026-11-25' }, NOW),
    ).toBe('saved');

    const calendar = loadCalendar(deps, CENTER, NOW, TODAY);

    expect(calendar?.weeks[1]).toMatchObject({ start: '2026-11-23', planned: 1 });
    expect(calendar?.weeks[1]?.items[0]).toMatchObject({ title: 'One', status: 'ready' });
  });

  test('clears a date and a status', () => {
    saveSchedule(deps, CENTER, ids[0] ?? 0, { status: 'ready', plannedDate: '2026-11-25' }, NOW);
    saveSchedule(deps, CENTER, ids[0] ?? 0, { status: null, plannedDate: null }, NOW);

    expect(loadCalendar(deps, CENTER, NOW, TODAY)?.undated[0]).toMatchObject({
      status: 'idea',
      plannedDate: null,
    });
  });

  test("sets a scripted concept's status on its script, so the script writer shows the same", () => {
    deps.scripts.save(CENTER, ids[1] ?? 0, { status: 'drafting' }, NOW);

    saveSchedule(deps, CENTER, ids[1] ?? 0, { status: 'ready', plannedDate: null }, NOW);

    expect(deps.scripts.find(CENTER, ids[1] ?? 0)?.status).toBe('ready');
    expect(loadCalendar(deps, CENTER, NOW, TODAY)?.undated[1]?.status).toBe('ready');
    saveSchedule(deps, CENTER, ids[1] ?? 0, { status: 'published', plannedDate: null }, NOW);
    expect(loadCalendar(deps, CENTER, NOW, TODAY)?.undated[1]?.status).toBe('published');
  });

  test('refuses a concept not kept or of another channel, and a date that is not one', () => {
    expect(
      saveSchedule(deps, CENTER, ids[3] ?? 0, { status: 'idea', plannedDate: null }, NOW),
    ).toBe('no-concept');
    expect(saveSchedule(deps, OTHER, ids[0] ?? 0, { status: 'idea', plannedDate: null }, NOW)).toBe(
      'no-concept',
    );
    expect(
      saveSchedule(deps, CENTER, ids[0] ?? 0, { status: null, plannedDate: '2026-13-01' }, NOW),
    ).toBe('bad-date');
  });

  test('has no calendar for a channel with no map', () => {
    expect(loadCalendar(deps, OTHER, NOW, TODAY)).toBeNull();
  });
});
