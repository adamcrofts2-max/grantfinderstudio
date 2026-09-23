import { describe, expect, it } from 'vitest';

import { findTheirPage, orgIdOf } from './find-their-page.js';

describe('findTheirPage', () => {
  it('always offers a search, with the name quoted', () => {
    const { search } = findTheirPage({ id: 'funder_typed_org_x', name: 'The Wells Trust' });
    const query = new URL(search.href).searchParams.get('q');
    expect(query).toBe('"The Wells Trust" grants how to apply');
    expect(new URL(search.href).protocol).toBe('https:');
  });

  it('cannot be broken by quotes or symbols in the name', () => {
    const { search } = findTheirPage({ id: 'x', name: 'A "Big" Trust & Co / 100%' });
    expect(new URL(search.href).searchParams.get('q')).toBe(
      '"A Big Trust & Co / 100%" grants how to apply',
    );
  });

  it('links a registered charity to its registered details', () => {
    const { register } = findTheirPage({ id: 'funder_360g_GB-CHC-1190002', name: 'Greenwood Trust' });
    expect(register?.href).toBe('https://findthatcharity.uk/orgid/GB-CHC-1190002');
  });

  it('knows the Scottish, Northern Irish and company registers too', () => {
    for (const id of ['GB-SC-SC012345', 'GB-NIC-100123', 'GB-COH-01234567']) {
      expect(findTheirPage({ id: `funder_360g_${id}`, name: 'x' }).register, id).not.toBeNull();
    }
  });

  it('offers no register link for an identifier it cannot vouch for', () => {
    // Stub funders' ids only look like register numbers, and a typed-in
    // funder has none: a link to a page that does not exist is worse than
    // none.
    for (const id of [
      'funder_360g_GB-CHC-STUB-1',
      'funder_360g_360G-somefunder',
      'funder_typed_org_a_the_wells_trust',
    ]) {
      expect(findTheirPage({ id, name: 'x' }).register, id).toBeNull();
    }
  });
});

describe('orgIdOf', () => {
  it('reads the org-id out of a 360Giving funder id, and nothing else', () => {
    expect(orgIdOf('funder_360g_GB-CHC-1190002')).toBe('GB-CHC-1190002');
    expect(orgIdOf('funder_typed_x')).toBeNull();
    expect(orgIdOf('funder_360g_')).toBeNull();
  });
});
