import {
  SqliteChannelRepo,
  SqliteConceptRepo,
  SqliteEdgeRepo,
  SqliteMapRepo,
  SqliteScheduleRepo,
  SqliteScriptRepo,
  SqliteVideoLinkRepo,
  SqliteVideoRepo,
  openDatabase,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { calendarEngine, localDate } from '../src/calendarEngine';
import type { CalendarEngine } from '../src/calendarTypes';

const NOW = new Date(2026, 10, 21, 12, 0);
const CENTER = `UC${'c'.repeat(22)}`;
const NO_MAP = `UC${'n'.repeat(22)}`;

let engine: CalendarEngine;
let conceptId: number;

beforeEach(() => {
  const db = openDatabase(':memory:');
  const repos = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    concepts: new SqliteConceptRepo(db),
    scripts: new SqliteScriptRepo(db),
    links: new SqliteVideoLinkRepo(db),
    schedule: new SqliteScheduleRepo(db),
  };
  repos.channels.upsert(
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
  repos.maps.create(
    { centerChannelId: CENTER, depth: 1, region: 'US', members: [{ channelId: CENTER, steps: 0 }] },
    NOW,
  );
  const batch = repos.concepts.createBatch(
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
  const [stored] = repos.concepts.addConcepts(
    batch,
    [
      {
        title: 'Plan',
        altTitles: ['a', 'b'],
        thumbnail: 't',
        overlay: 'o',
        hook: 'h',
        hookStyle: null,
        restsOn: 'r',
        needs: 'nothing',
        origin: 'batch',
        parentId: null,
        engine: 'test',
      },
    ],
    NOW,
  );
  conceptId = stored?.id ?? 0;
  repos.concepts.setKept(CENTER, conceptId, true);
  engine = calendarEngine({ now: () => NOW, repos });
});

describe('calendarEngine', () => {
  test("counts weeks from the computer's own date and saves an item", () => {
    expect(engine.findCalendar(CENTER)?.today).toBe(localDate(NOW));

    const reply = engine.saveCalendarItem(CENTER, conceptId, {
      status: 'drafting',
      plannedDate: '2026-11-24',
    });

    expect(reply.outcome).toBe('saved');
    expect(reply.calendar?.weeks[1]?.items.map((item) => item.status)).toEqual(['drafting']);
  });

  test('refuses a channel with no map and a bad date, answering no calendar', () => {
    expect(engine.findCalendar(NO_MAP)).toBeNull();
    expect(engine.saveCalendarItem(NO_MAP, conceptId, { status: null, plannedDate: null })).toEqual(
      {
        outcome: 'no-map',
        calendar: null,
      },
    );
    expect(
      engine.saveCalendarItem(CENTER, conceptId, { status: null, plannedDate: '2026-02-31' }),
    ).toEqual({ outcome: 'bad-date', calendar: null });
  });
});
