import { describe, expect, test } from 'vitest';
import { promptCatalog } from './promptCatalog';

/**
 * One snapshot for every question the app can put to an AI engine, built
 * with stand-in values. A change to any question's wording shows up here as
 * a changed snapshot, so it is read in review before it reaches an engine.
 *
 * To accept an intended change: npx vitest run packages/server/test/promptSnapshots.test.ts -u
 */
describe('every question, word for word', () => {
  const catalog = promptCatalog();

  test('each question has a name of its own', () => {
    const names = catalog.map((entry) => entry.name);

    expect(new Set(names).size).toBe(names.length);
  });

  test.each(catalog.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(`SYSTEM PROMPT\n${entry.systemPrompt}\n\nQUESTION\n${entry.prompt}`).toMatchSnapshot();
  });
});
