import { describe, expect, it } from 'vitest';
import {
  hasShareCapital,
  hasStatutoryAssetLock,
  isCic,
  isLimitedByGuarantee,
  type LegalForm,
} from './types.js';

describe('legal-form predicates', () => {
  it('identifies both CIC forms', () => {
    expect(isCic('cic_limited_by_guarantee')).toBe(true);
    expect(isCic('cic_limited_by_shares')).toBe(true);
    expect(isCic('charity')).toBe(false);
    expect(isCic('company_limited_by_shares')).toBe(false);
  });

  it('recognises every form that carries an asset lock', () => {
    const locked: LegalForm[] = [
      'cic_limited_by_guarantee',
      'cic_limited_by_shares',
      'charity',
      'charitable_incorporated_organisation',
      'community_benefit_society',
    ];
    for (const form of locked) expect(hasStatutoryAssetLock(form)).toBe(true);
  });

  it('does not attribute an asset lock to ordinary companies', () => {
    expect(hasStatutoryAssetLock('company_limited_by_guarantee')).toBe(false);
    expect(hasStatutoryAssetLock('company_limited_by_shares')).toBe(false);
    expect(hasStatutoryAssetLock('unincorporated_association')).toBe(false);
    expect(hasStatutoryAssetLock('other')).toBe(false);
  });

  it('identifies forms with share capital', () => {
    expect(hasShareCapital('cic_limited_by_shares')).toBe(true);
    expect(hasShareCapital('company_limited_by_shares')).toBe(true);
    expect(hasShareCapital('cic_limited_by_guarantee')).toBe(false);
    expect(hasShareCapital('charity')).toBe(false);
  });

  it('identifies forms limited by guarantee', () => {
    expect(isLimitedByGuarantee('cic_limited_by_guarantee')).toBe(true);
    expect(isLimitedByGuarantee('company_limited_by_guarantee')).toBe(true);
    expect(isLimitedByGuarantee('cic_limited_by_shares')).toBe(false);
    expect(isLimitedByGuarantee('other')).toBe(false);
  });

  it('treats guarantee and share capital as mutually exclusive for CICs', () => {
    for (const form of ['cic_limited_by_guarantee', 'cic_limited_by_shares'] as LegalForm[]) {
      expect(isLimitedByGuarantee(form)).not.toBe(hasShareCapital(form));
    }
  });
});
