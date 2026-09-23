import { describe, expect, it } from 'vitest';

import {
  listOfQuestions,
  readWorkAnswers,
  unansweredAboutTheWork,
  WORK_CLAIMS,
  WORK_QUESTIONS,
} from './about-the-work.js';
import { SUGGESTED_CLAIMS } from './self-declared.js';

describe('the three questions about the work', () => {
  it('are asked in the order a form asks them', () => {
    expect(WORK_QUESTIONS.map((q) => q.id)).toEqual(['what', 'who', 'how_many']);
  });

  it('are all answered by nothing a legal identity supplies', () => {
    // The whole point. If any of these were legal_name, company_number and
    // so on, setup would satisfy the gate on its own again.
    const identity = [
      'legal_name',
      'legal_form',
      'company_number',
      'incorporation_date',
      'area_of_operation',
      'registered_office',
    ];
    expect(unansweredAboutTheWork(identity)).toHaveLength(3);
  });

  it('store answers under claims the rest of the product already knows', () => {
    // A typed mission and one read off a website must land on the same key,
    // or they become two facts about the same thing.
    const vocabulary: readonly string[] = SUGGESTED_CLAIMS;
    for (const claim of WORK_CLAIMS) expect(vocabulary, claim).toContain(claim);
    for (const question of WORK_QUESTIONS) {
      expect(question.answeredBy, question.id).toContain(question.claim);
    }
  });

  it('treat any claim that answers a question as answering it', () => {
    expect(unansweredAboutTheWork(['programme_description']).map((q) => q.id)).toEqual([
      'who',
      'how_many',
    ]);
  });

  it('are all answered by the three claims they store', () => {
    expect(unansweredAboutTheWork(WORK_QUESTIONS.map((q) => q.claim))).toEqual([]);
  });

  it('each say why a funder wants the answer', () => {
    for (const question of WORK_QUESTIONS) expect(question.why, question.id).not.toBe('');
  });
});

describe('listOfQuestions', () => {
  it('reads as English at every length', () => {
    const [what, who, howMany] = WORK_QUESTIONS;
    expect(listOfQuestions([])).toBe('');
    expect(listOfQuestions([howMany!])).toBe('how many you reach');
    expect(listOfQuestions([who!, howMany!])).toBe('who it is for and how many you reach');
    expect(listOfQuestions([what!, who!, howMany!])).toBe(
      'what you do, who it is for and how many you reach',
    );
  });
});

const from = (answers: Record<string, string>) => (claim: string) => answers[claim] ?? '';

describe('readWorkAnswers', () => {
  it('stores each answered question under its own claim', () => {
    const read = readWorkAnswers(
      from({ mission: '  We grow trees. ', beneficiary_groups: 'Young people' }),
    );
    expect(read.errors).toEqual({});
    expect(read.blank).toBe(false);
    expect(read.facts).toEqual([
      { claim: 'mission', value: 'We grow trees.' },
      { claim: 'beneficiary_groups', value: 'Young people' },
    ]);
  });

  it('never stores a claim it did not ask', () => {
    // Field names come from the browser.
    const read = readWorkAnswers(
      from({ mission: 'We grow trees.', legal_form: 'Registered charity' }),
    );
    expect(read.facts.map((f) => f.claim)).toEqual(['mission']);
  });

  it('refuses an entirely blank submission, and says so', () => {
    const read = readWorkAnswers(from({ mission: '   ' }));
    expect(read.facts).toEqual([]);
    expect(read.blank).toBe(true);
    // Not pinned to a field: nothing is wrong with any one answer.
    expect(read.errors).toEqual({});
  });

  it('saves nothing when one answer is refused', () => {
    // Half a submission saved and half bounced leaves the person unsure
    // which of their answers is now the record.
    const read = readWorkAnswers(
      from({ mission: 'We grow trees.', beneficiary_groups: 'x'.repeat(5000) }),
    );
    expect(read.facts).toEqual([]);
    expect(read.errors['beneficiary_groups']).toBeDefined();
  });
});
