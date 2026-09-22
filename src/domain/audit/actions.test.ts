import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  auditDetail,
  auditEntityType,
  auditLabel,
  isAuditAction,
  type AuditAction,
} from './actions.js';
import { categoryLabel } from '../budget/categories.js';

const every = Object.keys(AUDIT_ACTIONS) as AuditAction[];

describe('the audit vocabulary', () => {
  it('gives every action a sentence a person would read', () => {
    for (const action of every) {
      const label = auditLabel(action);
      expect(label.length, action).toBeGreaterThan(3);
      // Not the slug. A trail that renders `budget_line.removed` is a log
      // file, and the point of the closed set is that adding an action means
      // deciding how it reads.
      expect(label, action).not.toBe(action);
      expect(label, action).not.toContain('_');
      expect(label[0], action).toBe(label[0]?.toUpperCase());
    }
  });

  it('names an entity for every action, derived from the action itself', () => {
    for (const action of every) {
      const type = auditEntityType(action);
      expect(type.length, action).toBeGreaterThan(0);
      expect(type, action).not.toContain('.');
      expect(action.startsWith(`${type}.`), action).toBe(true);
    }
  });

  /**
   * A trail outlives the code that wrote it. A row written last month by an
   * action since renamed still has to render, and the slug is a poor sentence
   * and a much better answer than a blank line or a crash.
   */
  it('renders an action this version has never heard of', () => {
    expect(isAuditAction('answer.teleported')).toBe(false);
    expect(auditLabel('answer.teleported')).toBe('answer.teleported');
    expect(auditDetail('answer.teleported', { wordCount: 5 })).toBe('');
  });

  it('never throws on metadata of the wrong shape', () => {
    // jsonb written by an older version, or by hand. Every reader here checks
    // the type rather than trusting it, for the reason `loadLatestReview`
    // does: a trail that cannot render is a trail nobody can check.
    for (const action of every) {
      for (const metadata of [
        {},
        { wordCount: 'lots' },
        { wordCount: null },
        { amountGbp: [] },
        { findings: {} },
        { claim: 42 },
        { filename: '' },
      ] as Record<string, unknown>[]) {
        expect(() => auditDetail(action, metadata), `${action}`).not.toThrow();
        expect(typeof auditDetail(action, metadata)).toBe('string');
      }
    }
  });
});

describe('what a line says beyond its label', () => {
  it('counts an answer’s words, and says when they are over the limit', () => {
    expect(auditDetail('answer.saved', { wordCount: 180, wordLimit: 200 })).toBe('180 words of 200');
    expect(auditDetail('answer.saved', { wordCount: 210, wordLimit: 200 })).toBe(
      '210 words of 200 — over the limit',
    );
    expect(auditDetail('answer.saved', { wordCount: 1, wordLimit: null })).toBe('1 word');
    expect(auditDetail('answer.saved', { wordCount: 0, wordLimit: 200 })).toBe('cleared');
  });

  it('says how much of a drafted answer is traced to a confirmed fact', () => {
    expect(
      auditDetail('answer.drafted', { wordCount: 120, sentences: 6, grounded: 4 }),
    ).toBe('120 words, 4 of 6 sentences traced to a confirmed fact');
  });

  it('says the amount and the category as the budget panel words it', () => {
    // The LABEL, not the id. `metadata` stores the id because that is the
    // stable thing, and a trail reading "freelancers" beside a budget panel
    // reading "Freelancers and contractors" is one record described twice.
    const line = auditDetail('budget_line.added', {
      amountGbp: 12_500,
      category: 'freelancers',
    });
    expect(line).toContain('£12,500');
    expect(line).toContain(categoryLabel('freelancers'));
    expect(line).not.toMatch(/·\s*freelancers$/u);
    // An id from a future version, or a typo, still renders rather than
    // vanishing: a trail outlives the vocabulary that wrote it.
    expect(auditDetail('budget_line.added', { amountGbp: 100, category: 'moonshots' })).toBe(
      '£100 · moonshots',
    );
  });

  it('says which review was run and how much it found', () => {
    expect(auditDetail('review.read', { mode: 'red_team', findings: 3 })).toBe(
      'red team, 3 findings',
    );
    expect(auditDetail('review.read', { mode: 'standard', findings: 1 })).toBe(
      'standard, 1 finding',
    );
  });

  it('renders the funder’s answer in words, with the amount and never the note', () => {
    expect(
      auditDetail('application.decided', {
        decision: 'awarded',
        amountAwardedGbp: 12_500,
        note: 'Funded in full.',
      }),
    ).toBe('Funded · £12,500');
    expect(auditDetail('application.decided', { decision: 'rejected' })).toBe('Turned down');
    expect(auditDetail('application.decided', { decision: 'no_reply' })).toBe('No reply');
    // A funder's reasons belong in the application, where they can be read in
    // context — not copied into the trail as well.
    expect(
      auditDetail('application.decided', { decision: 'rejected', note: 'Oversubscribed.' }),
    ).not.toContain('Oversubscribed');
  });

  it('adds nothing when there is nothing worth adding', () => {
    // A line reads perfectly well as "Outcome removed" with no clause after
    // it, and inventing one to fill the space is how a record becomes padding.
    expect(auditDetail('outcome.removed', {})).toBe('');
    expect(auditDetail('budget_line.removed', {})).toBe('');
    expect(auditDetail('fact.confirmed', {})).toBe('');
  });
});
