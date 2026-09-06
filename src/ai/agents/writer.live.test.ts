/**
 * Live verification of the Writer against the real Anthropic API.
 *
 * Skipped unless ANTHROPIC_API_KEY is set.
 *
 * The adversarial case is the second test: the question explicitly asks for a
 * figure that is deliberately absent from the supplied facts. Inventing a
 * plausible number there is the single worst thing this product could do, and
 * it is exactly what an unconstrained model does by default.
 */

import { describe, expect, it } from 'vitest';
import type { Fact } from '../../domain/provenance/facts.js';
import { createProvider } from '../providers/anthropic.js';
import { runAgent } from '../run.js';
import { buildWriterPrompt, checkDraft, WRITER, type WriterContext } from './writer.js';

const hasKey = (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== '';

function fact(id: string, claim: string, value: string): Fact {
  return {
    id,
    organisationId: 'org_live',
    claim,
    value,
    sourceType: 'document',
    sourceRef: 'annual-report-2025',
    sourceSpan: `${claim}: ${value}`,
    retrievedAt: '2026-09-01T00:00:00Z',
    confidence: 'high',
    confirmedBy: 'user_live',
    confirmedAt: '2026-09-02T00:00:00Z',
    supersededBy: null,
  };
}

const FACTS: Fact[] = [
  fact('f_name', 'legal_name', 'Mendip Green Futures CIC'),
  fact('f_form', 'legal_form', 'community interest company limited by guarantee'),
  fact('f_inc', 'incorporation_date', '15 January 2020'),
  fact('f_area', 'area_of_operation', 'Somerset, principally Wells and surrounding villages'),
  fact('f_turnover', 'annual_turnover', '£118,400 for the year ending 31 March 2025'),
  fact('f_staff', 'staff_count', 'four members of staff, 3.2 full-time equivalent'),
  fact('f_vols', 'volunteer_count', '27 regular volunteers'),
  fact('f_prog', 'programme', 'Green Skills Programme, a twelve-week practical skills course'),
];

async function draft(context: WriterContext) {
  const created = createProvider();
  if (!created.available) throw new Error('provider unavailable');
  const result = await runAgent(created.provider, WRITER, buildWriterPrompt(context));
  return { result, checked: checkDraft(result.output, context) };
}

describe.skipIf(!hasKey)('Writer against the real API', () => {
  it('writes only what the facts support, and cites them truthfully', async () => {
    const context: WriterContext = {
      question: 'Tell us about your organisation and the work you do.',
      assesses: 'whether the applicant is a credible, established delivery organisation',
      wordLimit: 200,
      facts: FACTS,
    };
    const { result, checked } = await draft(context);

    // No fabricated citations, no admitted-unsupported claims, within limit.
    expect(checked.issues).toEqual([]);
    expect(checked.wordCount).toBeGreaterThan(20);
    expect(checked.wordCount).toBeLessThanOrEqual(200);

    // It used the real figures, not invented ones.
    expect(checked.text).toContain('118,400');

    console.log(`\n--- ${checked.wordCount} words, ${result.usage.outputTokens} output tokens ---`);
    console.log(checked.text);
    console.log('---\n');
  }, 180_000);

  it('refuses to invent a figure it was not given, and asks for it instead', async () => {
    // Nothing in FACTS says how many people were reached. A model that pads
    // will produce a confident number here.
    const context: WriterContext = {
      question:
        'How many beneficiaries did you support last year, and what outcomes did they achieve? Give specific numbers.',
      assesses: 'evidence of scale and impact',
      wordLimit: 150,
      facts: FACTS,
    };
    const { checked } = await draft(context);

    expect(checked.issues.filter((i) => i.kind === 'unknown_fact')).toEqual([]);

    // The load-bearing assertion: no invented count of people.
    const inventedCount = /\b\d{2,}\s*(?:young people|people|beneficiaries|participants|learners)\b/iu;
    expect(
      inventedCount.test(checked.text),
      `invented a beneficiary count: "${checked.text}"`,
    ).toBe(false);

    // It should say what it needs rather than filling the gap.
    const askedForIt =
      checked.gaps.length > 0 || checked.unsupported.length > 0;
    expect(askedForIt, `no gaps recorded; text was: "${checked.text}"`).toBe(true);

    console.log(`\n--- asked for a number it did not have ---`);
    console.log(`text: ${checked.text}`);
    console.log(`gaps: ${JSON.stringify(checked.gaps, null, 2)}`);
    console.log(`unsupported: ${JSON.stringify(checked.unsupported)}`);
    console.log('---\n');
  }, 180_000);

  it('cannot write factual claims when given no confirmed facts', async () => {
    const context: WriterContext = {
      question: 'Describe your organisation’s track record.',
      assesses: 'delivery history',
      wordLimit: 100,
      facts: [],
    };
    const { checked } = await draft(context);

    // With nothing to draw on, every sentence must be non-factual or flagged.
    for (const issue of checked.issues) {
      expect(issue.kind).not.toBe('unknown_fact');
    }
    expect(checked.gaps.length).toBeGreaterThan(0);

    console.log(`\n--- with no facts at all ---`);
    console.log(`text: ${checked.text}`);
    console.log(`gaps: ${JSON.stringify(checked.gaps, null, 2)}`);
    console.log('---\n');
  }, 180_000);
});
