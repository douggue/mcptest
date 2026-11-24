import { describe, expect, test } from 'vitest';
import { searchOutlierBank } from '../src/bankTool';
import { FakeEngine } from './fakes';

const textOf = (result: { content: readonly unknown[] }): string =>
  String((result.content[0] as { text?: string } | undefined)?.text);

describe('search_outlier_bank', () => {
  test('answers short rows with the score, its basis and the channel, and counts', () => {
    const engine = new FakeEngine();
    const answer = JSON.parse(textOf(searchOutlierBank(engine, {})));
    expect(answer).toMatchObject({ total: 2, matched: 2, more: 0 });
    expect(answer.videos[0]).toMatchObject({
      id: 'aaaaaaaaaaa',
      x: 23.5,
      usual: 1000,
      n: 9,
      views: 40_000,
      days: 12,
      ch: 'Channel',
      topic: 'Cars',
      close: 'close to Mine',
    });
    expect(answer.videos[1]).not.toHaveProperty('x');
    expect(answer.videos[1]).not.toHaveProperty('country');
  });

  test('turns its arguments into the bank’s filters and caps the list', () => {
    const engine = new FakeEngine();
    const answer = JSON.parse(
      textOf(
        searchOutlierBank(engine, {
          min_score: 10,
          max_age_days: 30,
          length: ['8-20'],
          topics: ['Cars'],
          collection: 'hooks TO steal',
          title_has: 'video',
          sort: 'views',
          limit: 1,
        }),
      ),
    );
    expect(answer).toMatchObject({ matched: 1, more: 0 });
    expect(engine.bankStates[0]).toMatchObject({
      chosen: { score: ['10'], age: ['30'], length: ['8-20'], topic: ['Cars'], collection: ['c7'] },
      contains: 'video',
      sort: 'views',
    });
  });

  test('refuses what it cannot take, in one plain sentence', () => {
    const engine = new FakeEngine();
    expect(searchOutlierBank(engine, { min_score: 3 as never }).isError).toBe(true);
    expect(searchOutlierBank(engine, { limit: 500 }).isError).toBe(true);
    const missing = searchOutlierBank(engine, { collection: 'Nope' });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/no collection/);
  });
});
