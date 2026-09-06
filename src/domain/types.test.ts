import { describe, expect, it } from 'vitest';
import {
  formatJurisdiction,
  formatJurisdictions,
  hasShareCapital,
  hasStatutoryAssetLock,
  isCic,
  isLimitedByGuarantee,
  type Jurisdiction,
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

describe('jurisdiction formatting', () => {
  it('never leaks a raw enum value to the user', () => {
    const all: Jurisdiction[] = [
      'england', 'wales', 'scotland', 'northern_ireland', 'uk_wide',
    ];
    for (const value of all) {
      const label = formatJurisdiction(value);
      expect(label).not.toContain('_');
      expect(label).not.toBe(value);
    }
  });

  it('capitalises country names', () => {
    expect(formatJurisdiction('england')).toBe('England');
    expect(formatJurisdiction('northern_ireland')).toBe('Northern Ireland');
    expect(formatJurisdiction('uk_wide')).toBe('the whole UK');
  });

  it('reads as prose for a list', () => {
    expect(formatJurisdictions(['england'])).toBe('England');
    expect(formatJurisdictions(['england', 'wales'])).toBe('England and Wales');
    expect(formatJurisdictions(['england', 'wales', 'scotland'])).toBe(
      'England, Wales and Scotland',
    );
  });

  it('says something sensible for an empty list', () => {
    expect(formatJurisdictions([])).toBe('nowhere stated');
  });
});
