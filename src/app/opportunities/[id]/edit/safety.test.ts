/**
 * Editing a fund can only ever reach this organisation's own funds.
 *
 * The database functions are proved against the schema in
 * `src/db/own-funds.test.ts`. These pin the wiring those proofs rely on: that
 * every action asks who is signed in before it touches anything, that the
 * page and the actions stay on the tenant connection (the owner connection
 * bypasses row-level security), and that removing a fund with an application
 * still requires the tick on the server.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '');

const actions = code('src/app/opportunities/[id]/edit/actions.ts');
const page = code('src/app/opportunities/[id]/edit/page.tsx');
const remove = code('src/app/opportunities/add/actions.ts');

/** The body of one exported async function. */
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  const next = source.indexOf('export async function ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('the fund-editing actions', () => {
  for (const name of ['editOwnFundAction', 'addRuleAction', 'removeRuleAction']) {
    it(`${name} asks who is signed in before it reads or writes`, () => {
      const fn = body(actions, name);
      const asked = fn.indexOf('await requireOrganisationId()');
      expect(asked).toBeGreaterThan(-1);
      expect(asked).toBeLessThan(fn.indexOf('getDatabase()'));
    });
  }

  it('writes through the tenant connection only', () => {
    // withAdmin appears once, to resolve a renamed funder — the same shared-
    // table write the add route makes, scoped to this organisation's own
    // private funders. Nothing about the fund itself goes through it.
    expect(actions.match(/\bwithAdmin\(/gu)).toHaveLength(1);
    expect(actions).not.toMatch(/\bwithOperator\b/u);
    expect(body(actions, 'editOwnFundAction')).toMatch(/withAdmin\(\(tx\) =>\s*ensureFunderNamed\(/u);
  });
});

describe('the fund-editing page', () => {
  it('requires a signed-in organisation and holds no wider connection', () => {
    expect(page).toMatch(/await requireOrganisationId\(\)/u);
    expect(page).not.toMatch(/\bwithAdmin\b|\bwithOperator\b/u);
  });

  it('is a 404 for any fund the organisation did not add', () => {
    expect(page).toMatch(/loadOwnFund\(/u);
    expect(page).toMatch(/notFound\(\)/u);
  });
});

describe('removing a fund', () => {
  it('refuses on the server to take an application without the tick', () => {
    const fn = body(remove, 'deleteOpportunityAction');
    const check = fn.indexOf("formData.get('alsoApplication') !== 'yes'");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(fn.indexOf('deletePastedOpportunity('));
  });
});
