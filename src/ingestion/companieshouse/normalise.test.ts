import { describe, expect, it } from 'vitest';
import {
  CIC_SUBTYPE,
  formatAddress,
  isActive,
  isCicRecord,
  looksLikeCompanyNumber,
  toCompanyMatch,
  toCompanyProfile,
  toJurisdiction,
  toLegalForm,
} from './normalise.js';

describe('toLegalForm — the CIC distinction', () => {
  it('identifies a CIC limited by guarantee', () => {
    expect(toLegalForm('private-limited-guarant-nsc', CIC_SUBTYPE)).toBe(
      'cic_limited_by_guarantee',
    );
    expect(
      toLegalForm('private-limited-guarant-nsc-limited-exemption', CIC_SUBTYPE),
    ).toBe('cic_limited_by_guarantee');
  });

  it('identifies a CIC limited by shares', () => {
    expect(toLegalForm('ltd', CIC_SUBTYPE)).toBe('cic_limited_by_shares');
    expect(
      toLegalForm('private-limited-shares-section-30-exemption', CIC_SUBTYPE),
    ).toBe('cic_limited_by_shares');
  });

  /**
   * The reason this module exists. Guessing here would flip a hard exclusion
   * into a pass on any fund restricted to bodies with no share capital.
   */
  it('returns null for a CIC of an unrecognised type rather than guessing', () => {
    expect(toLegalForm('some-future-company-type', CIC_SUBTYPE)).toBeNull();
    expect(toLegalForm('llp', CIC_SUBTYPE)).toBeNull();
  });

  it('never resolves a CIC to a non-CIC form', () => {
    for (const type of ['ltd', 'private-limited-guarant-nsc']) {
      const form = toLegalForm(type, CIC_SUBTYPE);
      expect(form).toMatch(/^cic_/);
    }
  });

  it('is case-insensitive about the subtype', () => {
    expect(toLegalForm('ltd', 'Community-Interest-Company')).toBe('cic_limited_by_shares');
  });
});

describe('toLegalForm — other legal forms', () => {
  it.each([
    ['charitable-incorporated-organisation', 'charitable_incorporated_organisation'],
    ['registered-society-non-jurisdictional', 'community_benefit_society'],
    ['private-limited-guarant-nsc', 'company_limited_by_guarantee'],
    ['ltd', 'company_limited_by_shares'],
    ['plc', 'company_limited_by_shares'],
  ])('maps %s', (type, expected) => {
    expect(toLegalForm(type, null)).toBe(expected);
  });

  it('returns null for an unknown type rather than defaulting to "other"', () => {
    expect(toLegalForm('northern-ireland-other', null)).toBeNull();
    expect(toLegalForm(null, null)).toBeNull();
    expect(toLegalForm(42, null)).toBeNull();
  });
});

describe('isCicRecord', () => {
  it('detects the CIC subtype', () => {
    expect(isCicRecord(CIC_SUBTYPE)).toBe(true);
    expect(isCicRecord('COMMUNITY-INTEREST-COMPANY')).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isCicRecord(null)).toBe(false);
    expect(isCicRecord('')).toBe(false);
    expect(isCicRecord('charity')).toBe(false);
  });
});

describe('toCompanyMatch', () => {
  it('maps a search result', () => {
    const match = toCompanyMatch({
      company_number: '11111111',
      title: 'FICTIONAL CIC',
      company_status: 'active',
      company_type: 'private-limited-guarant-nsc',
      company_subtype: CIC_SUBTYPE,
      date_of_creation: '2020-01-15',
      address_snippet: '1 Fictional Street, Wells',
    });
    expect(match).toEqual({
      companyNumber: '11111111',
      name: 'FICTIONAL CIC',
      status: 'active',
      isCic: true,
      legalForm: 'cic_limited_by_guarantee',
      incorporatedOn: '2020-01-15',
      address: '1 Fictional Street, Wells',
    });
  });

  it('rejects a record with no number or name', () => {
    expect(toCompanyMatch({ title: 'No number' })).toBeNull();
    expect(toCompanyMatch({ company_number: '11111111' })).toBeNull();
  });

  it('keeps the record when the form is unrecognised, so the user can be asked', () => {
    const match = toCompanyMatch({
      company_number: '11111111',
      title: 'FICTIONAL CIC',
      company_type: 'mystery-type',
      company_subtype: CIC_SUBTYPE,
    });
    expect(match?.isCic).toBe(true);
    expect(match?.legalForm).toBeNull();
  });

  it('rejects an impossible date rather than passing it through', () => {
    const match = toCompanyMatch({
      company_number: '1', title: 'X', date_of_creation: '2024-02-31',
    });
    expect(match?.incorporatedOn).toBeNull();
  });
});

describe('toCompanyProfile', () => {
  it('maps a full profile', () => {
    const profile = toCompanyProfile({
      company_name: 'FICTIONAL CIC',
      company_number: '11111111',
      company_status: 'active',
      type: 'ltd',
      subtype: CIC_SUBTYPE,
      date_of_creation: '2022-06-01',
      jurisdiction: 'england-wales',
      registered_office_address: {
        address_line_1: '1 Fictional Street',
        locality: 'Wells',
        postal_code: 'BA5 0AA',
      },
    });
    expect(profile).toMatchObject({
      legalForm: 'cic_limited_by_shares',
      isCic: true,
      jurisdiction: 'uk_wide',
      address: '1 Fictional Street, Wells, BA5 0AA',
      ceasedOn: null,
    });
  });

  it('records cessation for a dissolved company', () => {
    const profile = toCompanyProfile({
      company_name: 'GONE LTD', company_number: '9', company_status: 'dissolved',
      type: 'ltd', date_of_cessation: '2024-05-01',
    });
    expect(profile?.ceasedOn).toBe('2024-05-01');
    expect(isActive(profile!)).toBe(false);
  });

  it('treats an active company as active', () => {
    expect(isActive({ status: 'active' })).toBe(true);
    expect(isActive({ status: null })).toBe(false);
  });
});

describe('toJurisdiction', () => {
  it('maps the values Companies House uses', () => {
    expect(toJurisdiction('england-wales')).toBe('uk_wide');
    expect(toJurisdiction('scotland')).toBe('scotland');
    expect(toJurisdiction('northern-ireland')).toBe('northern_ireland');
  });

  it('returns null for anything unrecognised', () => {
    expect(toJurisdiction('mars')).toBeNull();
    expect(toJurisdiction(null)).toBeNull();
  });
});

describe('formatAddress', () => {
  it('joins the parts that exist', () => {
    expect(
      formatAddress({ address_line_1: '1 Street', locality: 'Wells', postal_code: 'BA5 0AA' }),
    ).toBe('1 Street, Wells, BA5 0AA');
  });

  it('returns null when there is nothing usable', () => {
    expect(formatAddress({})).toBeNull();
    expect(formatAddress(null)).toBeNull();
    expect(formatAddress('a string')).toBeNull();
  });
});

describe('looksLikeCompanyNumber', () => {
  it('accepts the real formats', () => {
    expect(looksLikeCompanyNumber('11111111')).toBe(true);
    expect(looksLikeCompanyNumber('SC123456')).toBe(true);
    expect(looksLikeCompanyNumber('  NI123456 ')).toBe(true);
  });

  it('rejects a company name', () => {
    expect(looksLikeCompanyNumber('Mendip Green Futures')).toBe(false);
    expect(looksLikeCompanyNumber('1234')).toBe(false);
    expect(looksLikeCompanyNumber('123456789')).toBe(false);
  });
});
