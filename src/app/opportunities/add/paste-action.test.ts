/**
 * The paste-the-guidance action, held to two things the September 2026
 * walkthrough found it doing wrong.
 *
 * 1. It swallowed every failure in a bare `catch`, so a dead key or an outage
 *    reached the applicant as "we could not make sense of that guidance" —
 *    blaming their paste — and reached the operator as nothing at all.
 * 2. It ignored the funder the person arrived from. The page says "whatever
 *    you add here is joined to that award history", and the action joined it
 *    to whichever row the model's spelling of the name matched.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const code = readFileSync('src/app/opportunities/add/actions.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//gu, '')
  .replace(/\/\/[^\n]*/gu, '');
const form = readFileSync('src/app/opportunities/add/AddOpportunity.tsx', 'utf8');

describe('when reading the guidance fails', () => {
  it('logs why, instead of swallowing it — reading and storing alike', () => {
    expect(code).toMatch(/console\.error\(\s*'\[grantfinderstudio\] reading pasted guidance failed:'/u);
    expect(code).toMatch(/console\.error\(\s*'\[grantfinderstudio\] storing a read fund failed:'/u);
    // The one bare catch left is the URL check, which is validation of what
    // was typed rather than a failure anybody needs to diagnose.
    const bare = [...code.matchAll(/catch\s*\{/gu)];
    expect(bare).toHaveLength(1);
    expect(code.slice(Math.max(0, (bare[0]?.index ?? 0) - 200), bare[0]?.index)).toMatch(/new URL\(/u);
  });

  it('blames the paste only when the reading itself failed', () => {
    // A schema or refusal failure is about the text; anything else is the
    // service, and the applicant is told so rather than asked to re-paste.
    expect(code).toMatch(/instanceof AiSchemaError \|\| error instanceof AiRefusalError/u);
    expect(code).toMatch(/did not answer/u);
  });
});

describe('the funder the person came from', () => {
  it('travels with the form', () => {
    expect(form).toMatch(/name="funderId" type="hidden"/u);
  });

  it('is the one the fund is joined to, looked up with ownership', () => {
    expect(code).toMatch(/findFunderById\(tx, pickedFunderId, organisationId\)/u);
  });
});
