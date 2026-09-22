/**
 * The blanks, and the banner that depends on them.
 *
 * The test that matters here is the last one: as long as the publisher is
 * unnamed, the pages must say so. A privacy notice that quietly starts looking
 * finished while it still cannot say who controls the data is the exact
 * failure this whole arrangement exists to prevent.
 */

import { describe, expect, it } from 'vitest';

import { blanks, PUBLISHER, readyToPublish, type Publisher } from './operator.js';

const FILLED: Publisher = {
  legalName: 'Example Holdings Ltd',
  registeredAddress: '1 Example Street, Bristol BS1 1AA',
  icoRegistration: 'ZA000000',
  contactEmail: 'privacy@example.org',
  hostedIn: 'London (AWS eu-west-2)',
};

describe('blanks', () => {
  it('lists everything still missing, in words a person can act on', () => {
    const missing = blanks({
      ...FILLED,
      legalName: null,
      contactEmail: '   ',
    });
    expect(missing).toHaveLength(2);
    expect(missing.join(' ')).toContain('legal name');
    expect(missing.join(' ')).toContain('request');
  });

  it('treats whitespace as unfilled', () => {
    expect(blanks({ ...FILLED, icoRegistration: '  ' })).toHaveLength(1);
  });

  it('is empty once every fact is in', () => {
    expect(blanks(FILLED)).toEqual([]);
  });
});

describe('readyToPublish', () => {
  it('is true only when nothing is missing', () => {
    expect(readyToPublish(FILLED)).toBe(true);
    expect(readyToPublish({ ...FILLED, hostedIn: null })).toBe(false);
  });

  /**
   * THE GUARD.
   *
   * This asserts the state of the repository, not of a fixture. While the
   * publisher is unnamed, `readyToPublish()` must be false, which is what puts
   * the "this is a draft" banner on `/privacy` and `/terms`.
   *
   * When somebody fills `PUBLISHER` in, this test fails — and that failure is
   * the prompt to have the notice read by someone qualified and then to change
   * this test deliberately, rather than to discover months later that a draft
   * has been serving as the real thing.
   */
  it('is false while this repository has not been told who publishes it', () => {
    expect(
      readyToPublish(PUBLISHER),
      'PUBLISHER has been filled in. Good — now have the notice and the terms read by ' +
        'somebody qualified, then change this test to expect true.',
    ).toBe(false);
    expect(blanks(PUBLISHER).length).toBeGreaterThan(0);
  });
});
