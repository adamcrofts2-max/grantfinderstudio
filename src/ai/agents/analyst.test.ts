import { describe, expect, it } from 'vitest';

import { CIC_TREATMENTS } from '../../domain/types.js';
import {
  analystOutputSchema,
  ANALYST,
  buildAnalystPrompt,
  CRITERION_KINDS,
  paramsForKind,
  type CriterionParams,
} from './analyst.js';

function params(overrides: Partial<CriterionParams> = {}): CriterionParams {
  return {
    permittedForms: null,
    permitted: null,
    permittedRegions: null,
    anyOf: null,
    minGbp: null,
    maxGbp: null,
    minMonths: null,
    maxMonths: null,
    required: null,
    ...overrides,
  };
}

describe('paramsForKind', () => {
  it('keeps only the keys the kind uses', () => {
    const narrowed = paramsForKind('amount', params({ minGbp: 5000, maxGbp: 25000, required: true }));
    expect(narrowed).toEqual({ minGbp: 5000, maxGbp: 25000 });
  });

  it('keeps a bound that is explicitly null', () => {
    // The criteria mapper distinguishes an explicit null from a missing key: a
    // bound arriving as undefined is rejected rather than read as unlimited,
    // which is what stops a hard exclusion silently becoming a pass.
    expect(paramsForKind('amount', params({ maxGbp: 40_000 }))).toEqual({
      minGbp: null,
      maxGbp: 40_000,
    });
  });

  it('covers every criterion kind the engine understands', () => {
    for (const kind of CRITERION_KINDS) {
      expect(Object.keys(paramsForKind(kind, params())).length).toBeGreaterThan(0);
    }
  });

  it('does not leak another kind’s parameters through', () => {
    const narrowed = paramsForKind(
      'match_funding',
      params({ required: true, minGbp: 1000, anyOf: ['young people'] }),
    );
    expect(narrowed).toEqual({ required: true });
  });
});

describe('analystOutputSchema', () => {
  const valid = {
    title: 'Green Futures Grant',
    funderName: 'Example Trust',
    summary: null,
    minAmountGbp: 10_000,
    maxAmountGbp: 40_000,
    deadline: '2027-01-15',
    deadlineKind: 'confirmed',
    jurisdiction: 'england',
    criteria: [
      {
        kind: 'amount',
        label: 'Between £10,000 and £40,000',
        params: params({ minGbp: 10_000, maxGbp: 40_000 }),
        cicTreatment: null,
        sourceSpan: 'Grants of between £10,000 and £40,000 are available.',
        confidence: 'high',
      },
    ],
    instructionLikeContent: [],
  };

  it('accepts a well-formed analysis', () => {
    expect(analystOutputSchema.parse(valid).title).toBe('Green Futures Grant');
  });

  it('rejects a deadline that is not an ISO date', () => {
    expect(() =>
      analystOutputSchema.parse({ ...valid, deadline: '15 January 2027' }),
    ).toThrow();
  });

  it('rejects a criterion kind the engine cannot evaluate', () => {
    // A rule the engine cannot read is worse than no rule: the applicant would
    // assume it had been checked.
    expect(() =>
      analystOutputSchema.parse({
        ...valid,
        criteria: [{ ...valid.criteria[0], kind: 'vibes' }],
      }),
    ).toThrow();
  });

  it('rejects a criterion with no source span', () => {
    expect(() =>
      analystOutputSchema.parse({
        ...valid,
        criteria: [{ ...valid.criteria[0], sourceSpan: '' }],
      }),
    ).toThrow();
  });

  it('accepts every CIC treatment the domain defines, and nothing else', () => {
    for (const treatment of CIC_TREATMENTS) {
      const parsed = analystOutputSchema.parse({
        ...valid,
        criteria: [{ ...valid.criteria[0], cicTreatment: treatment }],
      });
      expect(parsed.criteria[0]?.cicTreatment).toBe(treatment);
    }
    expect(() =>
      analystOutputSchema.parse({
        ...valid,
        criteria: [{ ...valid.criteria[0], cicTreatment: 'charities_only' }],
      }),
    ).toThrow();
  });

  it('strips anything the model adds beyond the schema', () => {
    const parsed = analystOutputSchema.parse({
      ...valid,
      verified: true,
      criteria: [{ ...valid.criteria[0], verifiedBy: 'user_a' }],
    });
    expect(Object.keys(parsed)).not.toContain('verified');
    expect(Object.keys(parsed.criteria[0] as object)).not.toContain('verifiedBy');
  });
});

describe('buildAnalystPrompt', () => {
  it('fences the guidance as untrusted', () => {
    const prompt = buildAnalystPrompt('We fund registered charities only.', 'example.org');
    expect(prompt).toContain('We fund registered charities only.');
    expect(prompt).toMatch(/untrusted/iu);
  });

  it('uses a fresh marker each call, so guidance cannot forge the fence', () => {
    const a = buildAnalystPrompt('text', 'label');
    const b = buildAnalystPrompt('text', 'label');
    expect(a).not.toBe(b);
  });
});

describe('ANALYST definition', () => {
  it('records a prompt version, so generations can be traced to a prompt', () => {
    expect(ANALYST.promptVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/u);
  });

  it('tells the model that reading a rule is not deciding one', () => {
    expect(ANALYST.system).toContain('You do not decide whether anyone is eligible');
  });

  it('makes the asset-lock distinction explicit, since applicants misread it', () => {
    expect(ANALYST.system).toContain('asset_locked_only');
    expect(ANALYST.system).toContain('statutory asset lock');
  });
});

describe('the deadline, as the model is asked for it and as it is checked', () => {
  /**
   * Found by the September 2026 walkthrough. The validator required
   * YYYY-MM-DD and the schema the model saw said only "string", so a page
   * reading "5pm on 31 January 2027" could be answered faithfully, rejected
   * twice, and reported to the applicant as guidance we "could not make sense
   * of". The two halves must say the same thing.
   */
  const deadline = (
    ANALYST.outputSchema as { properties: Record<string, { type: unknown; format?: string }> }
  ).properties['deadline'];

  it('tells the model it is a date, in a keyword structured outputs supports', () => {
    expect(deadline?.format).toBe('date');
    // `pattern` is not a supported structured-output keyword, and this
    // schema is sent as-is, so it must not be the way the date is described.
    expect(deadline).not.toHaveProperty('pattern');
  });

  it('still lets the model say there is no deadline', () => {
    expect(deadline?.type).toEqual(['string', 'null']);
  });

  it('says the format in the prompt too, with the example that used to fail', () => {
    expect(ANALYST.system).toContain('YYYY-MM-DD');
    expect(ANALYST.system).toContain('2027-01-31');
  });

  it('accepts what `format: date` produces and refuses the prose form', () => {
    const base = analystOutputSchema.shape;
    expect(base.deadline.safeParse('2027-01-31').success).toBe(true);
    expect(base.deadline.safeParse(null).success).toBe(true);
    expect(base.deadline.safeParse('31 January 2027').success).toBe(false);
  });
});

describe('preferences are not requirements', () => {
  it('tells the model that a preference must not become a criterion', () => {
    // Found live: the Analyst turned "we are particularly interested in young
    // people aged 11 to 25" into a hard beneficiary rule, and verifying it
    // produced "Not eligible" for a fund the applicant could have applied to.
    expect(ANALYST.system).toContain('particularly interested in');
    expect(ANALYST.system).toContain('hard pass or fail');
  });

  it('asks for beneficiary groups as names, not phrases', () => {
    expect(ANALYST.system).toContain('never a whole phrase and never an age range');
  });
});
