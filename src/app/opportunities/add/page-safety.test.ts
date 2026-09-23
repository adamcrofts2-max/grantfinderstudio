/**
 * The add-a-fund page cannot write to shared data.
 *
 * Found by the September 2026 security review, and proved from outside before
 * it was fixed: one anonymous GET —
 *
 *   /opportunities/add?funder360=<any id>&funderName=<any text>
 *
 * — created a row in `funders`, the table every organisation reads, under a
 * real 360Giving funder's id and with a name taken straight from the URL. No
 * sign-in, no form, no POST. The page held the owner connection during render
 * and used it.
 *
 * Nothing linked to that branch any more, so it was deleted rather than
 * hardened. These assertions are what stops it coming back: a page renders on
 * GET, a GET must not write, and the simplest way to make that true is for
 * the page never to hold a connection that could.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The code with comments stripped, so the explanation above cannot match. */
const code = readFileSync('src/app/opportunities/add/page.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/\/\/[^\n]*/gu, '');

describe('the add-a-fund page', () => {
  it('requires a signed-in organisation before it does anything', () => {
    expect(code).toMatch(/await requireOrganisationId\(\)/u);
  });

  it('never holds the owner or operator connection while rendering', () => {
    // Either would bypass row-level security. The page reads one funder, and
    // the tenant connection is exactly wide enough for that.
    expect(code).not.toMatch(/\bwithAdmin\b/u);
    expect(code).not.toMatch(/\bwithOperator\b/u);
  });

  it('writes nothing', () => {
    expect(code).not.toMatch(/\bensureFunder\w*\(/u);
    expect(code).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/iu);
  });

  it('no longer answers to the parameter that wrote', () => {
    expect(code).not.toMatch(/funder360/u);
  });
});
