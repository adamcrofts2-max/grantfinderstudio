/**
 * The permission check is made, and made FIRST, where it matters most.
 *
 * `src/auth/rbac.ts` held a complete matrix from the start and nothing
 * consulted it; the September 2026 security review found every check in the
 * product was "are you signed in to this organisation". These two are the
 * irreversible and the exfiltrating ones, and each must ask before it acts —
 * a check placed after the work is decoration.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const code = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '');

describe('the export', () => {
  const route = code('src/app/api/account/export/route.ts');

  it('asks for organisation:export', () => {
    expect(route).toMatch(/authorise\('organisation:export'\)/u);
  });

  it('asks before it reads anything', () => {
    expect(route.indexOf("authorise('organisation:export')")).toBeLessThan(
      route.indexOf('exportOrganisation('),
    );
  });

  it('refuses with a 403, not a redirect or an empty file', () => {
    expect(route).toMatch(/status: 403/u);
  });
});

describe('the erasure', () => {
  const action = code('src/app/organisation/data-actions.ts');

  it('asks for organisation:delete', () => {
    expect(action).toMatch(/authorise\('organisation:delete'\)/u);
  });

  it('asks before it deletes anything', () => {
    expect(action.indexOf("authorise('organisation:delete')")).toBeLessThan(
      action.indexOf('eraseOrganisation('),
    );
  });
});

describe('the Word download', () => {
  const route = code('src/app/api/applications/[id]/docx/route.ts');

  it('asks for application:read before it reads anything', () => {
    expect(route).toMatch(/authorise\('application:read'\)/u);
    expect(route.indexOf("authorise('application:read')")).toBeLessThan(
      route.indexOf('loadApplication('),
    );
  });

  it('reads through the tenant connection, where row-level security scopes it', () => {
    expect(route).toMatch(/withTenant\(/u);
    expect(route).not.toMatch(/\bwithAdmin\b|\bwithOperator\b/u);
  });
});
