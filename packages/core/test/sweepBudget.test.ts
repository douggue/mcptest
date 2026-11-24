import { describe, expect, test } from 'vitest';
import { BANK_FIND_DAILY_API_UNITS, BANK_FIND_DAILY_PAGE_REQUESTS } from '../src/bank/cost';
import {
  READING_BUDGET_DEFAULT,
  READING_BUDGET_HELP,
  READING_BUDGET_MAX,
  READING_BUDGET_MIN,
  budgetProblem,
  keywordCost,
  keywordProblem,
  leftOf,
  planSweep,
  scheduleProblem,
  snowballCost,
  sweepAllowance,
  sweepCosts,
  tidyKeyword,
} from '../src/sweep/budget';

describe('the reading budget', () => {
  test('starts at the cap finds always had and goes up to five times it', () => {
    expect(READING_BUDGET_DEFAULT).toBe(BANK_FIND_DAILY_PAGE_REQUESTS);
    expect(READING_BUDGET_MAX).toBe(5 * BANK_FIND_DAILY_PAGE_REQUESTS);
    expect(budgetProblem(READING_BUDGET_DEFAULT)).toBeNull();
    expect(budgetProblem(READING_BUDGET_MAX)).toBeNull();
    expect(budgetProblem(READING_BUDGET_MAX + 1)).toMatch(/whole number/);
    expect(budgetProblem(READING_BUDGET_MIN - 1)).toMatch(/whole number/);
    expect(budgetProblem(250.5)).toMatch(/whole number/);
  });

  test('its help says more reading comes from the address YouTube sees, never faster', () => {
    expect(READING_BUDGET_HELP).toMatch(/more reading from the address YouTube sees/);
    expect(READING_BUDGET_HELP).toMatch(/proxy/);
    expect(READING_BUDGET_HELP).toMatch(/never makes reading faster/);
  });

  test('what is left is the budget less what the day spent, never below nothing', () => {
    const pages = sweepAllowance('pages', 400, { pages: 150, units: 0 });
    expect(pages).toEqual({ pages: { cap: 400, used: 150, left: 250 }, units: null });
    expect(leftOf(pages)).toEqual({ pages: 250, units: 0 });
    const api = sweepAllowance('api', 400, { pages: 900, units: 100 });
    expect(api.pages.left).toBe(0);
    expect(api.units).toEqual({
      cap: BANK_FIND_DAILY_API_UNITS,
      used: 100,
      left: BANK_FIND_DAILY_API_UNITS - 100,
    });
  });
});

describe('what a sweep costs', () => {
  test('a keyword is one search and ten channels at the most a channel takes', () => {
    expect(sweepCosts('pages')).toEqual({
      search: { pages: 1, units: 0 },
      channel: { pages: 5, units: 0 },
      sidebar: { pages: 2, units: 0 },
    });
    expect(keywordCost('pages')).toEqual({ pages: 51, units: 0 });
    expect(keywordCost('api')).toEqual({ pages: 0, units: 150 });
    expect(snowballCost('pages')).toEqual({ pages: 5 * 2 * 2 + 5 * 3 * 5, units: 0 });
    expect(snowballCost('api')).toEqual({ pages: 20, units: 75 });
  });

  test('the plan never says more than is left and says how many keywords fit', () => {
    const roomy = planSweep('pages', 2, { pages: 400, units: 0 });
    expect(roomy).toEqual({
      via: 'pages',
      keywords: 2,
      keywordsCovered: 2,
      most: { pages: 2 * 51 + 95, units: 0 },
    });
    const tight = planSweep('pages', 12, { pages: 400, units: 0 });
    expect(tight.keywordsCovered).toBe(5);
    expect(tight.most.pages).toBe(400);
    expect(planSweep('api', 20, { pages: 400, units: 1500 }).keywordsCovered).toBe(7);
    expect(planSweep('pages', 3, { pages: 0, units: 0 }).keywordsCovered).toBe(0);
  });
});

describe('what the owner types', () => {
  test('a keyword is tidied and bounded', () => {
    expect(tidyKeyword('  lost   cities ')).toBe('lost cities');
    expect(keywordProblem('lost cities')).toBeNull();
    expect(keywordProblem(' a ')).toMatch(/2 to 80/);
    expect(keywordProblem('x'.repeat(81))).toMatch(/2 to 80/);
  });

  test('a schedule is off, daily or every N days', () => {
    expect(scheduleProblem(null)).toBeNull();
    expect(scheduleProblem(1)).toBeNull();
    expect(scheduleProblem(30)).toBeNull();
    expect(scheduleProblem(0)).toMatch(/1 to 30/);
    expect(scheduleProblem(31)).toMatch(/1 to 30/);
    expect(scheduleProblem(1.5)).toMatch(/1 to 30/);
  });
});
