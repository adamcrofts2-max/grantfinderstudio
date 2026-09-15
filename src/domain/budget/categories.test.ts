/**
 * Every category has a label, and nothing else gets into the column.
 */
import { describe, expect, it } from 'vitest';

import { COST_CATEGORIES, categoryLabel, isCostCategory } from './categories.js';
import type { CostCategory } from './validate.js';

describe('the category list', () => {
  it('covers the type exhaustively', () => {
    // If a category is added to `CostCategory` without a label here, this
    // fails — rather than the select quietly missing an option and the
    // database quietly accepting a value the form cannot produce.
    const listed = COST_CATEGORIES.map((c) => c.id).toSorted();
    const declared: CostCategory[] = [
      'staff', 'freelancers', 'equipment', 'materials', 'venues', 'travel',
      'training', 'marketing', 'evaluation', 'management', 'overheads', 'capital',
    ];
    expect(listed).toEqual(declared.toSorted());
  });

  it('gives every category a label and a hint', () => {
    for (const category of COST_CATEGORIES) {
      expect(category.label.length, category.id).toBeGreaterThan(0);
      expect(category.hint.length, category.id).toBeGreaterThan(10);
    }
  });

  it('distinguishes overheads from project management, which people conflate', () => {
    // Getting these the wrong way round is what puts a budget over an
    // overhead cap, so both hints have to say what belongs in them.
    const overheads = COST_CATEGORIES.find((c) => c.id === 'overheads');
    expect(overheads?.hint).toMatch(/not project management/iu);
  });

  it('warns that equipment reads as capital to most funders', () => {
    expect(COST_CATEGORIES.find((c) => c.id === 'equipment')?.hint).toMatch(/capital/iu);
  });
});

describe('guarding the enum', () => {
  it('accepts a real category', () => {
    expect(isCostCategory('overheads')).toBe(true);
  });

  it('refuses anything else, because the browser is not trustworthy', () => {
    // The column is a Postgres enum: an unrecognised value would otherwise
    // reach the database and fail there, turning a bad select into a 500.
    for (const bad of ['', 'Overheads', 'salaries', null, undefined, 7, {}]) {
      expect(isCostCategory(bad), String(bad)).toBe(false);
    }
  });
});

describe('labelling', () => {
  it('uses the human label', () => {
    expect(categoryLabel('marketing')).toBe('Reaching people');
  });
});
