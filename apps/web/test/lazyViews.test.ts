import { describe, expect, test } from 'vitest';
import { CREATE_VIEWS } from '../src/components/CreateViews';
import { VIEW_GROUPS } from '../src/components/lazyViews';
import { MY_CHANNEL_VIEWS } from '../src/components/MyChannelViews';
import { RESEARCH_VIEWS } from '../src/components/ResearchViews';
import { STUDY_VIEWS } from '../src/components/StudyViews';

const TABLES = {
  research: RESEARCH_VIEWS,
  create: CREATE_VIEWS,
  study: STUDY_VIEWS,
  myChannel: MY_CHANNEL_VIEWS,
};

describe('the screens fetched by group', () => {
  test('name every screen of every table, in the group whose file draws it', () => {
    const fromTables = Object.entries(TABLES).flatMap(([group, table]) =>
      Object.keys(table).map((view) => [view, group]),
    );

    expect(Object.fromEntries(fromTables)).toEqual(VIEW_GROUPS);
  });
});
