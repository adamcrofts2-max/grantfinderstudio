/**
 * Tenant id validation. Pure — no database, so these stay fast.
 */

import { describe, expect, it } from 'vitest';
import { assertValidTenantId, InvalidTenantError } from './client.js';

describe('assertValidTenantId', () => {
  it('accepts a normal id', () => {
    expect(() => assertValidTenantId('org_a')).not.toThrow();
  });

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s, which would not fail closed', (_label, value) => {
    expect(() => assertValidTenantId(value)).toThrow(InvalidTenantError);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 123],
    ['an object', {}],
  ])('rejects %s', (_label, value) => {
    expect(() => assertValidTenantId(value)).toThrow(InvalidTenantError);
  });
});
