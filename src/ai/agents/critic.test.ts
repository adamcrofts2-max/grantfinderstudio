import { describe, expect, it } from 'vitest';

import {
  buildCriticPrompt,
  bySeverity,
  CRITIC,
  criticOutputSchema,
  FINDING_KINDS,
  keepCheckableFindings,
  RED_TEAM,
  type CriticInput,
  type CriticOutput,
} from './critic.js';

function input(overrides: Partial<CriticInput> = {}): CriticInput {
  return {
    opportunityTitle: 'Green Futures Grant',
    funderName: 'The Example Trust',
    criteriaLabels: ['Work must take place within Somerset'],
    questions: [
      { position: 1, question: 'What will you do?', answer: 'We will run workshops.' },
      { position: 2, question: 'Who benefits?', answer: 'Young people in Wells.' },
    ],
    ...overrides,
  };
}

function output(overrides: Partial<CriticOutput> = {}): CriticOutput {
  return {
    findings: [],
    mostImportant: null,
    strengths: [],
    instructionLikeContent: [],
    ...overrides,
  };
}

const finding = (over: Partial<CriticOutput['findings'][number]> = {}) => ({
  kind: 'missing_specifics' as const,
  questionNumber: 1,
  quote: 'We will run workshops.',
  problem: 'No number of workshops or participants is given.',
  suggestion: 'Say how many workshops and how many people will attend.',
  severity: 'worth_fixing' as const,
  ...over,
});

describe('criticOutputSchema', () => {
  it('accepts a well-formed review', () => {
    const parsed = criticOutputSchema.parse(output({ findings: [finding()] }));
    expect(parsed.findings).toHaveLength(1);
  });

  it('allows a finding about the whole application, with no quote', () => {
    const parsed = criticOutputSchema.parse(
      output({ findings: [finding({ questionNumber: null, quote: null })] }),
    );
    expect(parsed.findings[0]?.quote).toBeNull();
  });

  it('rejects a finding with no suggested action', () => {
    // A criticism with nothing to do about it wastes the applicant's time.
    expect(() =>
      criticOutputSchema.parse(output({ findings: [finding({ suggestion: '' })] })),
    ).toThrow();
  });

  it('rejects a finding kind that is not in the list', () => {
    expect(() =>
      criticOutputSchema.parse(output({ findings: [finding({ kind: 'vibes' as never })] })),
    ).toThrow();
  });

  it('strips anything the model adds beyond the schema', () => {
    const parsed = criticOutputSchema.parse({
      ...output({ findings: [finding()] }),
      successProbability: 0.7,
    });
    expect(Object.keys(parsed)).not.toContain('successProbability');
  });

  it('has no field in which a probability of success could be returned', () => {
    // Structural, not a matter of prompting: there is nowhere to put one.
    const parsed = criticOutputSchema.parse(output({ findings: [finding()] }));
    const keys = [...Object.keys(parsed), ...Object.keys(parsed.findings[0] as object)];
    for (const key of keys) {
      expect(key).not.toMatch(/score|probability|likelihood|chance|rating|percent/iu);
    }
  });
});

describe('finding kinds', () => {
  it('does not duplicate the checks checkDraft already makes exactly', () => {
    // Word limits, fabricated fact ids, unsupported claims and repeated facts
    // are decided by arithmetic. Asking a model to re-find them would be
    // slower, dearer and less reliable — and would bury the findings only a
    // reader of the whole application can make.
    for (const kind of FINDING_KINDS) {
      expect(kind).not.toMatch(/word_limit|unsupported_claim|repeated_fact|unknown_fact/u);
    }
  });

  it('covers the fault only a reader of the whole form can see', () => {
    expect(FINDING_KINDS).toContain('contradicts_another_answer');
    expect(FINDING_KINDS).toContain('does_not_answer_question');
  });
});

describe('bySeverity', () => {
  it('puts what could sink the application first', () => {
    const sorted = [
      finding({ severity: 'minor' }),
      finding({ severity: 'blocking' }),
      finding({ severity: 'worth_fixing' }),
    ]
      .toSorted(bySeverity)
      .map((f) => f.severity);
    expect(sorted).toEqual(['blocking', 'worth_fixing', 'minor']);
  });
});

describe('keepCheckableFindings', () => {
  const answers = ['We will run workshops.', 'Young people in Wells.'];

  it('keeps a finding that quotes the application', () => {
    const kept = keepCheckableFindings(output({ findings: [finding()] }), answers);
    expect(kept.findings).toHaveLength(1);
  });

  it('drops a finding that quotes something nobody wrote', () => {
    // A criticism of an invented sentence is the review equivalent of a
    // fabricated citation, and sends the applicant hunting for it.
    const kept = keepCheckableFindings(
      output({ findings: [finding({ quote: 'We will cure all disease.' })] }),
      answers,
    );
    expect(kept.findings).toEqual([]);
  });

  it('ignores case and surrounding whitespace when matching', () => {
    const kept = keepCheckableFindings(
      output({ findings: [finding({ quote: '  we will RUN workshops.  ' })] }),
      answers,
    );
    expect(kept.findings).toHaveLength(1);
  });

  it('always keeps a whole-application finding', () => {
    const kept = keepCheckableFindings(
      output({ findings: [finding({ questionNumber: null, quote: null })] }),
      answers,
    );
    expect(kept.findings).toHaveLength(1);
  });
});

describe('buildCriticPrompt', () => {
  it('includes every question and its answer', () => {
    const prompt = buildCriticPrompt(input());
    expect(prompt).toContain('What will you do?');
    expect(prompt).toContain('We will run workshops.');
    expect(prompt).toContain('Young people in Wells.');
  });

  it('marks an unanswered question rather than showing an empty answer', () => {
    const prompt = buildCriticPrompt(
      input({ questions: [{ position: 1, question: 'What will you do?', answer: '   ' }] }),
    );
    expect(prompt).toContain('(not yet answered)');
  });

  it("includes the funder's verified criteria, so priorities can be checked", () => {
    expect(buildCriticPrompt(input())).toContain('Work must take place within Somerset');
  });

  it('says plainly when no criteria have been verified', () => {
    const prompt = buildCriticPrompt(input({ criteriaLabels: [] }));
    expect(prompt).toContain('No verified eligibility criteria');
  });

  it('fences the application as untrusted', () => {
    const prompt = buildCriticPrompt(input());
    expect(prompt).toMatch(/untrusted/iu);
  });

  it('uses a fresh marker each call, so an answer cannot forge the fence', () => {
    expect(buildCriticPrompt(input())).not.toBe(buildCriticPrompt(input()));
  });
});

describe('the two modes', () => {
  it('share the rules, so only the stance differs', () => {
    for (const agent of [CRITIC, RED_TEAM]) {
      expect(agent.system).toContain('Never rewrite an answer');
      expect(agent.system).toContain('Say nothing about the likelihood of being funded');
      expect(agent.system).toContain('must quote the applicant’s own words');
    }
  });

  it('reads generously by default and sceptically in red-team mode', () => {
    expect(CRITIC.system).toContain('on behalf of the applicant');
    expect(RED_TEAM.system).toContain('defensible reasons to reject');
    expect(RED_TEAM.system).toContain('least credit');
  });

  it('are recorded as different agents, so generations can be told apart', () => {
    expect(CRITIC.name).not.toBe(RED_TEAM.name);
    expect(RED_TEAM.parser).toBe(CRITIC.parser);
  });

  it('both refuse to rewrite, which is the Writer’s job', () => {
    for (const agent of [CRITIC, RED_TEAM]) {
      expect(agent.system).toContain('the applicant writes it');
    }
  });
});
